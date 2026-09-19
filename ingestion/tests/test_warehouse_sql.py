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
        # raw JSON staging column carries the unparsed API record on top of
        # the mapped SCHEMA columns.
        assert ddl_cols == [f.name for f in SCHEMA] + ["raw"]

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
        for f in (
            BQML / "train_whiff_model.sql",
            BQML / "predict_live_game.sql",
            BQML / "evaluate_whiff_model.sql",
        ):
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

    def test_evaluate_model_config(self):
        sql = read(BQML / "evaluate_whiff_model.sql")
        assert "ML.EVALUATE(" in sql
        assert "`statcast_analytics.model_pitch_whiff`" in sql
        for metric in ("roc_auc", "accuracy", "precision", "recall", "f1_score", "log_loss"):
            assert metric in sql, f"{metric} missing from evaluate_whiff_model.sql"

    def test_evaluate_scans_single_partition_and_swings(self):
        sql = read(BQML / "evaluate_whiff_model.sql")
        assert "@target_date" in sql
        assert "is_swing = 1" in sql
        assert "FROM `statcast_analytics.fct_pitches`" in sql

    def test_evaluate_features_match_train_features(self):
        eval_sql = read(BQML / "evaluate_whiff_model.sql")
        inner_sel = re.search(r"ML\.EVALUATE\(\s*MODEL `[^`]+`,\s*\(\s*SELECT(.*?)FROM", eval_sql, re.S).group(1)
        eval_features = self._selected_names(inner_sel)

        train_sql = read(BQML / "train_whiff_model.sql")
        train_sel = re.search(r"AS\nSELECT(.*?)FROM", train_sql, re.S).group(1)
        train_features = self._selected_names(train_sel)

        assert eval_features == train_features, f"Feature mismatch: {eval_features ^ train_features}"


# ----------------------------------------------------- cost-guard invariants
# AGENTS.md free-tier rule: every scan of fct_pitches must prune on game_date
# (require_partition_filter = TRUE), so no query may read the whole table.
# These guards parse (regex-level) every .sql file under warehouse/ and are
# case-insensitive / whitespace-normalized: strict on invariants, tolerant
# of formatting.


def norm(sql: str) -> str:
    """Lowercase and collapse all whitespace runs to single spaces."""
    return re.sub(r"\s+", " ", sql.lower())


def all_warehouse_sql_files() -> list[Path]:
    return sorted((REPO / "warehouse").rglob("*.sql"))


FCT_TABLE_RE = re.compile(r"from\s+`[\w\-]+\.[\w\-.]*fct_pitches`")

GAME_DATE_FILTER = re.compile(r"\bgame_date\s*(?:>=|<=|<>|!=|[=<>])\s*\S|game_date\s+between\b")


def fct_scan_gaps(sql: str) -> list[str]:
    r"""Every scan of fct_pitches must be pruned on game_date within its own
    query scope: text from the FROM up to where the subquery's parentheses
    close, with any nested-parenthesis content dropped so an inner scan
    cannot vouch for an outer one (or vice versa).

    Static-guard limitations (accepted): comment text inside a scope can
    satisfy the filter regex, and a ')' inside a string literal truncates
    the scope early — neither occurs in this repo's SQL.
    """
    gaps = []
    flat = norm(sql)
    for stmt in flat.split(";"):
        for m in FCT_TABLE_RE.finditer(stmt):
            depth = 0
            scope_end = len(stmt)
            scope_chars = []
            for i, ch in enumerate(stmt[m.end():], m.end()):
                if depth == 0 and ch == ")":
                    scope_end = i  # subquery containing this FROM closes
                    break
                if ch == "(":
                    depth += 1
                elif ch == ")":
                    depth -= 1
                elif depth == 0:
                    scope_chars.append(ch)
            if not GAME_DATE_FILTER.search("".join(scope_chars)):
                gaps.append("".join(scope_chars).strip()[:60] or "(empty scope)")
    return gaps



class TestCostGuards:
    def test_every_warehouse_sql_file_is_discovered(self):
        files = all_warehouse_sql_files()
        names = {f.name for f in files}
        expected = {
            "01_bronze_pitches.sql",
            "02_fct_pitches.sql",
            "03_curate_day.sql",
            "04_strike_zone_density.sql",
            "train_whiff_model.sql",
            "predict_live_game.sql",
            "evaluate_whiff_model.sql",
        }
        assert expected <= names, f"missing from warehouse/ scan: {expected - names}"
        for f in files:
            assert f.read_text().strip(), f"{f.name} is empty"

    def test_fct_pitches_partitioned_by_game_date(self):
        sql = norm(read(DDL / "02_fct_pitches.sql"))
        assert re.search(r"partition by\s+game_date\b", sql)

    def test_fct_pitches_clustered_by_player_and_pitch_type(self):
        sql = norm(read(DDL / "02_fct_pitches.sql"))
        m = re.search(r"cluster by\s+([^;()]*?)(?:\boptions\b|;|$)", sql)
        assert m, "CLUSTER BY clause missing"
        cols = [c.strip() for c in m.group(1).split(",")]
        assert cols == ["pitcher_id", "batter_id", "pitch_type"], cols

    def test_fct_pitches_requires_partition_filter(self):
        sql = norm(read(DDL / "02_fct_pitches.sql"))
        assert re.search(r"require_partition_filter\s*=\s*true\b", sql)

    def test_fct_pitches_has_partition_expiration(self):
        sql = norm(read(DDL / "02_fct_pitches.sql"))
        assert re.search(r"partition_expiration_days\s*=\s*\d+", sql)

    def test_every_fct_pitches_scan_filters_on_game_date(self):
        """Every SELECT reading fct_pitches, in any warehouse SQL file, must
        carry a game_date predicate (free-tier scan budget)."""
        offenders = []
        for f in all_warehouse_sql_files():
            for gap in fct_scan_gaps(f.read_text()):
                offenders.append(f"{f.name}: {gap!r}")
        assert not offenders, f"fct_pitches scan without game_date filter: {offenders}"

    def test_curate_day_scan_is_partition_filtered(self):
        """03_curate_day reads bronze_pitches (partitioned by ingestion_time,
        not game_date), so its guard is a partition predicate on the scan."""
        sql = norm(read(DDL / "03_curate_day.sql"))
        assert re.search(r"from\s+`[\w\-]+\.[\w\-.]*bronze_pitches`", sql)
        assert re.search(r"date\s*\(\s*ingestion_time\s*\)\s*=\s*@target_date\b", sql)

    def test_train_whiff_model_type(self):
        sql = norm(read(BQML / "train_whiff_model.sql"))
        assert re.search(r"model_type\s*=\s*'boosted_tree_classifier'", sql)

    def test_train_whiff_model_trains_on_swings_only(self):
        sql = norm(read(BQML / "train_whiff_model.sql"))
        assert re.search(r"\bis_swing\s*=\s*1\b", sql)

    def test_train_whiff_model_input_query_filters_game_date(self):
        sql = norm(read(BQML / "train_whiff_model.sql"))
        parts = re.split(r"\bas\s+select\b", sql, maxsplit=1)
        assert len(parts) == 2, "model input SELECT not found"
        assert GAME_DATE_FILTER.search(parts[1]), "input SELECT lacks game_date filter"

    def test_bronze_partitioned_by_ingestion_time(self):
        sql = norm(read(DDL / "01_bronze_pitches.sql"))
        assert re.search(r"partition by\s+date\s*\(\s*ingestion_time\s*\)", sql)
        assert re.search(r"require_partition_filter\s*=\s*true\b", sql)

    def test_bronze_has_raw_json_staging_column(self):
        sql = read(DDL / "01_bronze_pitches.sql")
        assert re.search(r"\braw\s+(?:payload\s+)?json\b", sql, re.I)

    def test_strike_zone_density_query_cost_guards(self):
        sql = norm(read(DDL / "04_strike_zone_density.sql"))
        assert re.search(r"from\s+zone_cells", sql)
        assert re.search(r"f\.game_date\s*=\s*@target_date\b", sql)
        assert re.search(r"st_contains\s*\(\s*z\.zone_geom\s*,\s*f\.plate_location\s*\)", sql)
        assert re.search(r"statcast_analytics\.fct_pitches", sql)
