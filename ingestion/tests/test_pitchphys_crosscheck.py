"""Ghost trajectory vs a real no-spin integration (offline, pinned reference).

worker.ghost_kinematics removes spin by setting ax = 0 and az = -g while
keeping the fitted ay. That drops the drag components along x and z, so the
ghost is not quite where a spinless ball would land, and IVB/HB (actual minus
ghost) absorb the difference. The reference crossings come from pitchphys
(Lyu 2022 drag, spin = 0) for all 497 checked-in real pitches; regenerate
with ``python -m ingestion.pitchphys_reference``.

The bounds below pin today's error, measured 2026-09-25: the ghost lands
about 1.5 in low (so IVB reads about 1.5 in high) and up to about 2.4 in
off horizontally. Tighten them if the ghost gains a drag correction.
"""
import json
import statistics
from pathlib import Path

from ingestion.scenarios import real_pitches
from ingestion.worker import ghost_kinematics, position_at, solve_flight_time

REFERENCE = Path(__file__).resolve().parent / "data" / "pitchphys_ghost_reference.json"


def ghost_errors_inches() -> tuple[list[float], list[float]]:
    ref = json.loads(REFERENCE.read_text())["crossings"]
    dx, dz = [], []
    seen = set()
    for row in real_pitches().to_pylist():
        if row["pitch_id"] in seen:
            continue
        seen.add(row["pitch_id"])
        ghost = ghost_kinematics(row)
        t = solve_flight_time(ghost["y0"], ghost["vy0"], ghost["ay"])
        gx, _, gz = position_at(ghost, t)
        rx, rz = ref[row["pitch_id"]]
        dx.append((gx - rx) * 12.0)
        dz.append((gz - rz) * 12.0)
    return dx, dz


def test_reference_covers_every_real_pitch():
    ref = json.loads(REFERENCE.read_text())
    ids = {row["pitch_id"] for row in real_pitches().to_pylist()}
    assert set(ref["crossings"]) == ids
    assert (ref["source"], ref["model"], ref["forces"]) == ("pitchphys", "lyu", ["gravity", "drag"])


def test_ghost_vertical_bias_is_pinned():
    _, dz = ghost_errors_inches()
    assert -2.0 < statistics.median(dz) < -1.0
    assert max(abs(e) for e in dz) < 3.5


def test_ghost_horizontal_error_is_bounded():
    dx, _ = ghost_errors_inches()
    assert abs(statistics.mean(dx)) < 0.75
    assert max(abs(e) for e in dx) < 3.0
