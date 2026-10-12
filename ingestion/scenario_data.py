"""Refresh the small real-game scenario fixtures from MLB's public Stats API.

Run explicitly with ``python -m ingestion.scenario_data`` when refreshing the
checked-in slices. Normal serving and static builds read the local Arrow files
and do not use the network.
"""
from __future__ import annotations

import json
import sys
import urllib.request
from datetime import date, datetime, time, timezone
from typing import Any

import pyarrow as pa

from ingestion.scenarios import DATA_DIR, SCENARIO_FILES, SLICE_SCHEMA

# One game per period across the 2024, 2025 and 2026 seasons: the sweep slice
# is the corpus-wide view (dates, teams, pitchers and pitch types at scale).
SEASON_SWEEP_GAMES = (
    747053, 745720, 747119, 745712, 778250, 776740,
    777499, 776452, 823384, 822885, 823826, 823570,
)
GAME_IDS = (746011, 775300, 746679, 746165, 746381, 777972, 822829, *SEASON_SWEEP_GAMES)
OHTANI_GAME = 746011
FREEMAN_GAME = 775300
SNELL_GAME = 746679
CARDINALS_DODGERS_GAME = 746165
TIGERS_ASTROS_GAME = 746381
YANKEES_ATHLETICS_GAME = 777972
TWINS_BLUE_JAYS_GAME = 822829
API = "https://statsapi.mlb.com/api/v1.1/game/{game_id}/feed/live"

# Slices that take every tracked pitch of their game (breadth across seasons,
# dates, pitchers and pitch types); the rest select a batter or pitcher.
WHOLE_GAME_SCENARIOS = {
    "twenty-run-night": OHTANI_GAME,
    "cardinals-dodgers-opener": CARDINALS_DODGERS_GAME,
    "tigers-astros-june": TIGERS_ASTROS_GAME,
    "yankees-athletics-2025": YANKEES_ATHLETICS_GAME,
    "twins-blue-jays-2026": TWINS_BLUE_JAYS_GAME,
}

# Slices that span several games (every tracked pitch of each).
SWEEP_SCENARIOS = {"season-sweep": SEASON_SWEEP_GAMES}


class UntrackedPitch(ValueError):
    """A pitch the feed lists without Statcast tracking coordinates.

    The feed carries a handful of these per season (a pitch that was not
    tracked, e.g. a position player's lob). They carry no 9-parameter fit, so
    the refresh skips them and reports the count instead of failing the whole
    game.
    """


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
    if scenario_id in WHOLE_GAME_SCENARIOS:
        return game_id == WHOLE_GAME_SCENARIOS[scenario_id]
    if scenario_id in SWEEP_SCENARIOS:
        return game_id in SWEEP_SCENARIOS[scenario_id]
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


def _to_row(
    game_id: int, game_date: date, play: dict, event: dict, pre_count: dict | None = None,
) -> dict:
    details = event["details"]
    pitch = event["pitchData"]
    coordinates = pitch["coordinates"]
    description = (details.get("description") or "").casefold()
    swing = description.startswith(("foul", "in play", "swinging strike", "missed bunt"))
    whiff = description.startswith(("swinging strike", "missed bunt"))
    required = ("x0", "y0", "z0", "vX0", "vY0", "vZ0", "aX", "aY", "aZ", "pX", "pZ")
    missing = [name for name in required if coordinates.get(name) is None]
    if missing:
        raise UntrackedPitch(
            f"game {game_id} play {event.get('playId')} is missing {missing}"
        )
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
        # Savant semantics: batter/pitcher hand and the count before this pitch.
        "stand": (play["matchup"].get("batSide") or {}).get("code"),
        "p_throws": (play["matchup"].get("pitchHand") or {}).get("code"),
        "balls": (pre_count or {}).get("balls", 0),
        "strikes": (pre_count or {}).get("strikes", 0),
        "at_bat_number": play["about"]["atBatIndex"] + 1,
        "pitch_number": event.get("pitchNumber"),
        "is_swing": int(swing),
        "is_whiff": int(swing and whiff),
        "extension": pitch.get("extension"),
        "ingestion_time": day,
        "pitcher_name": play["matchup"]["pitcher"].get("fullName"),
        "batter_name": play["matchup"]["batter"].get("fullName"),
    }


def refresh() -> dict[str, int]:
    feeds = {game_id: _fetch(game_id) for game_id in GAME_IDS}
    tables: dict[str, list[dict]] = {scenario_id: [] for scenario_id in SCENARIO_FILES}
    untracked: dict[str, int] = {}
    for game_id, feed in feeds.items():
        game_date = date.fromisoformat(feed["gameData"]["datetime"]["officialDate"])
        for play in feed["liveData"]["plays"]["allPlays"]:
            # Feed counts are post-event; the prior event's count (any event
            # type, since pitch-clock violations change it too) is pre-pitch.
            pre_count: dict | None = None
            for event in play["playEvents"]:
                if event.get("isPitch") and "pitchData" in event:
                    for scenario_id in SCENARIO_FILES:
                        if _selected(scenario_id, game_id, play):
                            try:
                                row = _to_row(game_id, game_date, play, event, pre_count)
                            except UntrackedPitch as exc:
                                untracked[scenario_id] = untracked.get(scenario_id, 0) + 1
                                print(f"skipping untracked pitch: {exc}", file=sys.stderr)
                                continue
                            tables[scenario_id].append(row)
                pre_count = event.get("count") or pre_count
    for scenario_id, count in sorted(untracked.items()):
        print(
            f"note: {scenario_id} skipped {count} pitch(es) with no tracking coordinates",
            file=sys.stderr,
        )
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    counts = {}
    for scenario_id, rows in tables.items():
        if not rows:
            raise ValueError(f"scenario {scenario_id!r} selected no real pitches")
        table = pa.Table.from_pylist(rows, schema=SLICE_SCHEMA)
        path = DATA_DIR / SCENARIO_FILES[scenario_id]
        with path.open("wb") as sink:
            with pa.ipc.new_file(sink, SLICE_SCHEMA) as writer:
                writer.write_table(table)
        counts[scenario_id] = table.num_rows
    return counts


if __name__ == "__main__":
    for scenario_id, count in refresh().items():
        print(f"wrote {scenario_id}: {count} real pitches")
