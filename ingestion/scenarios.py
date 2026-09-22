"""Load the curated, real Statcast game slices used by the story examples.

The checked-in Arrow files are sourced from the MLB Stats API. Their exact
game ids, filters, source links, and story references are documented in
``data/scenarios/README.md``. No synthetic pitches are generated here.
"""
from __future__ import annotations

import argparse
import sys
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
