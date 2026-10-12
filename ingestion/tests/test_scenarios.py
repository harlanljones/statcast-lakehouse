"""Curated MLB game slices: schema, provenance identity, and stable selection."""
from __future__ import annotations

import pyarrow as pa
import pytest

from ingestion import scenarios
from ingestion.worker import SCHEMA

EXPECTED_ROWS = {
    "twenty-run-night": (746011, 370),
    "ohtani-50-50": (746011, 22),
    "ohtani-50th-home-run": (746011, 4),
    "freeman-walk-off": (775300, 13),
    "snell-no-hitter": (746679, 114),
    "cardinals-dodgers-opener": (746165, 259),
    "tigers-astros-june": (746381, 357),
    "yankees-athletics-2025": (777972, 323),
    "twins-blue-jays-2026": (822829, 311),
    "season-sweep": (
        (747053, 745720, 747119, 745712, 778250, 776740, 777499, 776452, 823384, 822885, 823826, 823570),
        4063,
    ),
}


@pytest.mark.parametrize(("scenario_id", "identity"), EXPECTED_ROWS.items())
def test_scenario_is_a_stable_schema_valid_slice_of_its_real_game(scenario_id, identity):
    game_ids, row_count = identity
    expected_games = {game_ids} if isinstance(game_ids, int) else set(game_ids)
    table = scenarios.SCENARIOS[scenario_id]()
    assert table.num_rows == row_count
    assert table.schema.equals(scenarios.SLICE_SCHEMA)
    assert table.equals(scenarios.SCENARIOS[scenario_id]())
    rows = table.to_pylist()
    assert {row["game_id"] for row in rows} == expected_games
    assert len({row["pitch_id"] for row in rows}) == row_count
    assert all(len(row["pitch_id"]) == 36 for row in rows)
    assert all(not row["is_whiff"] or row["is_swing"] for row in rows)
    assert all(row["pitcher_id"] > 100_000 and row["batter_id"] > 100_000 for row in rows)


def test_slices_without_extension_or_name_columns_are_filled_with_null(tmp_path, monkeypatch):
    # Slices written before a column existed load with NULL in its place, and a
    # slice that carries the column keeps its measured values.
    table = scenarios.SCENARIOS["freeman-walk-off"]()
    legacy = table.drop_columns(["extension", "pitcher_name", "batter_name"])
    legacy_path = tmp_path / "legacy.arrow"
    with pa.ipc.new_file(str(legacy_path), legacy.schema) as writer:
        writer.write_table(legacy)

    full = table.set_column(
        table.schema.get_field_index("extension"), "extension",
        pa.array([6.5] * table.num_rows, pa.float64()),
    )
    full_path = tmp_path / "full.arrow"
    with pa.ipc.new_file(str(full_path), full.schema) as writer:
        writer.write_table(full)

    monkeypatch.setattr(scenarios, "DATA_DIR", tmp_path)
    scenarios.scenario_table.cache_clear()
    try:
        monkeypatch.setitem(scenarios.SCENARIO_FILES, "freeman-walk-off", "legacy.arrow")
        scenarios.scenario_table.cache_clear()
        filled = scenarios.scenario_table("freeman-walk-off")
        for column in ("extension", "pitcher_name", "batter_name"):
            assert filled.column(column).null_count == filled.num_rows

        monkeypatch.setitem(scenarios.SCENARIO_FILES, "freeman-walk-off", "full.arrow")
        scenarios.scenario_table.cache_clear()
        assert set(scenarios.scenario_table("freeman-walk-off").column("extension").to_pylist()) == {6.5}
    finally:
        scenarios.scenario_table.cache_clear()


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
    # Every checked-in pitch exactly once: the Ohtani slices repeat pitches that
    # the full twenty-run-night slice already carries, and overlapping slices
    # must collapse rather than double-count.
    checked_in = [
        pitch_id
        for scenario_id in scenarios.SCENARIO_FILES
        for pitch_id in scenarios.SCENARIOS[scenario_id]().column("pitch_id").to_pylist()
    ]
    assert len(checked_in) > table.num_rows  # the slices really do overlap
    assert table.num_rows == len(set(checked_in))
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
