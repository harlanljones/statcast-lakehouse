"""Statcast ingestion worker.

Two modes:
  * live     — poll the MLB Stats API and write to BigQuery via the
               Storage Write API (COMMITTED stream, protobuf serialization).
  * dry-run  — generate a synthetic day of pitches and write an Apache Arrow
               IPC file locally. No GCP credentials, no network. This is the
               mode used by tests and local development.

Usage:
  python -m ingestion.worker --dry-run --out data/sample.arrow --pitches 200
  python -m ingestion.worker --live --date 2026-09-14   # requires GCP creds
"""
from __future__ import annotations

import argparse
import json
import math
import random
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

import pyarrow as pa

# Physical constants for the plate plane (Statcast convention, feet).
PLATE_Y_FT = 1.417

SCHEMA = pa.schema(
    [
        ("pitch_id", pa.string()),
        ("game_id", pa.int64()),
        ("game_date", pa.date32()),
        ("pitcher_id", pa.int64()),
        ("batter_id", pa.int64()),
        ("pitch_type", pa.string()),
        ("release_speed", pa.float64()),
        ("release_spin_rate", pa.float64()),
        ("x0", pa.float64()),
        ("y0", pa.float64()),
        ("z0", pa.float64()),
        ("vx0", pa.float64()),
        ("vy0", pa.float64()),
        ("vz0", pa.float64()),
        ("ax", pa.float64()),
        ("ay", pa.float64()),
        ("az", pa.float64()),
        ("plate_x", pa.float64()),
        ("plate_z", pa.float64()),
        ("sz_top", pa.float64()),
        ("sz_bot", pa.float64()),
        ("is_swing", pa.int64()),
        ("is_whiff", pa.int64()),
        ("ingestion_time", pa.timestamp("us", tz="UTC")),
    ]
)

PITCH_TYPES = ("FF", "SL", "CH", "CU", "SI", "FC", "KC", "FS")


def solve_flight_time(y0: float, vy0: float, ay: float, y_end: float = PLATE_Y_FT) -> float:
    """Solve a y(t) = y0 + vy0*t + 0.5*ay*t^2 for the crossing of y_end.

    The ball travels from y0 (~55 ft, release) toward the plate with negative
    vy0, so the larger quadratic root is the physically meaningful one.
    Raises ValueError when the discriminant is negative (ball never reaches
    the plate) or both roots are non-positive.
    """
    a = 0.5 * ay
    b = vy0
    c = y0 - y_end
    disc = b * b - 4.0 * a * c
    if disc < 0:
        raise ValueError("pitch never reaches the plate plane (negative discriminant)")
    if abs(a) < 1e-12:  # degenerate: constant-velocity fit
        if b == 0:
            raise ValueError("degenerate pitch: y is constant")
        t = -c / b
        if t <= 0 or b > 0:
            raise ValueError("pitch plane crossing is not in the future")
        return t
    roots = sorted(
        t for t in ((-b - math.sqrt(disc)) / (2.0 * a), (-b + math.sqrt(disc)) / (2.0 * a))
        if t > 0 and b + 2.0 * a * t < 0
    )
    if not roots:
        raise ValueError("pitch plane crossing is not in the future")
    return roots[0]


def position_at(pitch: dict[str, float], t: float) -> tuple[float, float, float]:
    """Constant-acceleration (9-parameter) position at time t, in feet."""
    return (
        pitch["x0"] + pitch["vx0"] * t + 0.5 * pitch["ax"] * t * t,
        pitch["y0"] + pitch["vy0"] * t + 0.5 * pitch["ay"] * t * t,
        pitch["z0"] + pitch["vz0"] * t + 0.5 * pitch["az"] * t * t,
    )


def trajectory(pitch: dict[str, float], n: int = 60) -> list[tuple[float, float, float]]:
    """n points from release to the plate plane (Statcast's 60-point path)."""
    t_end = solve_flight_time(pitch["y0"], pitch["vy0"], pitch["ay"])
    return [position_at(pitch, t_end * i / (n - 1)) for i in range(n)]


def synth_pitch(rng: random.Random, game_id: int, game_day: date, i: int) -> dict[str, Any]:
    """A plausible synthetic pitch in Statcast coordinate space.

    x: catcher's right (+), y: distance from plate, z: height above plate.
    Release ~ (-1.5..1.5 ft, 55 ft, 5.5 ft), typical MLB accelerations.
    """
    pt = rng.choice(PITCH_TYPES)
    speed = rng.uniform(72, 100)
    vy0 = -speed * 1.467 * rng.uniform(0.88, 0.97)  # mph -> ft/s, avg over flight
    flight = 55.0 / abs(vy0)
    ax = rng.uniform(-14, 14)  # horizontal break acceleration
    az = 32.174 + rng.uniform(-10, 25)  # gravity + lift
    whiff = rng.random() < 0.25
    return {
        "pitch_id": f"{game_id}-{i:04d}",
        "game_id": game_id,
        "game_date": game_day,
        "pitcher_id": rng.randint(110000, 699999),
        "batter_id": rng.randint(110000, 699999),
        "pitch_type": pt,
        "release_speed": speed,
        "release_spin_rate": rng.uniform(1400, 3200),
        "x0": rng.uniform(-1.8, 1.8),
        "y0": 55.0,
        "z0": rng.uniform(4.5, 6.5),
        "vx0": rng.uniform(-12, 12),
        "vy0": vy0,
        "vz0": rng.uniform(-8, 4),
        "ax": ax,
        "ay": 0.0,  # Statcast fits use constant ay=0 in the y polynomial
        "az": az,
        "plate_x": rng.uniform(-2.0, 2.0),
        "plate_z": rng.uniform(0.8, 3.8),
        "sz_top": 3.4,
        "sz_bot": 1.5,
        "is_swing": int(rng.random() < 0.47),
        "is_whiff": 0,
        "ingestion_time": datetime.now(timezone.utc),
    }


def synth_day(rng: random.Random, game_day: date, n_pitches: int) -> pa.Table:
    """One synthetic game day; whiffs only on swings, as in the real data."""
    rows = []
    game_id = int(game_day.strftime("%Y%m%d")) * 100 + 1
    for i in range(n_pitches):
        p = synth_pitch(rng, game_id, game_day, i)
        if p["is_swing"]:
            p["is_whiff"] = int(rng.random() < 0.25)
        rows.append(p)
    return pa.Table.from_pylist(rows, schema=SCHEMA)


def rows_to_record_batches(rows: Iterable[dict[str, Any]], chunk_size: int = 5000):
    """Chunk rows for Storage Write protobuf batches (TDD §3.2: 5,000/chunk)."""
    chunk: list[dict[str, Any]] = []
    for row in rows:
        chunk.append(row)
        if len(chunk) >= chunk_size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def write_arrow(table: pa.Table, out_path: str) -> str:
    import os

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with pa.OSFile(out_path, "wb") as sink:
        with pa.ipc.new_file(sink, table.schema) as writer:
            writer.write_table(table)
    return out_path


def write_bq(rows: Iterable[dict[str, Any]], project: str, table: str) -> int:
    """Live path: BigQuery Storage Write API, COMMITTED stream, protobuf.

    Costs nothing on the free tier (2 TB/mo write allowance) unlike legacy
    `tabledata.insertAll`. Imported lazily so dry-run needs no GCP deps.
    """
    from google.cloud import bigquery
    from google.cloud.bigquery_storage_v1 import BigQueryWriteClient
    from google.cloud.bigquery_storage_v1 import types as bq_types

    write_client = BigQueryWriteClient()
    parent = write_client.table_path(project, "statcast_analytics", table)
    stream = f"{parent}/streams/_default"
    n = 0
    for chunk in rows_to_record_batches(rows):
        from google.cloud.bigquery_storage_v1 import pb2 as storage_pb2

        proto_rows = storage_pb2.ProtoRows()
        proto_rows.serialized_rows.extend(json.dumps(r).encode() for r in chunk)
        request = bq_types.AppendRowsRequest()
        request.write_stream = stream
        request.proto_rows.serialized_rows.extend(proto_rows.serialized_rows)
        write_client.append_rows(iter([request])).result()
        n += len(chunk)
    return n


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="synthetic day -> local Arrow file")
    ap.add_argument("--live", action="store_true", help="MLB API -> BigQuery Storage Write")
    ap.add_argument("--date", default=str(date.today() - timedelta(days=1)))
    ap.add_argument("--pitches", type=int, default=300)
    ap.add_argument("--out", default="data/sample.arrow")
    ap.add_argument("--project", default=None, help="GCP project (live mode)")
    args = ap.parse_args(argv)

    game_day = date.fromisoformat(args.date)
    if args.dry_run or not args.live:
        rng = random.Random(2026)
        table = synth_day(rng, game_day, args.pitches)
        path = write_arrow(table, args.out)
        print(f"wrote {table.num_rows} pitches -> {path}")
        return 0
    if not args.project:
        ap.error("--live requires --project")
    from ingestion.mlb_client import fetch_game_day

    rows = fetch_game_day(game_day)
    n = write_bq(rows, args.project, "bronze_pitches")
    print(f"wrote {n} pitches -> {args.project}.statcast_analytics.bronze_pitches")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
