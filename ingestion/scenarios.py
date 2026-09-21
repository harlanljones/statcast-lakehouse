"""Curated 500-pitch demo scenarios (docs/superpowers/specs/2026-09-21-scenario-demo-design.md).

Each generator is seeded and deterministic, emits worker.SCHEMA rows in pitch
order, and is physically consistent: the 9 kinematic parameters are solved so
the ball really crosses the plate at (plate_x, plate_z). Sign convention follows
Statcast / worker.compute_break_vector: az = -GRAVITY + lift, so lift > 0 is
induced vertical break and ax is horizontal break acceleration.
"""
from __future__ import annotations

import argparse
import random
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Callable

import pyarrow as pa

from ingestion.worker import (
    GRAVITY_FT_S2,
    SCHEMA,
    position_at,
    solve_commitment_time,
    solve_flight_time,
)

N_PITCHES = 500
SCENARIO_DAY = date(2026, 9, 14)
_INGESTION_TIME = datetime(2026, 9, 14, 12, 0, 0, tzinfo=timezone.utc)
_MPH_TO_FPS = 1.467

ZONE_X = 0.83  # half plate width, feet
ZONE_BOT, ZONE_TOP = 1.5, 3.5


def _row(
    rng: random.Random,
    idx: int,
    *,
    game_id: int,
    pitcher_id: int,
    pitch_type: str,
    speed: float,
    x0: float,
    y0: float = 55.0,
    z0: float,
    spin: float,
    ax: float,
    lift: float,
    plate_x: float | None = None,
    plate_z: float | None = None,
    commit_xz: tuple[float, float] | None = None,
    swing_p: float = 0.47,
    whiff_p: float = 0.25,
) -> dict:
    """One physically consistent pitch.

    Exactly one of (plate_x, plate_z) or commit_xz pins the trajectory: the
    former solves vx0/vz0 to land at the plate point, the latter to pass through
    a point on the commitment plane (plate_x/plate_z are then derived).
    """
    vy0 = -speed * _MPH_TO_FPS * 0.93
    ay = 0.0
    az = -GRAVITY_FT_S2 + lift
    if commit_xz is not None:
        tc = solve_commitment_time(y0, vy0, ay)
        vx0 = (commit_xz[0] - x0 - 0.5 * ax * tc * tc) / tc
        vz0 = (commit_xz[1] - z0 - 0.5 * az * tc * tc) / tc
    else:
        assert plate_x is not None and plate_z is not None
        t = solve_flight_time(y0, vy0, ay)
        vx0 = (plate_x - x0 - 0.5 * ax * t * t) / t
        vz0 = (plate_z - z0 - 0.5 * az * t * t) / t
    pitch = {
        "x0": x0, "y0": y0, "z0": z0, "vx0": vx0, "vy0": vy0, "vz0": vz0,
        "ax": ax, "ay": ay, "az": az,
    }
    t_end = solve_flight_time(y0, vy0, ay)
    px, _, pz = position_at(pitch, t_end)
    is_swing = int(rng.random() < swing_p)
    is_whiff = int(is_swing and rng.random() < whiff_p)
    return {
        "pitch_id": f"{game_id}-{idx:04d}",
        "game_id": game_id,
        "game_date": SCENARIO_DAY,
        "pitcher_id": pitcher_id,
        "batter_id": 500000 + (idx % 9),
        "pitch_type": pitch_type,
        "release_speed": speed,
        "release_spin_rate": spin,
        **pitch,
        "plate_x": px,
        "plate_z": pz,
        "sz_top": ZONE_TOP,
        "sz_bot": ZONE_BOT,
        "is_swing": is_swing,
        "is_whiff": is_whiff,
        "ingestion_time": _INGESTION_TIME,
    }


def _table(rows: list[dict]) -> pa.Table:
    assert len(rows) == N_PITCHES
    return pa.Table.from_pylist(rows, schema=SCHEMA)


def _pick(rng: random.Random, weighted: list[tuple[str, float]]) -> str:
    return rng.choices([w[0] for w in weighted], weights=[w[1] for w in weighted])[0]


# (speed mph, ax ft/s^2, lift ft/s^2, spin rpm)
_ARSENAL = {
    "FF": (95.0, 8.0, 17.0, 2350.0),
    "SI": (93.0, 20.0, 6.0, 2100.0),
    "SL": (86.0, -18.0, 2.0, 2450.0),
    "CU": (79.0, -9.0, -20.0, 2650.0),
    "CH": (86.0, 16.0, -4.0, 1750.0),
    "FC": (90.0, -6.0, 12.0, 2400.0),
}


def _reference_commit() -> tuple[float, float]:
    """Commitment-plane point of a nominal four-seam that lands mid-zone."""
    spd, ax, lift, _ = _ARSENAL["FF"]
    vy0 = -spd * _MPH_TO_FPS * 0.93
    az = -GRAVITY_FT_S2 + lift
    t = solve_flight_time(55.0, vy0, 0.0)
    pitch = {
        "x0": -1.7, "y0": 55.0, "z0": 5.9, "vy0": vy0, "ay": 0.0, "ax": ax, "az": az,
        "vx0": (0.0 - -1.7 - 0.5 * ax * t * t) / t,
        "vz0": (2.8 - 5.9 - 0.5 * az * t * t) / t,
    }
    x, _, z = position_at(pitch, solve_commitment_time(55.0, vy0, 0.0))
    return x, z


# Per-type offset (ft) at the commitment plane: real tunnels are close, not identical.
_TUNNEL_OFFSET = {"FF": (0.0, 0.0), "SL": (0.10, -0.06), "CH": (-0.08, -0.10)}


def tunnel_vision(seed: int = 801) -> pa.Table:
    """One arm slot, three pitches that share a commitment point then diverge."""
    rng = random.Random(seed)
    gid = 2026091401
    cx, cz = _reference_commit()
    mix = [("FF", 0.45), ("SL", 0.35), ("CH", 0.20)]
    rows = []
    for i in range(N_PITCHES):
        pt = _pick(rng, mix)
        spd, ax, lift, spin = _ARSENAL[pt]
        ox, oz = _TUNNEL_OFFSET[pt]
        rows.append(_row(
            rng, i, game_id=gid, pitcher_id=605151, pitch_type=pt,
            speed=spd + rng.gauss(0, 0.8), x0=-1.7 + rng.gauss(0, 0.04),
            z0=5.9 + rng.gauss(0, 0.04), spin=spin + rng.gauss(0, 60),
            ax=ax + rng.gauss(0, 0.8), lift=lift + rng.gauss(0, 1.0),
            commit_xz=(cx + ox + rng.gauss(0, 0.03), cz + oz + rng.gauss(0, 0.03)),
            whiff_p={"FF": 0.12, "SL": 0.38, "CH": 0.32}[pt],
        ))
    return _table(rows)


def fatigue_arc(seed: int = 802) -> pa.Table:
    """One starter over 500 pitches: velocity and arm slot sag, release scatter grows."""
    rng = random.Random(seed)
    gid = 2026091402
    mix = [("FF", 0.6), ("SL", 0.25), ("CH", 0.15)]
    rows = []
    for i in range(N_PITCHES):
        p = i / (N_PITCHES - 1)
        pt = _pick(rng, mix)
        spd, ax, lift, spin = _ARSENAL[pt]
        rows.append(_row(
            rng, i, game_id=gid, pitcher_id=543037, pitch_type=pt,
            speed=spd - 3.0 * p + rng.gauss(0, 0.6),
            x0=1.6 + rng.gauss(0, 0.04 + 0.12 * p),
            y0=55.0 + 0.3 * p,
            z0=5.9 - 0.25 * p + rng.gauss(0, 0.04 + 0.10 * p),
            spin=spin - 120 * p + rng.gauss(0, 60),
            ax=ax + rng.gauss(0, 0.8), lift=lift + rng.gauss(0, 1.0),
            plate_x=max(-2.4, min(2.4, rng.gauss(0, 0.45 + 0.45 * p))),
            plate_z=max(0.2, min(4.8, 2.5 + rng.gauss(0, 0.5 + 0.4 * p))),
            whiff_p=0.30 - 0.14 * p,
        ))
    return _table(rows)


def ghost_break(seed: int = 803) -> pa.Table:
    """Six-pitch arsenal with maximal movement spread against the no-Magnus ghost."""
    rng = random.Random(seed)
    gid = 2026091403
    mix = [("FF", 0.25), ("SI", 0.15), ("SL", 0.2), ("CU", 0.15), ("CH", 0.15), ("FC", 0.10)]
    rows = []
    for i in range(N_PITCHES):
        pt = _pick(rng, mix)
        spd, ax, lift, spin = _ARSENAL[pt]
        rows.append(_row(
            rng, i, game_id=gid, pitcher_id=592789, pitch_type=pt,
            speed=spd + rng.gauss(0, 1.0), x0=1.4 + rng.gauss(0, 0.06),
            z0=6.0 + rng.gauss(0, 0.06), spin=spin + rng.gauss(0, 80),
            ax=ax + rng.gauss(0, 1.2), lift=lift + rng.gauss(0, 1.5),
            plate_x=rng.uniform(-1.3, 1.3), plate_z=rng.uniform(1.0, 4.0),
        ))
    return _table(rows)


CHASE_BOX = (0.4, 2.0, 0.3, 1.5)  # x_min, x_max, z_min, z_max (low-and-away)


def in_chase_box(x: float, z: float) -> bool:
    return CHASE_BOX[0] <= x <= CHASE_BOX[1] and CHASE_BOX[2] <= z <= CHASE_BOX[3]


def chase_map(seed: int = 804) -> pa.Table:
    """Swings and misses cluster low-and-away, far from the zone."""
    rng = random.Random(seed)
    gid = 2026091404
    mix = [("FF", 0.3), ("SL", 0.35), ("CH", 0.2), ("CU", 0.15)]
    rows = []
    for i in range(N_PITCHES):
        pt = _pick(rng, mix)
        spd, ax, lift, spin = _ARSENAL[pt]
        roll = rng.random()
        if roll < 0.40:  # in the zone
            px = rng.uniform(-ZONE_X, ZONE_X)
            pz = rng.uniform(ZONE_BOT, ZONE_TOP)
            swing_p, whiff_p = 0.65, 0.12
        elif roll < 0.75:  # chase box, low and away
            px = rng.uniform(CHASE_BOX[0], CHASE_BOX[1])
            pz = rng.uniform(CHASE_BOX[2], CHASE_BOX[3])
            swing_p, whiff_p = 0.45, 0.60
        else:  # other misses off the plate
            px = rng.choice([-1, 1]) * rng.uniform(1.0, 1.8)
            pz = rng.uniform(2.0, 4.0)
            swing_p, whiff_p = 0.20, 0.20
        rows.append(_row(
            rng, i, game_id=gid, pitcher_id=656605, pitch_type=pt,
            speed=spd + rng.gauss(0, 1.0), x0=1.5 + rng.gauss(0, 0.05),
            z0=5.9 + rng.gauss(0, 0.05), spin=spin + rng.gauss(0, 80),
            ax=ax + rng.gauss(0, 1.0), lift=lift + rng.gauss(0, 1.0),
            plate_x=px, plate_z=pz, swing_p=swing_p, whiff_p=whiff_p,
        ))
    return _table(rows)


def contact_lab(seed: int = 805) -> pa.Table:
    """Arrival speeds from 70 to 100 mph so bat speed / attack angle reshape contact."""
    rng = random.Random(seed)
    gid = 2026091405
    mix = [("FF", 0.35), ("SI", 0.15), ("FC", 0.15), ("SL", 0.15), ("CH", 0.10), ("CU", 0.10)]
    rows = []
    for i in range(N_PITCHES):
        pt = _pick(rng, mix)
        spd, ax, lift, spin = _ARSENAL[pt]
        rows.append(_row(
            rng, i, game_id=gid, pitcher_id=621244, pitch_type=pt,
            speed=spd + rng.gauss(0, 2.0), x0=-1.5 + rng.gauss(0, 0.05),
            z0=5.8 + rng.gauss(0, 0.05), spin=spin + rng.gauss(0, 80),
            ax=ax + rng.gauss(0, 1.2), lift=lift + rng.gauss(0, 1.5),
            plate_x=rng.uniform(-0.7, 0.7), plate_z=rng.uniform(1.7, 3.3),
            swing_p=0.9, whiff_p=0.08,
        ))
    return _table(rows)


_CORPUS_PITCHERS = [  # (pitcher_id, x0, z0, arsenal)
    (100001, -2.1, 5.2, ("FF", "SL")), (100002, -1.8, 5.9, ("SI", "CH")),
    (100003, -1.2, 6.3, ("FF", "CU")), (100004, -0.6, 5.5, ("FC", "SL", "CH")),
    (100005, 0.0, 6.1, ("FF", "CH")), (100006, 0.7, 5.0, ("SI", "SL")),
    (100007, 1.3, 5.7, ("FF", "CU", "CH")), (100008, 1.9, 6.4, ("FC", "CU")),
    (100009, 2.2, 5.3, ("FF", "SL", "CH")), (100010, -1.5, 6.6, ("SI", "CU")),
]


def corpus_slice(seed: int = 806) -> pa.Table:
    """Ten pitchers, varied release points and arsenals: a mixed slice to filter."""
    rng = random.Random(seed)
    gid = 2026091406
    per = N_PITCHES // len(_CORPUS_PITCHERS)
    rows = []
    for pi, (pid, x0, z0, arsenal) in enumerate(_CORPUS_PITCHERS):
        for j in range(per):
            i = pi * per + j
            pt = arsenal[j % len(arsenal)]
            spd, ax, lift, spin = _ARSENAL[pt]
            rows.append(_row(
                rng, i, game_id=gid, pitcher_id=pid, pitch_type=pt,
                speed=spd + rng.gauss(0, 2.5), x0=x0 + rng.gauss(0, 0.06),
                z0=z0 + rng.gauss(0, 0.06), spin=spin + rng.gauss(0, 120),
                ax=ax + rng.gauss(0, 2.0), lift=lift + rng.gauss(0, 2.0),
                plate_x=rng.uniform(-1.6, 1.6), plate_z=rng.uniform(0.8, 4.2),
            ))
    return _table(rows)


SCENARIOS: dict[str, Callable[[], pa.Table]] = {
    "tunnel-vision": tunnel_vision,
    "fatigue-arc": fatigue_arc,
    "ghost-break": ghost_break,
    "chase-map": chase_map,
    "contact-lab": contact_lab,
    "corpus-slice": corpus_slice,
}


def export_scenarios(out_dir: str | Path) -> list[Path]:
    """Write every scenario as `<id>.arrow` (Arrow IPC file) for static hosting.

    Uses the same serialization as serving/app.py `_serialize`, so the files are
    byte-identical to the /pitches/scenario/{id} response bodies.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for scenario_id, build in SCENARIOS.items():
        table = build()
        path = out / f"{scenario_id}.arrow"
        with pa.ipc.new_file(str(path), table.schema) as writer:
            writer.write_table(table)
        written.append(path)
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export the demo scenarios as static Arrow files.")
    parser.add_argument("--out", required=True, help="output directory (created if missing)")
    args = parser.parse_args(argv)
    for path in export_scenarios(args.out):
        print(f"wrote {path} ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
