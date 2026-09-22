"""Offline contract tests for the public real-game demo exporter."""
import copy
import datetime as dt

import httpx
import pyarrow as pa
import pytest

from ingestion import export_real_scenario as exporter
from ingestion.worker import SCHEMA

DAY = dt.date(2024, 6, 16)
GAME_PK = 123456


@pytest.fixture
def inputs(monkeypatch):
    rows = [
        {"pitch_id": f"{GAME_PK}_{at_bat}_{pitch}", "game_id": GAME_PK,
         "game_date": DAY.isoformat(), "pitcher_id": 100, "batter_id": 200,
         "release_speed": 97.5, "pitch_type": "FF"}
        for at_bat, pitch in [(10, 2), (2, 1), (10, 1)]
    ]
    rows.append({"game_id": 999})  # Other games are ignored before joining.
    feed = {
        "gamePk": GAME_PK,
        "gameData": {"datetime": {"officialDate": DAY.isoformat()}, "players": {
            "ID100": {"fullName": "Pitcher Name"}, "ID200": {"fullName": "Batter Name"},
        }},
        "liveData": {"plays": {"allPlays": [
            {"about": {"atBatIndex": ab - 1}, "playEvents": [
                {"isPitch": False, "pitchNumber": 1},
                *[{"isPitch": True, "pitchNumber": pitch, "playId": f"play-{ab}-{pitch}"}
                  for pitch in pitches],
            ]}
            for ab, pitches in [(2, [1]), (10, [1, 2])]
        ]}},
    }

    def fetch(day, client):
        assert day == DAY
        return iter(copy.deepcopy(rows))

    monkeypatch.setattr(exporter.mlb_client, "fetch_game_day", fetch)
    return rows, feed


def build(feed):
    def handler(request):
        assert str(request.url) == exporter.LIVE_FEED_URL.format(game_pk=GAME_PK)
        return httpx.Response(200, json=feed)
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        return exporter.build_real_scenario(DAY, GAME_PK, client=client)


def test_schema_order_names_and_play_ids(inputs):
    _, feed = inputs
    table = build(feed)
    assert table.schema == exporter.REAL_SCENARIO_SCHEMA
    assert pa.schema(list(table.schema)[:len(SCHEMA)]) == SCHEMA
    assert table["pitch_id"].to_pylist() == ["123456_2_1", "123456_10_1", "123456_10_2"]
    assert table["play_id"].to_pylist() == ["play-2-1", "play-10-1", "play-10-2"]
    assert table["pitcher_name"].to_pylist() == ["Pitcher Name"] * 3
    assert table["batter_name"].to_pylist() == ["Batter Name"] * 3
    assert table["game_date"].to_pylist() == [DAY] * 3
    assert table["ingestion_time"].to_pylist() == [None] * 3
    assert table["release_speed"].to_pylist() == [97.5] * 3


@pytest.mark.parametrize("failure", ["no_rows", "numeric_id", "duplicate_row", "missing_event",
    "duplicate_event", "duplicate_play_id", "missing_play_id", "missing_name", "wrong_game", "wrong_date", "row_date"])
def test_rejects_uncertain_joins(inputs, failure):
    rows, feed = inputs
    plays = feed["liveData"]["plays"]["allPlays"]
    if failure == "no_rows":
        rows.clear()
    elif failure == "numeric_id":
        rows[0]["pitch_id"] = "987654321"
    elif failure == "duplicate_row":
        rows.append(rows[0])
    elif failure == "missing_event":
        plays[1]["playEvents"].pop()
    elif failure == "duplicate_event":
        plays[1]["playEvents"].append(plays[1]["playEvents"][-1])
    elif failure == "duplicate_play_id":
        plays[1]["playEvents"][-1]["playId"] = "play-2-1"
    elif failure == "missing_play_id":
        plays[1]["playEvents"][-1].pop("playId")
    elif failure == "missing_name":
        feed["gameData"]["players"].pop("ID100")
    elif failure == "wrong_game":
        feed["gamePk"] = 9
    elif failure == "wrong_date":
        feed["gameData"]["datetime"]["officialDate"] = "2024-06-17"
    elif failure == "row_date":
        rows[0]["game_date"] = "2024-06-17"
    with pytest.raises(ValueError):
        build(feed)


def test_cli_writes_deterministic_arrow(inputs, monkeypatch, tmp_path):
    _, feed = inputs
    client_type = httpx.Client
    monkeypatch.setattr(exporter.httpx, "Client", lambda **kwargs: client_type(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=feed))))
    path = tmp_path / "nested" / "real.arrow"
    args = ["--date", DAY.isoformat(), "--game-pk", str(GAME_PK), "--out", str(path)]
    assert exporter.main(args) == 0
    first = path.read_bytes()
    assert exporter.main(args) == 0
    assert path.read_bytes() == first
    with pa.ipc.open_file(str(path)) as reader:
        assert reader.read_all().num_rows == 3
        assert reader.schema == exporter.REAL_SCENARIO_SCHEMA


def test_http_failure_propagates(inputs):
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(503))) as client:
        with pytest.raises(httpx.HTTPStatusError):
            exporter.build_real_scenario(DAY, GAME_PK, client=client)
