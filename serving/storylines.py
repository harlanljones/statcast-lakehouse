"""Read the small, versioned pitcher context catalog used by serving and BQ.

The fact schema remains untouched. Join player_id to pitcher_id and restrict
game_date to start_date/end_date. These windows are editorial context, not
claims that the event occurred on every selected date.
"""
from __future__ import annotations

import datetime as dt
import functools
import json
from pathlib import Path
from urllib.parse import urlparse

CATALOG = Path(__file__).with_name("pitcher_storylines.json")
FIELDS = {
    "storyline_id", "player_id", "player_name", "start_date", "end_date",
    "event_date", "storyline_type", "title", "summary", "source_url",
}


@functools.lru_cache(maxsize=1)
def load_storylines() -> tuple[dict, ...]:
    """Load and validate the committed catalog once per serving process."""
    rows = json.loads(CATALOG.read_text())
    if not isinstance(rows, list):
        raise ValueError("Storyline catalog must contain a list")
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != FIELDS:
            raise ValueError("Storyline catalog fields do not match dimension schema")
        if type(row["player_id"]) is not int or row["player_id"] <= 0:
            raise ValueError("Storyline player_id must be a positive MLB identifier")
        if any(not isinstance(value, str) or not value.strip()
               for key, value in row.items() if key != "player_id"):
            raise ValueError("Storyline text fields must be nonempty strings")
        for field in ("start_date", "end_date", "event_date"):
            if dt.date.fromisoformat(row[field]).isoformat() != row[field]:
                raise ValueError("Storyline dates must be YYYY-MM-DD")
        if row["start_date"] > row["end_date"]:
            raise ValueError("Storyline window is reversed")
        source = urlparse(row["source_url"])
        if source.scheme != "https" or source.hostname != "www.mlb.com":
            raise ValueError("Storylines require an HTTPS MLB primary source")
        if row["storyline_id"] in seen:
            raise ValueError("Duplicate storyline_id")
        seen.add(row["storyline_id"])
    return tuple(sorted(rows, key=lambda row: (row["event_date"], row["storyline_id"])))


if __name__ == "__main__":
    # Optional warehouse seed: emits newline-delimited JSON for a BQ batch
    # load into dim_player_storylines, using WRITE_TRUNCATE for repeatability.
    for storyline in load_storylines():
        print(json.dumps(storyline))
