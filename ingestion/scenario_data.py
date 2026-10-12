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

# Six games where the two staffs combined for 20+ strikeouts, one per date and
# one per period across the 2024, 2025 and 2026 seasons: the whiff-heavy end of
# the corpus (20-24 strikeouts, 33-48 whiffs each).
STRIKEOUT_NIGHTS_GAMES = (746576, 747029, 745042, 778440, 776190, 823525)

# Six games that went past nine innings, one per date across the 2024, 2025 and
# 2026 seasons (10 to 12 innings, 65 innings in all): the long-game end of the
# corpus, where bullpens and late-inning leverage show up.
EXTRA_INNINGS_GAMES = (745103, 745707, 745203, 777642, 777014, 824125)

# Six games with four or more combined home runs, one per date across the 2024,
# 2025 and 2026 seasons (32 home runs in all, including an eight-homer night):
# the batted-ball end of the corpus, where the contact columns earn their keep.
POWER_NIGHTS_GAMES = (745163, 746038, 777873, 825014, 823364, 824644)

# Six games decided by the final swing, one per date across the 2024, 2025 and
# 2026 seasons — all six went to extra innings, and four were one-run games.
WALK_OFF_GAMES = (746447, 747072, 777415, 776347, 824516, 824669)

# Six games decided by one run with both teams scoring six or more, one per date
# across the 2024, 2025 and 2026 seasons: 104 runs in all, the slugfest end of
# the one-run games.
ONE_RUN_SLUGFEST_GAMES = (745505, 746362, 746108, 778247, 777701, 823776)

# Six games with three runs or fewer — four 1-0 finals and two 2-0 — one per date
# across the 2024, 2025 and 2026 seasons: eight runs in all, the pitching end of
# the corpus.
PITCHERS_DUEL_GAMES = (745192, 746472, 776669, 825091, 823780, 824394)

# Six games in which at least one hitter homered twice, one per date across the
# 2024, 2025 and 2026 seasons (34 home runs in all, including two nine-homer
# games and two three-homer performances).
MULTI_HOMER_GAMES = (745113, 745551, 778339, 777403, 777129, 823463)

# Six games featuring a grand slam, one per date across the 2024, 2025 and 2026
# seasons (one of them, the Cubs' 19-2 win in Seattle, had two).
GRAND_SLAM_GAMES = (745092, 744926, 777077, 825006, 823354, 823099)

# Six games turned by one big inning (six runs or more), one per date across the
# 2024, 2025 and 2026 seasons: 43 runs in those six innings alone, including two
# eight-run frames and a seven-run eighth that won a one-run game.
BIG_INNING_GAMES = (746001, 747008, 746517, 776794, 776428, 822940)

# Six games in which the starting pitcher struck out at least ten, one per date
# across the 2024, 2025 and 2026 seasons: twelve to fourteen each, 75 in all.
STRIKEOUT_START_GAMES = (746691, 746356, 777692, 777217, 776317, 824794)

# Six games in which the winning team trailed by three or four runs and still
# won inside nine innings, one per date across the 2024, 2025 and 2026 seasons.
COMEBACK_GAMES = (746085, 747059, 778490, 778472, 822758, 823569)

# Six regulation games in which a team made three or more errors, one per date
# across the 2024, 2025 and 2026 seasons (24 errors in all).
MULTI_ERROR_GAMES = (745598, 746330, 778463, 778379, 823646, 823481)

# Six games in which one team scored in seven or more different innings
# (three of them in eight), one per date across the three seasons.
INNING_AFTER_INNING_GAMES = (744954, 745734, 776533, 777331, 824354, 824089)

# Six games called before nine innings, one per date across the three seasons:
# five for rain, one (Blue Jays at Royals 2024-04-25) for wet grounds. The
# shortest lasted 93 minutes and 143 pitches; 37 innings in all.
CALLED_EARLY_GAMES = (746320, 745890, 778370, 777474, 778189, 824807)

# Twelve games in which a team was shut out, four per season and one per date.
# Every one of them was a *combined* shutout (no starter went the distance),
# including five 1-0 finals, and each needed fewer pitches than a typical game
# because a shutout means fewer baserunners.
SHUTOUT_GAMES = (
    746329, 746654, 745195, 745029,
    778468, 778416, 778402, 778352,
    825106, 824459, 823886, 823235,
)

# Twelve games decided by nine runs or more, four per season and one per date
# (179 runs in all, margins 9-16). Four of them had an arm that never topped
# 75 mph as the game ran away — the slowest a 43.8 mph pitch with the Braves
# 17 runs ahead at Arizona on 2026-04-02.
BLOWOUT_GAMES = (
    746327, 746323, 745110, 745352,
    778432, 778382, 778328, 778309,
    825105, 824938, 823477, 823476,
)
GAME_IDS = (
    746011, 775300, 746679, 746165, 746381, 777972, 822829,
    *SEASON_SWEEP_GAMES,
    *STRIKEOUT_NIGHTS_GAMES,
    *EXTRA_INNINGS_GAMES,
    *POWER_NIGHTS_GAMES,
    *WALK_OFF_GAMES,
    *ONE_RUN_SLUGFEST_GAMES,
    *PITCHERS_DUEL_GAMES,
    *MULTI_HOMER_GAMES,
    *GRAND_SLAM_GAMES,
    *BIG_INNING_GAMES,
    *STRIKEOUT_START_GAMES,
    *COMEBACK_GAMES,
    *MULTI_ERROR_GAMES,
    *INNING_AFTER_INNING_GAMES,
    *CALLED_EARLY_GAMES,
    *SHUTOUT_GAMES,
    *BLOWOUT_GAMES,
)
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
SWEEP_SCENARIOS = {
    "season-sweep": SEASON_SWEEP_GAMES,
    "strikeout-nights": STRIKEOUT_NIGHTS_GAMES,
    "extra-innings": EXTRA_INNINGS_GAMES,
    "power-nights": POWER_NIGHTS_GAMES,
    "walk-off-wins": WALK_OFF_GAMES,
    "one-run-slugfests": ONE_RUN_SLUGFEST_GAMES,
    "pitchers-duels": PITCHERS_DUEL_GAMES,
    "multi-homer-nights": MULTI_HOMER_GAMES,
    "grand-slams": GRAND_SLAM_GAMES,
    "big-innings": BIG_INNING_GAMES,
    "strikeout-starts": STRIKEOUT_START_GAMES,
    "comeback-wins": COMEBACK_GAMES,
    "multi-error-games": MULTI_ERROR_GAMES,
    "inning-after-inning": INNING_AFTER_INNING_GAMES,
    "called-early": CALLED_EARLY_GAMES,
    "combined-shutouts": SHUTOUT_GAMES,
    "blowouts": BLOWOUT_GAMES,
}


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
    # Savant contact columns: the feed attaches hitData to the pitch event that
    # was put in play (NULL on every other pitch).
    hit = event.get("hitData") or {}
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
        "launch_speed": hit.get("launchSpeed"),
        "launch_angle": hit.get("launchAngle"),
        "hit_distance": hit.get("totalDistance"),
        "bb_type": hit.get("trajectory"),
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
