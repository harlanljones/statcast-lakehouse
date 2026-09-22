"""Export one real Statcast game with MLB names and video play identifiers.

Usage: python -m ingestion.export_real_scenario --date 2024-06-16 \
    --game-pk 746114 --out data/real-game.arrow

Only public MLB endpoints are used; no warehouse credentials are required.
Rows are ordered by at-bat and pitch number, and ingestion_time stays null
because this export has not been ingested into the warehouse.
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
from pathlib import Path
from typing import Any

import httpx
import pyarrow as pa

from ingestion import mlb_client
from ingestion.worker import SCHEMA

REAL_SCENARIO_SCHEMA = pa.schema([
    *SCHEMA,
    pa.field("play_id", pa.string()),
    pa.field("pitcher_name", pa.string()),
    pa.field("batter_name", pa.string()),
])
LIVE_FEED_URL = "https://statsapi.mlb.com/api/v1.1/game/{game_pk}/feed/live"


def build_real_scenario(day: dt.date, game_pk: int, *, client: httpx.Client) -> pa.Table:
    """Join normalized Statcast rows to pitch events, rejecting uncertain joins."""
    rows = [row for row in mlb_client.fetch_game_day(day, client=client)
            if row["game_id"] == game_pk]
    if not rows:
        raise ValueError(f"No Statcast pitches for game {game_pk} on {day}")

    response = client.get(LIVE_FEED_URL.format(game_pk=game_pk))
    response.raise_for_status()
    feed = response.json()
    if feed.get("gamePk") != game_pk:
        raise ValueError("MLB feed gamePk does not match the requested game")
    if feed.get("gameData", {}).get("datetime", {}).get("officialDate") != day.isoformat():
        raise ValueError("MLB feed officialDate does not match the requested date")

    events: dict[tuple[int, int], str] = {}
    play_ids: set[str] = set()
    for play in feed["liveData"]["plays"]["allPlays"]:
        at_bat = play["about"]["atBatIndex"] + 1
        for event in play["playEvents"]:
            if not event.get("isPitch"):
                continue
            key = (at_bat, event["pitchNumber"])
            play_id = event.get("playId")
            if not isinstance(play_id, str) or not play_id.strip():
                raise ValueError(f"Missing playId for MLB pitch {key}")
            if key in events or play_id in play_ids:
                raise ValueError(f"Ambiguous MLB pitch event {key}")
            events[key] = play_id
            play_ids.add(play_id)

    players = feed["gameData"]["players"]
    joined: dict[tuple[int, int], dict[str, Any]] = {}
    for source in rows:
        row = dict(source)
        pitch_id = row.get("pitch_id")
        match = re.fullmatch(r"(\d+)_(\d+)_(\d+)", str(pitch_id))
        if match is None or int(match[1]) != game_pk:
            raise ValueError(f"Cannot join Statcast pitch_id {pitch_id!r} to MLB pitch numbers")
        key = (int(match[2]), int(match[3]))
        if key in joined:
            raise ValueError(f"Duplicate Statcast pitch {pitch_id}")
        if key not in events:
            raise ValueError(f"Missing MLB pitch event for {pitch_id}")
        if row["game_date"] != day.isoformat():
            raise ValueError(f"Statcast date mismatch for {pitch_id}")
        row["game_date"] = day
        row["ingestion_time"] = None
        row["play_id"] = events[key]
        for role in ("pitcher", "batter"):
            player_id = row[f"{role}_id"]
            name = players.get(f"ID{player_id}", {}).get("fullName")
            if not isinstance(name, str) or not name.strip():
                raise ValueError(f"Missing MLB name for {role} {player_id}")
            row[f"{role}_name"] = name
        joined[key] = row

    return pa.Table.from_pylist([joined[key] for key in sorted(joined)], schema=REAL_SCENARIO_SCHEMA)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--date", required=True, type=dt.date.fromisoformat)
    parser.add_argument("--game-pk", required=True, type=int)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    with httpx.Client(timeout=120, follow_redirects=True) as client:
        table = build_real_scenario(args.date, args.game_pk, client=client)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with pa.ipc.new_file(str(args.out), table.schema) as writer:
        writer.write_table(table)
    print(f"Exported {table.num_rows} real pitches for {args.date}, game {args.game_pk}: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
