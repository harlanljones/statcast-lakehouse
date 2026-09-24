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


# ------------------------------------------------ real sample (dry-run + /pitches/sample)

def test_real_pitches_are_every_checked_in_pitch_once_in_game_order():
    table = scenarios.real_pitches()
    rows = table.to_pylist()
    assert table.schema.equals(SCHEMA)
    # The Ohtani slices are subsets of the twenty-run-night game feed.
    assert table.num_rows == 370 + 13 + 114
    assert len({row["pitch_id"] for row in rows}) == table.num_rows
    dates = [row["game_date"] for row in rows]
    assert dates == sorted(dates)
    assert scenarios.real_game_dates() == sorted(set(dates))
    assert all(not row["is_whiff"] or row["is_swing"] for row in rows)


def test_real_pitch_plate_crossings_match_their_kinematics():
    # The property the old synthetic generator broke: plate_x/plate_z must be
    # where the 9-parameter trajectory actually crosses the plate plane.
    from ingestion.worker import position_at, solve_flight_time

    for row in scenarios.real_pitches().to_pylist():
        t = solve_flight_time(row["y0"], row["vy0"], row["ay"])
        x, _, z = position_at(row, t)
        assert abs(x - row["plate_x"]) < 0.01
        assert abs(z - row["plate_z"]) < 0.01
        assert row["az"] < 0  # gravity dominates every real pitch


def test_real_pitches_limit_and_date_filter():
    import datetime as dt

    assert scenarios.real_pitches(limit=5).equals(scenarios.real_pitches().slice(0, 5))
    assert scenarios.real_pitches(limit=10**6).num_rows == scenarios.real_pitches().num_rows
    day = scenarios.real_pitches(dt.date(2024, 8, 2))
    assert day.num_rows == 114
    assert set(day.column("game_id").to_pylist()) == {746679}
    with pytest.raises(ValueError, match="2024-10-25"):
        scenarios.real_pitches(dt.date(2026, 9, 14))
