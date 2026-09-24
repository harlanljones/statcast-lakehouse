"""Scenario refresh maps MLB feed context to Savant semantics (offline)."""
import pyarrow as pa

from ingestion import scenario_data
from ingestion.worker import SCHEMA

COORDS = {
    "x0": -1.5, "y0": 50.0, "z0": 6.0, "vX0": 5.0, "vY0": -130.0, "vZ0": -5.0,
    "aX": -10.0, "aY": 28.0, "aZ": -20.0, "pX": 0.1, "pZ": 2.5,
}


def pitch(number, balls_after, strikes_after, desc="Ball"):
    return {
        "isPitch": True,
        "playId": f"p{number}",
        "pitchNumber": number,
        "count": {"balls": balls_after, "strikes": strikes_after, "outs": 0},
        "details": {"description": desc, "type": {"code": "FF"}},
        "pitchData": {"coordinates": COORDS, "startSpeed": 95.0},
    }


def feed():
    return {
        "gameData": {"datetime": {"officialDate": "2024-09-04"}},
        "liveData": {"plays": {"allPlays": [{
            "about": {"atBatIndex": 4, "inning": 1, "halfInning": "top"},
            "result": {},
            "matchup": {
                "pitcher": {"id": 1, "fullName": "Blake Snell"},
                "batter": {"id": 2, "fullName": "Someone"},
                "batSide": {"code": "L"},
                "pitchHand": {"code": "L"},
            },
            "playEvents": [
                pitch(1, 1, 0),
                # Pitch-clock violation: not a pitch, but it changes the count.
                {"isPitch": False, "count": {"balls": 2, "strikes": 0, "outs": 0}},
                pitch(2, 2, 1, "Swinging Strike"),
            ],
        }]}},
    }


def test_refresh_writes_pre_pitch_count_and_hands(tmp_path, monkeypatch):
    monkeypatch.setattr(scenario_data, "GAME_IDS", (scenario_data.SNELL_GAME,))
    monkeypatch.setattr(scenario_data, "SCENARIO_FILES", {"snell-no-hitter": "snell.arrow"})
    monkeypatch.setattr(scenario_data, "DATA_DIR", tmp_path)
    monkeypatch.setattr(scenario_data, "_fetch", lambda game_id: feed())

    assert scenario_data.refresh() == {"snell-no-hitter": 2}
    table = pa.ipc.open_file(tmp_path / "snell.arrow").read_all()
    assert table.schema.equals(SCHEMA)
    rows = table.to_pylist()
    assert [(r["balls"], r["strikes"]) for r in rows] == [(0, 0), (2, 0)]
    assert [r["pitch_number"] for r in rows] == [1, 2]
    assert {r["at_bat_number"] for r in rows} == {5}
    assert {(r["stand"], r["p_throws"]) for r in rows} == {("L", "L")}
    assert [r["is_whiff"] for r in rows] == [0, 1]
