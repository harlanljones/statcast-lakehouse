"""Ghost trajectory vs a real no-spin integration (offline, pinned reference).

worker.ghost_kinematics keeps gravity plus the drag part of the measured
acceleration (its component along the mid-flight velocity) and the fitted
ay. The reference crossings come from pitchphys (Lyu 2022 drag, spin = 0)
for all 497 checked-in real pitches; regenerate with
``python -m ingestion.pitchphys_reference``.

Measured 2026-09-25: before the drag correction the ghost landed about
1.5 in low (IVB read about 1.5 in high) and up to 2.4 in off horizontally.
With it, the median error is under 0.3 in on both axes and horizontal error
stays under 0.9 in. The remaining gap is mostly fitted ay drag versus the
Lyu drag model, not the method.
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


def test_ghost_vertical_error_is_bounded():
    _, dz = ghost_errors_inches()
    assert abs(statistics.median(dz)) < 0.5
    assert max(abs(e) for e in dz) < 3.25


def test_ghost_horizontal_error_is_bounded():
    dx, _ = ghost_errors_inches()
    assert abs(statistics.mean(dx)) < 0.25
    assert max(abs(e) for e in dx) < 1.0
