"""Load the curated, real Statcast game slices used by the story examples.

The checked-in Arrow files are sourced from the MLB Stats API. Their exact
game ids, filters, source links, and story references are documented in
``data/scenarios/README.md``. No synthetic pitches are generated here.
"""
from __future__ import annotations

import argparse
import sys
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Callable

import pyarrow as pa

from ingestion.worker import SCHEMA

DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "scenarios"
SCENARIO_FILES = {
    "twenty-run-night": "twenty-run-night.arrow",
    "ohtani-50-50": "ohtani-50-50.arrow",
    "ohtani-50th-home-run": "ohtani-50th-home-run.arrow",
    "freeman-walk-off": "freeman-walk-off.arrow",
    "snell-no-hitter": "snell-no-hitter.arrow",
}


@lru_cache(maxsize=len(SCENARIO_FILES))
def scenario_table(scenario_id: str) -> pa.Table:
    """Read one immutable, schema-checked Statcast slice from the repository."""
    try:
        filename = SCENARIO_FILES[scenario_id]
    except KeyError:
        raise KeyError(f"unknown scenario {scenario_id!r}") from None
    path = DATA_DIR / filename
    with path.open("rb") as source:
        table = pa.ipc.open_file(source).read_all()
    if not table.schema.equals(SCHEMA):
        raise ValueError(f"{path} does not match worker.SCHEMA")
    return table


SCENARIOS: dict[str, Callable[[], pa.Table]] = {
    scenario_id: (lambda scenario_id=scenario_id: scenario_table(scenario_id))
    for scenario_id in SCENARIO_FILES
}


@lru_cache(maxsize=1)
def _all_real_pitches() -> pa.Table:
    tables = [scenario_table(scenario_id) for scenario_id in SCENARIO_FILES]
    seen: set[str] = set()
    keep: list[int] = []
    combined = pa.concat_tables(tables)
    for index, pitch_id in enumerate(combined.column("pitch_id").to_pylist()):
        if pitch_id not in seen:
            seen.add(pitch_id)
            keep.append(index)
    unique = combined.take(keep)
    # Stable sort: games in date order, pitches in their source (game) order.
    order = sorted(range(unique.num_rows), key=unique.column("game_date").to_pylist().__getitem__)
    return unique.take(order)


def real_game_dates() -> list[date]:
    """Game dates covered by the checked-in real pitches, ascending."""
    return sorted(set(_all_real_pitches().column("game_date").to_pylist()))


def real_pitches(game_day: date | None = None, limit: int | None = None) -> pa.Table:
    """Every checked-in real pitch, deduplicated by pitch_id, in game order.

    This backs ``/pitches/sample`` and ``worker --dry-run`` so neither path
    serves generated pitches. ``game_day`` keeps one game date (ValueError if
    no checked-in pitch has it); ``limit`` keeps the first N rows.
    """
    table = _all_real_pitches()
    if game_day is not None:
        keep = [i for i, d in enumerate(table.column("game_date").to_pylist()) if d == game_day]
        if not keep:
            available = ", ".join(d.isoformat() for d in real_game_dates())
            raise ValueError(f"no real pitches for {game_day.isoformat()}; available: {available}")
        table = table.take(keep)
    if limit is not None:
        table = table.slice(0, max(0, limit))
    return table


def export_scenarios(out_dir: str | Path) -> list[Path]:
    """Copy the curated scenario slices as Arrow IPC assets for static hosting."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for scenario_id, build in SCENARIOS.items():
        table = build()
        path = out / f"{scenario_id}.arrow"
        with pa.ipc.new_file(str(path), table.schema) as writer:
            writer.write_table(table)
        written.append(path)
    return written


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export real-game story slices as Arrow files.")
    parser.add_argument("--out", required=True, help="output directory (created if missing)")
    args = parser.parse_args(argv)
    for path in export_scenarios(args.out):
        print(f"wrote {path} ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
