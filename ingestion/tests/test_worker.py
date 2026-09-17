"""Tests for the kinematics solver and dry-run ingestion path.

Run: python -m pytest ingestion/tests -q
"""
import datetime as dt
import math
import random

import pyarrow as pa
import pytest

from ingestion.worker import (
    SCHEMA,
    PLATE_Y_FT,
    GRAVITY_FT_S2,
    position_at,
    rows_to_record_batches,
    solve_flight_time,
    synth_day,
    trajectory,
    ghost_kinematics,
    ghost_trajectory,
    compute_break_vector,
    break_vector_segment,
    write_arrow,
)



class TestFlightTime:
    def test_reaches_plate(self):
        # 95 mph-ish: vy0 = -130 ft/s, no drag, ay = 0 -> t = (55-1.417)/130
        t = solve_flight_time(55.0, -130.0, 0.0)
        assert math.isclose(t, (55.0 - PLATE_Y_FT) / 130.0, rel_tol=1e-9)

    def test_with_acceleration(self):
        # y(t) = 55 - 130 t + 2 t^2 crossing 1.417
        t = solve_flight_time(55.0, -130.0, 4.0)
        y = 55.0 + (-130.0) * t + 0.5 * 4.0 * t * t
        assert math.isclose(y, PLATE_Y_FT, rel_tol=1e-9)

    def test_never_reaches_plate(self):
        with pytest.raises(ValueError):
            solve_flight_time(10.0, 5.0, 0.0)  # moving away

    def test_root_in_future(self):
        with pytest.raises(ValueError):
            solve_flight_time(1.0, 0.0, 0.0)  # already at plate, v=0


class TestTrajectory:
    def test_60_points_ending_at_plate(self):
        pitch = {"x0": 0.0, "y0": 55.0, "z0": 6.0,
                 "vx0": 0.0, "vy0": -130.0, "vz0": -10.0,
                 "ax": 0.0, "ay": 0.0, "az": 0.0}
        path = trajectory(pitch, n=60)
        assert len(path) == 60
        assert math.isclose(path[0][1], 55.0, rel_tol=1e-9)
        assert math.isclose(path[-1][1], PLATE_Y_FT, rel_tol=1e-6)
        # constant acceleration: z monotone decreasing here
        assert path[-1][2] < path[0][2]


class TestGhostKinematicsAndBreak:
    SLIDER = {
        "x0": -1.5, "y0": 55.0, "z0": 5.8,
        "vx0": 3.5, "vy0": -125.0, "vz0": -3.0,
        "ax": -8.0, "ay": 20.0, "az": -22.0,
    }

    def test_ghost_kinematics_clears_lateral_and_sets_gravity(self):
        ghost = ghost_kinematics(self.SLIDER)
        assert ghost["ax"] == 0.0
        assert ghost["ay"] == self.SLIDER["ay"]
        assert ghost["az"] == -GRAVITY_FT_S2
        assert ghost["x0"] == self.SLIDER["x0"]
        assert ghost["y0"] == self.SLIDER["y0"]
        assert ghost["z0"] == self.SLIDER["z0"]

    def test_ghost_trajectory_matches_plate_time(self):
        t_actual = solve_flight_time(self.SLIDER["y0"], self.SLIDER["vy0"], self.SLIDER["ay"])
        ghost = ghost_kinematics(self.SLIDER)
        t_ghost = solve_flight_time(ghost["y0"], ghost["vy0"], ghost["ay"])
        assert math.isclose(t_actual, t_ghost, rel_tol=1e-9)

        actual_path = trajectory(self.SLIDER)
        ghost_path = ghost_trajectory(self.SLIDER)
        assert len(ghost_path) == 60
        assert math.isclose(ghost_path[0][1], 55.0, rel_tol=1e-9)
        assert math.isclose(ghost_path[-1][1], PLATE_Y_FT, rel_tol=1e-6)
        assert math.isclose(actual_path[-1][1], ghost_path[-1][1], rel_tol=1e-6)

    def test_compute_break_vector_matches_nathan_definition(self):
        t_end = solve_flight_time(self.SLIDER["y0"], self.SLIDER["vy0"], self.SLIDER["ay"])
        bv = compute_break_vector(self.SLIDER)

        expected_dx_in = 0.5 * self.SLIDER["ax"] * t_end * t_end * 12.0
        expected_dz_in = 0.5 * (self.SLIDER["az"] - (-GRAVITY_FT_S2)) * t_end * t_end * 12.0

        assert math.isclose(bv["h_break_inches"], expected_dx_in, rel_tol=1e-5)
        assert math.isclose(bv["v_break_inches"], expected_dz_in, rel_tol=1e-5)
        assert math.isclose(bv["total_break_inches"], math.hypot(expected_dx_in, expected_dz_in), rel_tol=1e-5)

    def test_break_vector_segment_matches_displacement(self):
        ghost_pt, actual_pt = break_vector_segment(self.SLIDER)
        assert math.isclose(ghost_pt[1], PLATE_Y_FT, rel_tol=1e-6)
        assert math.isclose(actual_pt[1], PLATE_Y_FT, rel_tol=1e-6)

        dx = actual_pt[0] - ghost_pt[0]
        dz = actual_pt[2] - ghost_pt[2]
        bv = compute_break_vector(self.SLIDER)
        assert math.isclose(dx * 12.0, bv["h_break_inches"], rel_tol=1e-5)
        assert math.isclose(dz * 12.0, bv["v_break_inches"], rel_tol=1e-5)



class TestSynthDay:
    def test_schema_and_whiff_invariant(self):
        table = synth_day(random.Random(7), dt.date(2026, 9, 14), 500)
        assert table.schema.equals(SCHEMA)
        assert table.num_rows == 500
        whiffs = table.column("is_whiff").to_pylist()
        swings = table.column("is_swing").to_pylist()
        assert all(w == 0 for s, w in zip(swings, whiffs) if not s)

    def test_arrow_write_roundtrip(self, tmp_path):
        table = synth_day(random.Random(1), dt.date(2026, 9, 14), 50)
        out = write_arrow(table, str(tmp_path / "sub" / "day.arrow"))
        with pa.memory_map(out) as src:
            back = pa.ipc.open_file(src).read_all()
        assert back.num_rows == 50
        assert back.schema.equals(SCHEMA)


class TestBatching:
    def test_chunks_of_5000(self):
        rows = [{"i": i} for i in range(11_001)]
        sizes = [len(c) for c in rows_to_record_batches(rows, chunk_size=5000)]
        assert sizes == [5000, 5000, 1001]

    def test_empty(self):
        assert list(rows_to_record_batches([])) == []
