"""Three-way schema-parity guard (AGENTS.md invariant).

The fct_pitches schema lives in three places and must move together:

  1. ingestion.worker.SCHEMA          — Arrow schema used by ingestion
  2. warehouse/ddl/02_fct_pitches.sql — BigQuery DDL
  3. ingestion.mlb_client.COLUMN_MAP  — upstream CSV -> schema field names

Unlike test_warehouse_sql.py (which also covers bronze/03/BQML wiring), this
file is the mechanical one-way parity guard: it re-derives everything from
the artifacts and fails loudly if any leg drifts. It is deliberately strict
about *column order* — the DDL is generated/hand-maintained alongside the
Arrow schema, and drift there is a review smell.

Type mapping is explicit; anything unmapped must be added here consciously.

GEOGRAPHY (plate_location) is DDL-only: pyarrow has no geography type, the
column is derived in SQL (03_curate_day.sql) from plate_x/plate_z, so it is
allowlisted rather than expected in worker.SCHEMA.
"""
import re
from pathlib import Path

import pyarrow as pa

from ingestion.mlb_client import COLUMN_MAP
from ingestion.worker import SCHEMA

REPO = Path(__file__).resolve().parents[2]

# DDL-only columns: no pa equivalent. plate_location is GEOGRAPHY, derived
# in warehouse SQL from plate_x/plate_z — never added to worker.SCHEMA.
DDL_ONLY = {"plate_location"}

# worker.SCHEMA fields that exist only in bronze (raw) storage, not in the
# curated fct_pitches DDL (which partitions by game_date instead).
SCHEMA_NOT_IN_FCT = {"ingestion_time"}

# Explicit BigQuery type <-> pyarrow type compatibility map.
BQ_TO_PA = {
    "STRING": pa.string(),
    "INT64": pa.int64(),
    "FLOAT64": pa.float64(),
    "DATE": pa.date32(),
    "TIMESTAMP": pa.timestamp("us", tz="UTC"),
}

# COLUMN_MAP values that are deliberate non-fct targets: "description" is an
# upstream-only aux column consumed to derive is_swing/is_whiff in
# mlb_client._row and popped before the row reaches worker.SCHEMA.
NON_FCT_TARGETS = frozenset({"description"})


def parse_ddl_columns() -> list[tuple[str, str]]:
    """Return (name, BigQuery type) for fct_pitches in declaration order.

    Known assumptions (match the sibling parser in test_warehouse_sql.py):
    the type list ends at a literal ')\\nPARTITION' with no blank line or
    comment string before it, and types are single-word tokens (the DDL
    never uses parameterized types like NUMERIC(10, 2)).
    """
    sql = (REPO / "warehouse" / "ddl" / "02_fct_pitches.sql").read_text()
    body = re.search(
        r"CREATE TABLE IF NOT EXISTS `[^`]+` \((.*?)\)\nPARTITION", sql, re.S
    ).group(1)
    cols = []
    for line in body.splitlines():
        line = line.strip().rstrip(",")
        if not line or line.startswith("--"):
            continue
        name, rest = line.split(maxsplit=1)
        cols.append((name, rest.split()[0]))
    return cols


class TestSchemaParity:
    def test_ddl_columns_match_schema_order_and_names(self):
        ddl_names = [n for n, _ in parse_ddl_columns() if n not in DDL_ONLY]
        expected = [f.name for f in SCHEMA if f.name not in SCHEMA_NOT_IN_FCT]
        assert ddl_names == expected, (
            "02_fct_pitches.sql column list/order drifted from worker.SCHEMA"
        )

    def test_ddl_types_match_schema_via_explicit_mapping(self):
        ddl = dict(parse_ddl_columns())
        for field in SCHEMA:
            if field.name in SCHEMA_NOT_IN_FCT:
                continue
            bq = ddl.get(field.name)
            assert bq is not None, f"field {field.name!r} missing from fct_pitches DDL"
            assert bq in BQ_TO_PA, f"unmapped BigQuery type {bq!r} on {field.name}"
            assert BQ_TO_PA[bq] == field.type, (
                f"{field.name}: DDL {bq} != worker.SCHEMA {field.type}"
            )

    def test_ddl_only_columns_are_allowlisted(self):
        extra = {n for n, _ in parse_ddl_columns()} - {f.name for f in SCHEMA}
        assert extra == DDL_ONLY, f"unexpected extra DDL columns: {extra}"

    def test_column_map_targets_are_schema_fields_or_allowlisted(self):
        schema_names = {f.name for f in SCHEMA}
        for src, dst in COLUMN_MAP.items():
            assert dst in schema_names or dst in NON_FCT_TARGETS, (
                f"COLUMN_MAP[{src!r}] -> {dst!r} is neither a worker.SCHEMA "
                "field nor in NON_FCT_TARGETS"
            )

    def test_every_schema_field_is_reachable_from_column_map_or_derived(self):
        # Each fct field must either be a COLUMN_MAP destination or derived
        # downstream (ingestion_time stamped in worker, is_swing/is_whiff
        # computed from description). Keep the derived set explicit.
        derived = {"is_swing", "is_whiff", "ingestion_time"}
        targets = set(COLUMN_MAP.values()) | derived
        for field in SCHEMA:
            assert field.name in targets, (
                f"{field.name} in worker.SCHEMA is never populated"
            )
