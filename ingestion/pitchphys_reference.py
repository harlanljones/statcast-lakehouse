"""Regenerate the pitchphys no-spin reference for the ghost-trajectory check.

Dev-only: needs ``pip install pitchphys==0.2.0`` (numpy + scipy), which the
pipeline itself never imports. pitchphys (MIT, 2026-07-09,
github.com/jman4162/pitchphys) integrates gravity + drag (Lyu et al. 2022
drag model) from each real pitch's release state with the spin set to zero,
which is what a spinless "ghost" of that pitch would actually do.
``ingestion/tests/test_pitchphys_crosscheck.py`` compares the repo's
closed-form ghost (``worker.ghost_kinematics``) against these crossings.

Usage: python -m ingestion.pitchphys_reference
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from ingestion.scenarios import real_pitches
from ingestion.worker import PLATE_Y_FT

OUT = Path(__file__).resolve().parent / "tests" / "data" / "pitchphys_ghost_reference.json"
FT_TO_M = 0.3048


def no_spin_crossing(p: dict[str, float]) -> tuple[float, float]:
    """(plate_x, plate_z) in feet for a spinless ball with p's release state.

    pitchphys puts y = 0 at release and increases toward the plate; Statcast y
    decreases toward the plate. x and z share the catcher-view convention.
    """
    import numpy as np
    from pitchphys.core.pitch import PitchRelease
    from pitchphys.core.simulate import simulate

    v = np.array([p["vx0"], -p["vy0"], p["vz0"]]) * FT_TO_M
    speed = float(np.linalg.norm(v))
    release = PitchRelease(
        speed_m_s=speed,
        launch_angle_deg=math.degrees(math.asin(v[2] / speed)),
        horizontal_angle_deg=math.degrees(math.atan2(v[0], v[1])),
        release_pos_m=np.array([p["x0"] * FT_TO_M, 0.0, p["z0"] * FT_TO_M]),
        spin_rate_rad_s=0.0,
        spin_axis=np.array([1.0, 0.0, 0.0]),
    )
    result = simulate(
        release,
        model="lyu",
        forces=["gravity", "drag"],
        plate_distance_m=(p["y0"] - PLATE_Y_FT) * FT_TO_M,
        _baselines=False,
    )
    return result.plate_x_ft, result.plate_z_ft


def build() -> dict:
    import pitchphys

    crossings = {}
    for row in real_pitches().to_pylist():
        if row["pitch_id"] in crossings:
            continue
        x, z = no_spin_crossing(row)
        crossings[row["pitch_id"]] = [round(x, 5), round(z, 5)]
    return {
        "source": "pitchphys",
        "version": pitchphys.__version__,
        "model": "lyu",
        "forces": ["gravity", "drag"],
        "units": "ft",
        "crossings": dict(sorted(crossings.items())),
    }


if __name__ == "__main__":
    ref = build()
    OUT.write_text(json.dumps(ref, indent=1) + "\n")
    print(f"wrote {OUT} ({len(ref['crossings'])} pitches)")
