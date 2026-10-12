"""Ghost trajectory vs a real no-spin integration (offline, pinned reference).

worker.ghost_kinematics keeps gravity plus the drag part of the measured
acceleration (its component along the mid-flight velocity) and the fitted
ay. The reference crossings come from pitchphys (Lyu 2022 drag, spin = 0)
for every checked-in real pitch; regenerate with
``python -m ingestion.pitchphys_reference``.

Measured 2026-10-12 over the whole checked-in corpus (20,628 pitches across 67
games): before the drag correction the ghost landed about 1.5 in low (IVB read
about 1.5 in high) and up to 2.4 in off horizontally. With it, the vertical
error median is 0.41 in, its 99.9th percentile in the normal regime (>= 50 mph)
is 2.03 in, and the horizontal error mean is 0.04 in (99.9th percentile 0.94).

The tails are where the closed form's drag term, which rides the fitted ay,
departs most from the Lyu drag model: high-spin sweepers (3.01 in vertical) and,
far worse, the sub-45 mph position-player lobs a blowout puts on the mound — up
to 9.95 in vertically on a 35.6 mph curveball, while still crossing the plate
where that pitch's own fit says it does. Every bound below is therefore either a
median/mean or a quantile, so a corpus that keeps finding a few more extreme
sweepers cannot fail the check; the loose ceilings are only there to catch a real
breakage.
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

    # The normal regime (>= 50 mph) is what the model is for: 2.03 in at the
    # 99.9th percentile and 3.01 in at the worst, both measured.
    normal = [abs(e) for e, v in zip(dz, speeds) if v >= 50]
    assert statistics.quantiles(normal, n=1000)[-1] < 2.5
    assert max(normal) < 3.5

    # The tail is the sub-45 mph position-player lobs (9.95 in measured): the
    # fitted-ay drag term departs most from the Lyu model there.
    slow = [abs(e) for e, v in zip(dz, speeds) if v < 50]
    assert slow and max(slow) < 12.0


def test_ghost_horizontal_error_is_bounded():
    dx, _, _ = ghost_errors_inches()
    assert abs(statistics.mean(dx)) < 0.25
    # 0.94 in at the 99.9th percentile and 1.09 in at the worst, both measured.
    assert statistics.quantiles([abs(e) for e in dx], n=1000)[-1] < 1.5
    assert max(abs(e) for e in dx) < 2.0
