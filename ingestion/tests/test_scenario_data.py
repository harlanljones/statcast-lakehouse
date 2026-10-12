"""Scenario refresh maps MLB feed context to Savant semantics (offline)."""
import pyarrow as pa

from ingestion import scenario_data
from ingestion.scenarios import SLICE_SCHEMA
from ingestion.worker import SCHEMA

COORDS = {
    "x0": -1.5, "y0": 50.0, "z0": 6.0, "vX0": 5.0, "vY0": -130.0, "vZ0": -5.0,
    "aX": -10.0, "aY": 28.0, "aZ": -20.0, "pX": 0.1, "pZ": 2.5,
}


def pitch(number, balls_after, strikes_after, desc="Ball", hit_data=None, **extra):
    """One pitch event. `extra` lands in pitchData (startSpeed, extension, ...);
    `hit_data` lands on the event, where the feed puts Savant contact data."""
    event = {
        "isPitch": True,
        "playId": f"p{number}",
        "pitchNumber": number,
        "count": {"balls": balls_after, "strikes": strikes_after, "outs": 0},
        "details": {"description": desc, "type": {"code": "FF"}},
        "pitchData": {"coordinates": COORDS, "startSpeed": 95.0, **extra},
    }
    if hit_data is not None:
        event["hitData"] = hit_data
    return event


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
                pitch(
                    1,
                    1,
                    0,
                    "In play, out(s)",
                    hit_data={
                        "launchSpeed": 104.2,
                        "launchAngle": 18.0,
                        "totalDistance": 358.0,
                        "trajectory": "line_drive",
                    },
                ),
                # Pitch-clock violation: not a pitch, but it changes the count.
                {"isPitch": False, "count": {"balls": 2, "strikes": 0, "outs": 0}},
                pitch(2, 2, 1, "Swinging Strike", extension=6.4),
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
    assert table.schema.equals(SLICE_SCHEMA)
    assert table.schema.names[: len(SCHEMA)] == SCHEMA.names
    rows = table.to_pylist()
    assert [(r["balls"], r["strikes"]) for r in rows] == [(0, 0), (2, 0)]
    assert [r["pitch_number"] for r in rows] == [1, 2]
    assert {r["at_bat_number"] for r in rows} == {5}
    assert {(r["stand"], r["p_throws"]) for r in rows} == {("L", "L")}
    assert [r["is_whiff"] for r in rows] == [0, 1]
    # Savant contact columns come from the pitch event's hitData and stay NULL
    # for every pitch that was not put in play.
    assert (rows[0]["launch_speed"], rows[0]["launch_angle"]) == (104.2, 18.0)
    assert (rows[0]["hit_distance"], rows[0]["bb_type"]) == (358.0, "line_drive")
    assert (rows[1]["launch_speed"], rows[1]["bb_type"]) == (None, None)
    # Feed extension is carried when present and NULL when absent; names ride along.
    assert [r["extension"] for r in rows] == [None, 6.4]
    assert {(r["pitcher_name"], r["batter_name"]) for r in rows} == {("Blake Snell", "Someone")}


def test_refresh_skips_pitches_without_tracking_coordinates(tmp_path, monkeypatch, capsys):
    # The feed carries a few pitches with no 9-parameter fit (untracked, e.g. a
    # position player's lob); they are skipped with a count, not fatal.
    def feed_with_untracked():
        payload = feed()
        events = payload["liveData"]["plays"]["allPlays"][0]["playEvents"]
        untracked = pitch(3, 2, 1)
        untracked["pitchData"]["coordinates"] = {"pX": 0.1, "pZ": 2.5}
        events.append(untracked)
        return payload

    monkeypatch.setattr(scenario_data, "GAME_IDS", (scenario_data.SNELL_GAME,))
    monkeypatch.setattr(scenario_data, "SCENARIO_FILES", {"snell-no-hitter": "snell.arrow"})
    monkeypatch.setattr(scenario_data, "DATA_DIR", tmp_path)
    monkeypatch.setattr(scenario_data, "_fetch", lambda game_id: feed_with_untracked())

    assert scenario_data.refresh() == {"snell-no-hitter": 2}
    table = pa.ipc.open_file(tmp_path / "snell.arrow").read_all()
    assert [r["pitch_number"] for r in table.to_pylist()] == [1, 2]
    assert "skipped 1 pitch(es) with no tracking coordinates" in capsys.readouterr().err
