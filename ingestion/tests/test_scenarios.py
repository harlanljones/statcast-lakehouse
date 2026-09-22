"""Curated MLB game slices: schema, provenance identity, and stable selection."""
from __future__ import annotations

import pytest

from ingestion import scenarios
from ingestion.worker import SCHEMA

EXPECTED_ROWS = {
    "twenty-run-night": (746011, 370),
    "ohtani-50-50": (746011, 22),
    "ohtani-50th-home-run": (746011, 4),
    "freeman-walk-off": (775300, 13),
    "snell-no-hitter": (746679, 114),
}


@pytest.mark.parametrize(("scenario_id", "identity"), EXPECTED_ROWS.items())
def test_scenario_is_a_stable_schema_valid_slice_of_its_real_game(scenario_id, identity):
    game_id, row_count = identity
    table = scenarios.SCENARIOS[scenario_id]()
    assert table.num_rows == row_count
    assert table.schema.equals(SCHEMA)
    assert table.equals(scenarios.SCENARIOS[scenario_id]())
    rows = table.to_pylist()
    assert {row["game_id"] for row in rows} == {game_id}
    assert len({row["pitch_id"] for row in rows}) == row_count
    assert all(len(row["pitch_id"]) == 36 for row in rows)
    assert all(not row["is_whiff"] or row["is_swing"] for row in rows)
    assert all(row["pitcher_id"] > 100_000 and row["batter_id"] > 100_000 for row in rows)


def test_registry_contains_only_documented_real_game_slices():
    assert list(scenarios.SCENARIOS) == list(EXPECTED_ROWS)


@pytest.mark.parametrize("scenario_id", EXPECTED_ROWS)
def test_scenario_rows_have_measured_kinematics_and_plate_coordinates(scenario_id):
    table = scenarios.SCENARIOS[scenario_id]()
    for column in ("release_speed", "x0", "y0", "z0", "vx0", "vy0", "vz0", "ax", "ay", "az", "plate_x", "plate_z"):
        assert table.column(column).null_count == 0
