"""Ghost trajectory vs a real no-spin integration (offline, pinned reference).

worker.ghost_kinematics keeps gravity plus the drag part of the measured
acceleration (its component along the mid-flight velocity) and the fitted
ay. The reference crossings come from pitchphys (Lyu 2022 drag, spin = 0)
for every checked-in real pitch; regenerate with
``python -m ingestion.pitchphys_reference``.

Measured 2026-10-12 over the whole checked-in corpus (18,722 pitches across 61
games): before the drag correction the ghost landed about 1.5 in low (IVB read
about 1.5 in high) and up to 2.4 in off horizontally. With it, the vertical
error median is 0.41 in and the horizontal error mean is 0.03 in (median 0.05).
The tails are the regimes where the closed form's drag term, which rides the
fitted ay, departs most from the Lyu drag model: high-spin sweepers (about 3 in
vertical) and, far worse, the sub-45 mph position-player lobs a blowout puts on
the mound — a 35.6 mph curveball in the Athletics' 18-3 rout reads 7.35 in high
vertically while still crossing the plate where the fit says it does. That model
mismatch, not the method, is what the bounds below leave room for; the median and
mean bounds are the ones that would catch a real regression.
"""
import json
import statistics
from pathlib import Path

from ingestion.scenarios import real_pitches
from ingestion.worker import ghost_kinematics, position_at, solve_flight_time

REFERENCE = Path(__file__).resolve().parent / "data" / "pitchphys_ghost_reference.json"


def ghost_errors_inches() -> tuple[list[float], list[float], list[float]]:
    """Per-pitch (dx, dz, release_speed) ghost error in inches, corpus order."""
    ref = json.loads(REFERENCE.read_text())["crossings"]
    dx, dz, speeds = [], [], []
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
        speeds.append(float(row["release_speed"]))
    return dx, dz, speeds


def test_reference_covers_every_real_pitch():
    ref = json.loads(REFERENCE.read_text())
    ids = {row["pitch_id"] for row in real_pitches().to_pylist()}
    assert set(ref["crossings"]) == ids
    assert (ref["source"], ref["model"], ref["forces"]) == ("pitchphys", "lyu", ["gravity", "drag"])


def test_ghost_vertical_error_is_bounded():
    _, dz, speeds = ghost_errors_inches()
    assert abs(statistics.median(dz)) < 0.5
    # The normal regime (>= 50 mph) is what the model is for: 2.68 in measured.
    assert max(abs(e) for e, v in zip(dz, speeds) if v >= 50) < 3.0
    # Tail bound for the sub-45 mph position-player lobs a blowout puts on the
    # mound: 7.35 in measured on a 35.6 mph curveball.
    assert max(abs(e) for e in dz) < 8.0


def test_ghost_horizontal_error_is_bounded():
    dx, _, _ = ghost_errors_inches()
    assert abs(statistics.mean(dx)) < 0.25
    assert max(abs(e) for e in dx) < 1.25
