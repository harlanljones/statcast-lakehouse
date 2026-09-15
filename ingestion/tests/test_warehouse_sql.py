"""Static verification of warehouse DDL and BQML SQL against the code schemas.

BigQuery is not reachable in tests (AGENTS.md: everything runs offline), so
these tests parse the SQL files and enforce the AGENTS.md invariant: the
fct_pitches schema lives in three places (worker.SCHEMA, 02_fct_pitches.sql,
mlb_client.COLUMN_MAP) and must stay consistent, with 03_curate_day.sql and
the BQML feature lists wired to the same columns.
"""
import datetime as dt
import re
from pathlib import Path

import pyarrow as pa

from ingestion.mlb_client import COLUMN_MAP
from ingestion.worker import SCHEMA

REPO = Path(__file__).resolve().parents[2]
DDL = REPO / "warehouse" / "ddl"
BQML = REPO / "warehouse" / "bqml"


def read(path: Path) -> str:
    return path.read_text()


def fct_columns_from_ddl() -> dict[str, str]:
    sql = read(DDL / "02_fct_pitches.sql")
    body = re.search(r"CREATE TABLE IF NOT EXISTS `[^`]+` \((.*?)\)\nPARTITION", sql, re.S).group(1)
    cols = {}
    for line in body.splitlines():
        line = line.strip().rstrip(",")
        if not line or line.startswith("--"):
            continue
        name, typ = line.split(maxsplit=1)
        cols[name] = typ.split()[0]
    return cols


# ---------------------------------------------------------------- fct_pitches


class TestFctPitchesSchema:
    # fct_pitches drops the bronze-only ingestion_time column (partitioned by
    # game_date instead) and adds the derived plate_location.
    FCT_ONLY_DROP = {"ingestion_time"}

    def fct_expected(self):
        return [f for f in SCHEMA if f.name not in self.FCT_ONLY_DROP]

    def test_ddl_covers_worker_schema(self):
        cols = fct_columns_from_ddl()
        for field in self.fct_expected():
            assert field.name in cols, f"{field.name} missing from 02_fct_pitches.sql"

    def test_ddl_types_match_worker_schema(self):
        bq_type = {
            pa.string(): "STRING",
            pa.int64(): "INT64",
            pa.float64(): "FLOAT64",
            pa.date32(): "DATE",
            pa.timestamp("us", tz="UTC"): "TIMESTAMP",
        }
        cols = fct_columns_from_ddl()
        for field in self.fct_expected():
            assert cols[field.name] == bq_type[field.type], field.name

    def test_extra_ddl_column_is_plate_location(self):
        extra = set(fct_columns_from_ddl()) - {f.name for f in SCHEMA} | self.FCT_ONLY_DROP
        assert extra == {"plate_location", "ingestion_time"}

    def test_not_null_keys(self):
        sql = read(DDL / "02_fct_pitches.sql")
        for name in ("pitch_id", "game_id", "game_date", "pitcher_id", "batter_id"):
            assert re.search(rf"\b{name} \w+ NOT NULL", sql), name

    def test_partition_and_cluster_directives(self):
        sql = read(DDL / "02_fct_pitches.sql")
        assert "PARTITION BY game_date" in sql
        assert "CLUSTER BY pitcher_id, batter_id, pitch_type" in sql
        assert "require_partition_filter = TRUE" in sql

    def test_column_map_destinations_in_worker_schema(self):
        # AGENTS.md invariant, third leg: every mapped destination is a real
        # worker.SCHEMA column (description folds into is_swing/is_whiff).
        schema_names = {f.name for f in SCHEMA}
        for src, dst in COLUMN_MAP.items():
            assert dst in schema_names or dst == "description", (src, dst)

    def test_column_map_roundtrip_via_row(self):
        # The mapped row must be writable directly into worker.SCHEMA once the
        # derived flags are computed — proving the three definitions agree.
        from ingestion.mlb_client import _row as map_row

        record = {
            "pitch_id": "7482193045",
            "game_pk": "776123",
            "game_date": "2026-09-14",
            "pitcher": "502043",
            "batter": "665489",
            "pitch_type": "FF",
            "release_speed": "97.4",
            "release_spin_rate": "2341",
            "api_release_pos_x": "-0.682",
            "release_pos_y": "54.867",
            "api_release_pos_z": "5.612",
            "vx0": "7.432",
            "vy0": "-138.215",
            "vz0": "-5.877",
            "ax": "7.411",
            "ay": "6.283",
            "az": "-22.918",
            "plate_x": "-0.314",
            "plate_z": "2.418",
            "sz_top": "3.417",
            "sz_bot": "1.543",
            "description": "swinging_strike",
        }
        row = map_row(record)
        row["game_date"] = dt.date.fromisoformat(row["game_date"])  # Arrow date32
        row["ingestion_time"] = dt.datetime.now(dt.timezone.utc)
        table = pa.Table.from_pylist([row], schema=SCHEMA)
        assert table.num_rows == 1


# -------------------------------------------------------------- bronze & 03


class TestBronzeAndCurateDay:
    def test_bronze_columns_match_worker_schema(self):
        sql = read(DDL / "01_bronze_pitches.sql")
        body = re.search(r"CREATE TABLE IF NOT EXISTS `[^`]+` \((.*?)\)\nPARTITION", sql, re.S).group(1)
        ddl_cols = [
            line.strip().rstrip(",").split()[0]
            for line in body.splitlines()
            if line.strip() and not line.strip().startswith("--")
        ]
        assert ddl_cols == [f.name for f in SCHEMA]

    def test_bronze_partitioned_by_ingestion_time(self):
        sql = read(DDL / "01_bronze_pitches.sql")
        assert "PARTITION BY DATE(ingestion_time)" in sql
        assert "require_partition_filter = TRUE" in sql

    def test_curate_day_selects_all_schema_columns(self):
        sql = read(DDL / "03_curate_day.sql")
        schema_names = {f.name for f in SCHEMA} - {"ingestion_time"}
        # bronze alias b must expose every carried-forward SCHEMA column
        # (plate_location is derived in the SELECT, not carried from bronze).
        select_block = re.search(r"USING \(\s*SELECT(.*?)FROM", sql, re.S).group(1)
        selected = {
            tok.strip()
            for tok in re.split(r"[,\n]", select_block)
            if tok.strip() and not tok.strip().startswith("--")
        }
        for name in schema_names:
            assert name in selected, name
        assert "ST_GEOGPOINT(plate_x, plate_z) AS plate_location" in sql

    def test_curate_day_is_idempotent_merge(self):
        sql = read(DDL / "03_curate_day.sql")
        assert "MERGE `statcast_analytics.fct_pitches`" in sql
        assert "WHEN NOT MATCHED THEN" in sql
        # Parametrized on the partition date, per the scan-budget convention.
        assert "@target_date" in sql
        assert "DATE(ingestion_time) = @target_date" in sql


# --------------------------------------------------------------------- BQML


class TestBqml:
    def test_model_files_exist_and_nonempty(self):
        for f in (BQML / "train_whiff_model.sql", BQML / "predict_live_game.sql"):
            assert f.exists() and f.stat().st_size > 0

    def test_train_model_config(self):
        sql = read(BQML / "train_whiff_model.sql")
        assert "CREATE OR REPLACE MODEL `statcast_analytics.model_pitch_whiff`" in sql
        assert "model_type = 'BOOSTED_TREE_CLASSIFIER'" in sql
        assert "input_label_cols = ['is_whiff']" in sql

    def test_train_reads_fct_pitches_and_filters_swings(self):
        sql = read(BQML / "train_whiff_model.sql")
        assert "FROM `statcast_analytics.fct_pitches`" in sql
        assert "is_swing = 1" in sql
        assert "game_date >=" in sql

    def _selected_names(self, select_text: str) -> set[str]:
        toks = []
        for line in select_text.splitlines():
            line = line.strip().rstrip(",")
            if not line or line.startswith("--"):
                continue
            toks.extend(t.strip() for t in line.split(",") if t.strip())
        return set(toks)

    def test_train_features_exist_in_fct_schema(self):
        sql = read(BQML / "train_whiff_model.sql")
        select = re.search(r"AS\nSELECT(.*?)FROM", sql, re.S).group(1)
        fct_cols = set(fct_columns_from_ddl())
        for feat in self._selected_names(select):
            assert feat in fct_cols, feat

    def test_predict_scans_single_partition(self):
        sql = read(BQML / "predict_live_game.sql")
        assert sql.count("@target_date") >= 2  # both the feature scan and the join
        assert "ML.PREDICT(" in sql
        assert "`statcast_analytics.model_pitch_whiff`" in sql

    def test_predict_excludes_label_and_non_features(self):
        sql = read(BQML / "predict_live_game.sql")
        assert "EXCEPT (is_whiff" in sql
        for col in ("game_date", "game_id", "pitch_id"):
            assert col in sql.split("EXCEPT")[1].split(")")[0]

    def test_predict_features_are_train_features(self):
        """Columns reaching ML.PREDICT must include every training feature."""
        sql = read(BQML / "predict_live_game.sql")
        inner = re.search(r"ML.PREDICT\(\s*MODEL `[^`]+`,\s*\((.*?)\)\s*\)", sql, re.S).group(1)
        passed = set(re.search(r"EXCEPT \((.*?)\)", inner, re.S).group(1).replace("\n", " ").split(","))
        passed = {p.strip() for p in passed}
        train_sql = read(BQML / "train_whiff_model.sql")
        train_sel = re.search(r"AS\nSELECT(.*?)FROM", train_sql, re.S).group(1)
        features = self._selected_names(train_sel)
        fct_cols = set(fct_columns_from_ddl())
        # Everything the model was trained on that isn't EXCEPTed must reach it.
        assert features - {"is_whiff"} <= (fct_cols - passed)
