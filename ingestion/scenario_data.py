"""Refresh the small real-game scenario fixtures from MLB's public Stats API.

Run explicitly with ``python -m ingestion.scenario_data`` when refreshing the
checked-in slices. Normal serving and static builds read the local Arrow files
and do not use the network.
"""
from __future__ import annotations

import json
import urllib.request
from datetime import date, datetime, time, timezone
from typing import Any

import pyarrow as pa

from ingestion.scenarios import DATA_DIR, SCENARIO_FILES
from ingestion.worker import SCHEMA

GAME_IDS = (746011, 775300, 746679)
OHTANI_GAME = 746011
FREEMAN_GAME = 775300
SNELL_GAME = 746679
API = "https://statsapi.mlb.com/api/v1.1/game/{game_id}/feed/live"


def _fetch(game_id: int) -> dict[str, Any]:
    request = urllib.request.Request(
        API.format(game_id=game_id), headers={"User-Agent": "statcast-lakehouse/1.0"}
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def _selected(scenario_id: str, game_id: int, play: dict) -> bool:
    batter = play.get("matchup", {}).get("batter", {}).get("fullName")
    pitcher = play.get("matchup", {}).get("pitcher", {}).get("fullName")
    about = play.get("about", {})
    result = play.get("result", {})
    if scenario_id == "twenty-run-night":
        return game_id == 746011
    if scenario_id == "ohtani-50-50":
        return game_id == OHTANI_GAME and batter == "Shohei Ohtani"
    if scenario_id == "ohtani-50th-home-run":
        return (
            game_id == OHTANI_GAME
            and batter == "Shohei Ohtani"
            and about.get("inning") == 7
            and about.get("halfInning") == "top"
            and result.get("event") == "Home Run"
        )
    if scenario_id == "freeman-walk-off":
        return game_id == FREEMAN_GAME and batter == "Freddie Freeman"
    if scenario_id == "snell-no-hitter":
        return game_id == SNELL_GAME and pitcher == "Blake Snell"
    return False


def _to_row(game_id: int, game_date: date, play: dict, event: dict) -> dict:
    details = event["details"]
    pitch = event["pitchData"]
    coordinates = pitch["coordinates"]
    description = (details.get("description") or "").casefold()
    swing = description.startswith(("foul", "in play", "swinging strike", "missed bunt"))
    whiff = description.startswith(("swinging strike", "missed bunt"))
    required = ("x0", "y0", "z0", "vX0", "vY0", "vZ0", "aX", "aY", "aZ", "pX", "pZ")
    missing = [name for name in required if coordinates.get(name) is None]
    if missing:
        raise ValueError(f"game {game_id} play {event.get('playId')} is missing {missing}")
    day = datetime.combine(game_date, time.min, tzinfo=timezone.utc)
    return {
        "pitch_id": event["playId"],
        "game_id": game_id,
        "game_date": game_date,
        "pitcher_id": play["matchup"]["pitcher"]["id"],
        "batter_id": play["matchup"]["batter"]["id"],
        "pitch_type": (details.get("type") or {}).get("code") or "UN",
        "release_speed": pitch.get("startSpeed"),
        "release_spin_rate": (pitch.get("breaks") or {}).get("spinRate"),
        "x0": coordinates["x0"],
        "y0": coordinates["y0"],
        "z0": coordinates["z0"],
        "vx0": coordinates["vX0"],
        "vy0": coordinates["vY0"],
        "vz0": coordinates["vZ0"],
        "ax": coordinates["aX"],
        "ay": coordinates["aY"],
        "az": coordinates["aZ"],
        "plate_x": coordinates["pX"],
        "plate_z": coordinates["pZ"],
        "sz_top": pitch.get("strikeZoneTop"),
        "sz_bot": pitch.get("strikeZoneBottom"),
        "is_swing": int(swing),
        "is_whiff": int(swing and whiff),
        "ingestion_time": day,
    }


def refresh() -> dict[str, int]:
    feeds = {game_id: _fetch(game_id) for game_id in GAME_IDS}
    tables: dict[str, list[dict]] = {scenario_id: [] for scenario_id in SCENARIO_FILES}
    for game_id, feed in feeds.items():
        game_date = date.fromisoformat(feed["gameData"]["datetime"]["officialDate"])
        for play in feed["liveData"]["plays"]["allPlays"]:
            for event in play["playEvents"]:
                if not event.get("isPitch") or "pitchData" not in event:
                    continue
                for scenario_id in SCENARIO_FILES:
                    if _selected(scenario_id, game_id, play):
                        tables[scenario_id].append(_to_row(game_id, game_date, play, event))
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    counts = {}
    for scenario_id, rows in tables.items():
        if not rows:
            raise ValueError(f"scenario {scenario_id!r} selected no real pitches")
        table = pa.Table.from_pylist(rows, schema=SCHEMA)
        path = DATA_DIR / SCENARIO_FILES[scenario_id]
        with path.open("wb") as sink:
            with pa.ipc.new_file(sink, SCHEMA) as writer:
                writer.write_table(table)
        counts[scenario_id] = table.num_rows
    return counts


if __name__ == "__main__":
    for scenario_id, count in refresh().items():
        print(f"wrote {scenario_id}: {count} real pitches")
