"""MLB Stats API client: one game day of Statcast pitch data.

Endpoint: https://statsapi.mlb.com/api/v1/sports/1/games/{date}/... via the
statcast query endpoint used by pybaseball:
  https://baseballsavant.mlb.com/statcast_search/csv?...
We hit the JSON statcast endpoint directly to avoid the CSV layer.
"""
from __future__ import annotations

import datetime as dt
from typing import Any, Iterator

import httpx

STATCAST_URL = "https://baseballsavant.mlb.com/api/statcast/search/csv"
GAME_DAY_FMT = "%Y-%m-%d"

# Statcast CSV columns -> our warehouse columns. Kept explicit so schema
# drift upstream fails loudly here instead of silently in BigQuery.
COLUMN_MAP = {
    "pitch_id": "pitch_id",
    "game_pk": "game_id",
    "game_date": "game_date",
    "pitcher": "pitcher_id",
    "batter": "batter_id",
    "pitch_type": "pitch_type",
    "release_speed": "release_speed",
    "release_spin_rate": "release_spin_rate",
    "api_release_pos_x": "x0",
    "release_pos_y": "y0",
    "api_release_pos_z": "z0",
    "vx0": "vx0",
    "vy0": "vy0",
    "vz0": "vz0",
    "ax": "ax",
    "ay": "ay",
    "az": "az",
    "plate_x": "plate_x",
    "plate_z": "plate_z",
    "sz_top": "sz_top",
    "sz_bot": "sz_bot",
    "description": "description",
}


def _to_float(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _row(record: dict[str, Any]) -> dict[str, Any] | None:
    out: dict[str, Any] = {}
    for src, dst in COLUMN_MAP.items():
        out[dst] = _to_float(record.get(src)) if dst not in ("pitch_type", "game_date", "description") else record.get(src)
    if out.get("game_id") is None:
        return None
    out["is_swing"] = int(out.get("description") in ("swinging_strike", "foul", "hit_into_play", "swinging_strike_blocked"))
    out["is_whiff"] = int(out.get("description") == "swinging_strike")
    out.pop("description", None)
    return out


def fetch_game_day(day: dt.date, client: httpx.Client | None = None) -> Iterator[dict[str, Any]]:
    """Yield normalized rows for one game day. Paginated by the API's chunking."""
    own_client = client or httpx.Client(timeout=60)
    try:
        with own_client.stream(
            "GET",
            STATCAST_URL,
            params={"all": "true", "game_date_gt": day.isoformat(), "game_date_lt": (day + dt.timedelta(days=1)).isoformat()},
        ) as resp:
            resp.raise_for_status()
            import csv
            import io

            text = io.TextIOWrapper(resp.iter_raw(), encoding="utf-8")  # type: ignore[arg-type]
            for record in csv.DictReader(text):
                row = _row(record)
                if row is not None:
                    yield row
    finally:
        if client is None:
            own_client.close()
