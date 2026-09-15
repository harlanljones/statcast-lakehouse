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
    position_at,
    rows_to_record_batches,
    solve_flight_time,
    synth_day,
    trajectory,
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
