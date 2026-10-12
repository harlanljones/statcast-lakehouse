#!/usr/bin/env python3
"""Autoresearch benchmark, warehouse-side data-pipeline stage (offline, deterministic).

Workload, in order, over the checked-in real corpus (``data/scenarios/*.arrow``):

  1. corpus   — ``ingestion.scenarios.real_pitches()``: dedup + game order.
  2. validate — integrity gates: unique pitch ids, no NULLs in the required
                columns, every pitch physically consistent (its 9 kinematic
                parameters cross the plate plane within 0.01 ft of the recorded
                ``plate_x``/``plate_z``), and sane kinematic bounds.
  3. ingest   — ``rows_to_record_batches`` + ``write_arrow`` (the dry-run /
                batch-load row path).
  4. derive   — per-pitch trajectory / ghost / break vector / commitment /
                release extrapolation plus the aggregate panels (arsenal,
                dispersion, fatigue, tunneling pairs), repeated
                ``DERIVE_PASSES`` times over the whole corpus.
  5. serve    — ``serving.app._serialize``: the zstd Arrow IPC body + ETag.
  6. export   — ``export_batch.export_day_range`` with a local manifest.
  7. parity   — dump per-pitch path checksums for the TypeScript stage, which
                must reproduce the same closed-form trajectories.

Timings are medians over fixed repetition counts and are reported both raw and
machine-normalized against a fixed arithmetic calibration loop (``*_ratio``),
so CPU contention does not move the score.

Emits ``METRIC name=value`` lines on stdout and exits non-zero when any gate
fails. No network, no GCP credentials, no wall-clock dependence.
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

import pyarrow as pa

from ingestion import export_batch
from ingestion.scenarios import SCENARIO_FILES, real_pitches
from ingestion.worker import (
    commitment_position,
    compute_arsenal_centroids,
    compute_break_vector,
    compute_fatigue_buckets,
    compute_pitch_pair_metrics,
    compute_release_dispersion,
    extrapolate_to_release,
    ghost_trajectory,
    position_at,
    rows_to_record_batches,
    solve_flight_time,
    trajectory,
    tunneling_distance,
    write_arrow,
)
from serving.app import _serialize

# ---------------------------------------------------------------- workload size
# Fixed, so every run measures the same amount of work per corpus pitch. Each
# batch count is chosen so its stage median sits well above timer noise
# (a few ms), and so no single stage dominates the aggregate work figure.
DERIVE_PASSES = 1      # whole-corpus derivation passes (solver + panels)
INGEST_BATCHES = 30    # corpus-sized Arrow IPC writes (dry-run / row path)
SERVE_BATCHES = 10     # Arrow IPC body + ETag (the serving response path)
EXPORT_BATCHES = 3     # per-game-day partition export + manifest
REPS = 25               # workload repetitions; the cleanest (min) one is reported
CALIB_ITERATIONS = 1_000_000  # ~20 ms of pure-Python arithmetic

PLATE_TOLERANCE_FT = 0.01

# Garbage-catcher bounds (feet, mph, rpm): they exist to reject fabricated or
# corrupted rows (zero, negative, absurd), not to judge unusual-but-real
# pitches. Every time the corpus grew, a real pitch was outside the previous
# values — position-player lobs at 35.6 and 32.8 mph, low-slot releases whose
# extrapolated release-plane z0 is 1.2 ft, a pitch that sailed to plate_z 8.41 ft
# — so the windows below are deliberately wide for any physically possible
# tracked pitch. What actually guards this corpus is the plate-crossing check,
# the unique-pitch-id check, the no-NULL rule, the schema-parity guard and the
# mirrored-solver parity check in the TypeScript stage.
BOUNDS = {
    "release_speed": (10.0, 115.0),
    "release_spin_rate": (0.0, 4500.0),
    "x0": (-8.0, 8.0),
    # y0 is the 50 ft measurement plane, or the release plane 60.5 - extension
    # once the loader has back-extrapolated.
    "y0": (40.0, 62.0),
    "z0": (0.5, 12.0),
    "vx0": (-40.0, 40.0),
    "vy0": (-180.0, -30.0),
    "vz0": (-50.0, 50.0),
    "ax": (-50.0, 50.0),
    "ay": (0.0, 75.0),
    "az": (-75.0, 5.0),
    "plate_x": (-8.0, 8.0),
    "plate_z": (-6.0, 12.0),
    "sz_top": (1.5, 5.0),
    "sz_bot": (0.5, 3.0),
}

REQUIRED_COLUMNS = (
    "pitch_id",
    "game_id",
    "game_date",
    "pitcher_id",
    "batter_id",
    "pitch_type",
    "release_speed",
    "x0",
    "y0",
    "z0",
    "vx0",
    "vy0",
    "vz0",
    "ax",
    "ay",
    "az",
    "plate_x",
    "plate_z",
    "is_swing",
    "is_whiff",
)

_KINEMATICS = ("x0", "y0", "z0", "vx0", "vy0", "vz0", "ax", "ay", "az")


def out_dir() -> Path:
    path = Path(os.environ.get("AUTORESEARCH_OUT_DIR", "/tmp/statcast-autoresearch"))
    path.mkdir(parents=True, exist_ok=True)
    return path


# ------------------------------------------------------------------ timing
def calibrate(iterations: int = CALIB_ITERATIONS) -> float:
    """Fixed arithmetic workload: proxy for CPU speed under contention."""
    x = 1.000001
    acc = 0.0
    for i in range(iterations):
        x = x * 1.0000001 + 1e-7
        acc += x * 1.0000001
    return acc + x


def measure_stages(stages: dict, reps: int = REPS) -> tuple[dict, float, float, float]:
    """Time every stage of one workload batch, interleaved with the calibration loop.

    Each repetition times all stages and then the calibration loop. The minimum
    over repetitions is reported for every quantity — the least contended
    measurement — and the ratio is min(work) / min(calibration), so a rep that
    happened to catch a slow calibration cannot flatter the ratio. Minima are
    far more stable than means under external load.
    Returns (per-stage minimum ms, total minimum ms, calibration minimum ms,
    ratio).
    """
    for fn in stages.values():
        fn()
    calibrate()

    samples: dict[str, list[float]] = {name: [] for name in stages}
    totals: list[float] = []
    calibs: list[float] = []
    for _ in range(reps):
        total = 0.0
        for name, fn in stages.items():
            t0 = time.perf_counter()
            fn()
            elapsed = (time.perf_counter() - t0) * 1000.0
            samples[name].append(elapsed)
            total += elapsed
        t0 = time.perf_counter()
        calibrate()
        calib = (time.perf_counter() - t0) * 1000.0
        totals.append(total)
        calibs.append(calib)

    best = {name: min(values) for name, values in samples.items()}
    work = min(totals)
    calib = min(calibs)
    return best, work, calib, work / calib


# ------------------------------------------------------------------ gates
class Failures(list):
    def add(self, msg: str) -> None:
        self.append(msg)

    def check(self, ok: bool, msg: str) -> bool:
        if not ok:
            self.add(msg)
        return ok


def corpus_rows(table: pa.Table) -> list[dict]:
    """Rows for the solver, with the 50 ft fit moved to the release plane.

    Mirrors ``loadPitchTable`` in the web loader: ``extension`` is nullable and
    when present the nine parameters are back-extrapolated to the hand before
    any trajectory math, so both stages solve the same parabola.
    """
    rows = table.to_pylist()
    out = []
    for row in rows:
        ext = row.get("extension")
        if isinstance(ext, float) and math.isnan(ext):
            ext = None
        out.append(extrapolate_to_release(row, ext))
    return out


def validate(rows: list[dict], table: pa.Table, failures: Failures) -> None:
    failures.check(table.num_rows > 0, "corpus is empty")
    ids = [r.get("pitch_id") for r in rows]
    failures.check(len(set(ids)) == len(ids), "duplicate pitch_id values in the corpus")
    for col in REQUIRED_COLUMNS:
        if col not in table.column_names:
            failures.add(f"missing required column {col!r}")
            continue
        nulls = table.column(col).null_count
        failures.check(nulls == 0, f"column {col!r} has {nulls} NULL values")

    crossing_errors = 0
    bound_errors: dict[str, int] = {}
    for row in rows:
        try:
            t_end = solve_flight_time(row["y0"], row["vy0"], row["ay"])
        except ValueError as exc:
            crossing_errors += 1
            failures.add(f"pitch {row.get('pitch_id')} never reaches the plate: {exc}")
            continue
        x, _, z = position_at(row, t_end)
        if (
            abs(x - row["plate_x"]) > PLATE_TOLERANCE_FT
            or abs(z - row["plate_z"]) > PLATE_TOLERANCE_FT
        ):
            crossing_errors += 1
            if crossing_errors <= 3:
                failures.add(
                    f"pitch {row.get('pitch_id')} plate crossing ({x:.4f}, {z:.4f}) "
                    f"does not match recorded ({row['plate_x']:.4f}, {row['plate_z']:.4f})"
                )
        for key, (lo, hi) in BOUNDS.items():
            value = row.get(key)
            if value is None or not math.isfinite(value) or not (lo <= value <= hi):
                bound_errors[key] = bound_errors.get(key, 0) + 1
    failures.check(crossing_errors == 0, f"{crossing_errors} pitches fail the plate-crossing check")
    for key, count in sorted(bound_errors.items()):
        failures.add(f"{count} pitches outside the physical bounds for {key}")
    failures.check(
        all(row["sz_top"] > row["sz_bot"] for row in rows),
        "sz_top <= sz_bot on at least one pitch",
    )


# ------------------------------------------------------------------ coverage
def coverage(table: pa.Table, failures: Failures) -> dict[str, int]:
    def distinct(col: str) -> int:
        if col not in table.column_names:
            return 0
        return len({v for v in table.column(col).to_pylist() if v is not None})

    complete = 0
    for col in table.column_names:
        nulls = table.column(col).null_count
        if table.num_rows and nulls / table.num_rows <= 0.01:
            complete += 1

    dims = {
        "pitches": table.num_rows,
        "games": distinct("game_id"),
        "dates": distinct("game_date"),
        "pitch_types": distinct("pitch_type"),
        "pitchers": distinct("pitcher_id"),
        "batters": distinct("batter_id"),
        "scenarios": len(SCENARIO_FILES),
        "columns_complete": complete,
    }
    for name, value in dims.items():
        failures.check(value > 0, f"coverage dimension {name!r} is zero")
    return dims


def coverage_index(dims: dict[str, int]) -> float:
    """Log-scaled breadth across every coverage dimension.

    Sublinear per dimension so padding one axis (e.g. more pitches from the same
    game) cannot buy what real breadth (games, dates, filled columns) buys.
    """
    return sum(math.log2(1 + value) for value in dims.values())


# ------------------------------------------------------------------ stages
def derive_pass(rows: list[dict]) -> float:
    """One full-corpus derivation pass; returns a checksum of the results."""
    checksum = 0.0
    for row in rows:
        traj = trajectory(row, 60)
        ghost = ghost_trajectory(row, 60)
        bv = compute_break_vector(row)
        commit = commitment_position(row)
        checksum += traj[-1][0] + traj[-1][2] + ghost[-1][2] + bv["v_break_inches"] + commit[2]
    centroids = compute_arsenal_centroids(rows)
    types = sorted(centroids)
    for i, t1 in enumerate(types):
        for t2 in types[i + 1 :]:
            checksum += compute_pitch_pair_metrics(centroids[t1], centroids[t2])["tunnel_ratio"]
    for t in types:
        checksum += tunneling_distance(centroids[t]["kinematics"], rows[0])
    dispersion = compute_release_dispersion(rows)
    checksum += dispersion["volume_cu_ft"] + len(dispersion["wireframe_segments"])
    for bucket in compute_fatigue_buckets(rows):
        checksum += bucket["delta_velocity_mph"] + bucket["whiff_pct"]
    return checksum


def parity_fixture(rows: list[dict]) -> dict:
    """Per-pitch closed-form results the TypeScript stage must reproduce."""
    entries = []
    for row in rows:
        traj = trajectory(row, 60)
        bv = compute_break_vector(row)
        commit = commitment_position(row)
        entries.append(
            {
                "pitch_id": row["pitch_id"],
                "plate_x": round(row["plate_x"], 6),
                "plate_z": round(row["plate_z"], 6),
                "terminal": [round(v, 6) for v in traj[-1]],
                "mid": [round(v, 6) for v in traj[len(traj) // 2]],
                "path_sum": round(math.fsum(v for point in traj for v in point), 6),
                "v_break_inches": round(bv["v_break_inches"], 6),
                "commitment": [round(v, 6) for v in commit],
            }
        )
    return {"pitches": entries}


def _fixed_clock() -> datetime:
    """Deterministic clock for manifest.generated_at (no wall-clock dependence)."""
    return datetime(2026, 1, 1, tzinfo=timezone.utc)


class LocalClient:
    """Offline duck-type of google.cloud.bigquery.Client for the export path."""

    def __init__(self, by_date: dict[str, pa.Table]) -> None:
        self.by_date = by_date

    def query(self, sql: str):  # mirrors the BigQuery client's shape
        match = re.search(r"DATE '(\d{4}-\d{2}-\d{2})'", sql)
        table = self.by_date[match.group(1)] if match else pa.table({})

        class Job:
            def result(self):
                class Rows:
                    def to_arrow(self):
                        return table

                return Rows()

        return Job()


def per_day_tables(table: pa.Table) -> dict[str, pa.Table]:
    days = sorted({d.isoformat() for d in table.column("game_date").to_pylist()})
    return {day: table.filter(pa.compute.equal(table.column("game_date"), date.fromisoformat(day))) for day in days}


# ------------------------------------------------------------------ main
def main() -> int:
    failures = Failures()
    out = out_dir()

    table = real_pitches()
    rows = corpus_rows(table)
    validate(rows, table, failures)
    dims = coverage(table, failures)
    index = coverage_index(dims)

    # ingest: rows -> chunked record batches -> local Arrow IPC file
    arrow_path = out / "ingest.arrow"
    batches = list(rows_to_record_batches(rows, chunk_size=5000))

    def ingest() -> None:
        for _ in range(INGEST_BATCHES):
            write_arrow(table, str(arrow_path))

    # derive: the per-pitch + aggregate analysis path
    checksums = [derive_pass(rows) for _ in range(2)]
    failures.check(
        checksums[0] == checksums[1],
        f"derive pass is not deterministic ({checksums[0]!r} != {checksums[1]!r})",
    )
    failures.check(all(math.isfinite(c) for c in checksums), "derive checksum is not finite")

    def derive() -> None:
        for _ in range(DERIVE_PASSES):
            derive_pass(rows)

    # serve: zstd Arrow IPC body + ETag, exactly as the FastAPI endpoint does
    body, etag = _serialize(table)
    failures.check(len(body) > 0 and etag.startswith('"') and etag.endswith('"'), "bad serve body/etag")

    def serve() -> None:
        for _ in range(SERVE_BATCHES):
            _serialize(table)

    # export: one partition file per game_date + manifest.json
    by_date = per_day_tables(table)
    export_dir = out / "export"
    client = LocalClient(by_date)

    def export() -> None:
        entries = []
        for day in by_date:
            path = export_batch.export_day_partition(
                date.fromisoformat(day), str(export_dir / f"{day}.arrow"), client=client
            )
            rows_written, nbytes = export_batch._rows_and_bytes(path)
            entries.append(
                {"path": os.path.basename(path), "game_date": day, "rows": rows_written, "bytes": nbytes}
            )
        export_batch.write_manifest(str(export_dir), entries, clock=_fixed_clock)

    def export_batch_run() -> None:
        for _ in range(EXPORT_BATCHES):
            export()

    stage_ms, py_work_ms, py_calib_ms, _py_ratio = measure_stages(
        {"ingest": ingest, "derive": derive, "serve": serve, "export": export_batch_run}
    )
    py_ingest_ms = stage_ms["ingest"]
    py_derive_ms = stage_ms["derive"]
    py_serve_ms = stage_ms["serve"]
    py_export_ms = stage_ms["export"]

    # export gates: every day present with the right row count, manifest indexed
    manifest_path = export_dir / export_batch.MANIFEST_NAME
    failures.check(manifest_path.exists(), "export manifest was not written")
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        entries = manifest.get("files", [])
        failures.check(len(entries) == len(by_date), "manifest entry count != corpus game dates")
        for entry in entries:
            expected = by_date[entry["game_date"]].num_rows
            failures.check(
                entry.get("rows") == expected and entry.get("bytes"),
                f"manifest entry for {entry['game_date']} is incomplete",
            )

    # The TypeScript stage parses exactly the bytes the serving endpoint sends.
    (out / "corpus.arrow").write_bytes(body)

    fixture = parity_fixture(rows)
    (out / "py_paths.json").write_text(json.dumps(fixture))
    failures.check(len(fixture["pitches"]) == table.num_rows, "parity fixture is incomplete")


    meta = {
        "coverage": dims,
        "coverage_index": index,
        "rows": table.num_rows,
        "columns": table.column_names,
        "batches": len(batches),
        "arrow_bytes": arrow_path.stat().st_size,
        "serve_bytes": len(body),
        "derive_checksum": checksums[0],
        "timings_ms": {
            "ingest": py_ingest_ms,
            "derive": py_derive_ms,
            "serve": py_serve_ms,
            "export": py_export_ms,
            "calib": py_calib_ms,
            "work": py_work_ms,
        },
    }
    (out / "py_meta.json").write_text(json.dumps(meta, indent=2, default=str))

    for name, value in dims.items():
        print(f"METRIC coverage_{name}={value}")
    print(f"METRIC coverage_index={index:.6f}")
    print(f"METRIC py_work_ms={py_work_ms:.3f}")
    print(f"METRIC py_calib_ms={py_calib_ms:.3f}")
    print(f"METRIC py_ingest_ms={py_ingest_ms:.3f}")
    print(f"METRIC py_derive_ms={py_derive_ms:.3f}")
    print(f"METRIC py_serve_ms={py_serve_ms:.3f}")
    print(f"METRIC py_export_ms={py_export_ms:.3f}")
    print(f"METRIC corpus_rows={table.num_rows}")
    print(f"METRIC corpus_columns={len(table.column_names)}")
    print(f"METRIC arrow_bytes={arrow_path.stat().st_size}")
    print(f"METRIC serve_bytes={len(body)}")
    print(f"METRIC py_checksum={checksums[0]:.6f}")

    if failures:
        for msg in failures:
            print(f"FAIL {msg}", file=sys.stderr)
        print(f"FAILURES {len(failures)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
