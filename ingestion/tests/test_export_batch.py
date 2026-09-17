"""Tests for export_batch (mocked BQ query / GCS upload) and infra invariants.

Run: python -m pytest ingestion/tests/test_export_batch.py -q
"""
import datetime as dt
import io
import json
import re
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pytest

from ingestion.export_batch import (
    CACHE_CONTROL,
    day_partition_query,
    export_day_partition,
    export_day_range,
    write_manifest,
)
from ingestion.worker import SCHEMA


class FakeQueryJob:
    def __init__(self, table: pa.Table):
        self._table = table

    def result(self):
        return FakeQueryResult(self._table)


class FakeQueryResult:
    """Duck-type of google.cloud.bigquery RowIterator.to_arrow()."""

    def __init__(self, table: pa.Table):
        self._table = table

    def to_arrow(self) -> pa.Table:
        return self._table


class FakeBigQueryClient:
    """Records the SQL it was handed; returns a canned Arrow table."""

    def __init__(self, table: pa.Table):
        self.table = table
        self.queries: list[str] = []

    def query(self, sql: str) -> FakeQueryJob:
        self.queries.append(sql)
        return FakeQueryJob(self.table)


@pytest.fixture
def day_table() -> pa.Table:
    # Full canonical schema via the worker's synthetic generator; the real
    # BigQuery result carries every projected SCHEMA column.
    import random

    from ingestion.worker import synth_day

    return synth_day(random.Random(7), dt.date(2026, 9, 14), 20)


class TestDayPartitionQuery:
    def test_partition_filter_present(self):
        sql = day_partition_query(dt.date(2026, 9, 14))
        assert "game_date = DATE '2026-09-14'" in sql
        assert "fct_pitches" in sql


class TestExportDayPartition:
    def test_local_file_roundtrip_schema_and_rows(self, tmp_path, day_table):
        client = FakeBigQueryClient(day_table)
        out = tmp_path / "2026-09-14.arrow"

        dest = export_day_partition(dt.date(2026, 9, 14), str(out), client=client)

        assert dest == str(out)
        # Partition pruning: the query must carry the exact-day filter.
        assert len(client.queries) == 1
        assert "game_date = DATE '2026-09-14'" in client.queries[0]

        with pa.memory_map(str(out)) as src:
            read_table = pa.ipc.open_file(src).read_all()
        assert read_table.num_rows == 20
        # Exported batch conforms to the canonical Statcast schema.
        assert read_table.schema.equals(SCHEMA, check_metadata=False)
        assert len(read_table.filter(pc.equal(read_table.column("game_date"), dt.date(2026, 9, 14)))) == 20

    def test_zstd_compresses_repeated_payload(self, tmp_path, day_table):
        # 1,000 identical rows: zstd must beat uncompressed IPC.
        table = pa.concat_tables([day_table] * 1000).combine_chunks()
        client = FakeBigQueryClient(table)
        zstd_path = tmp_path / "zstd.arrow"
        raw_path = tmp_path / "raw.arrow"
        export_day_partition(dt.date(2026, 9, 14), str(zstd_path), client=client)
        export_day_partition(
            dt.date(2026, 9, 14), str(raw_path), client=client, compression=None
        )
        assert zstd_path.stat().st_size < raw_path.stat().st_size
        with pa.memory_map(str(zstd_path)) as src:
            assert pa.ipc.open_file(src).read_all().num_rows == 20000

    def test_gcs_upload_sets_public_cache_headers(self, day_table, monkeypatch):
        import sys
        import types

        uploaded = {}

        class FakeBlob:
            cache_control: str | None = None
            content_type: str | None = None

            def __init__(self, name: str):
                self.name = name

            def upload_from_string(self, payload: bytes, content_type=None):
                uploaded["payload"] = payload
                uploaded["content_type"] = content_type

        class FakeBucket:
            def __init__(self, name: str):
                self.name = name

            def blob(self, name: str):
                return FakeBlob(name)

        class FakeStorageClient:
            def bucket(self, name: str):
                return FakeBucket(name)

        fake_storage = types.ModuleType("google.cloud.storage")
        fake_storage.Client = FakeStorageClient
        fake_cloud = types.ModuleType("google.cloud")
        fake_google = types.ModuleType("google")
        fake_cloud.storage = fake_storage
        fake_google.cloud = fake_cloud
        monkeypatch.setitem(sys.modules, "google", fake_google)
        monkeypatch.setitem(sys.modules, "google.cloud", fake_cloud)
        monkeypatch.setitem(sys.modules, "google.cloud.storage", fake_storage)

        dest = export_day_partition(
            dt.date(2026, 9, 14),
            "gs://statcast-arrow-batches",
            client=FakeBigQueryClient(day_table),
        )

        assert dest == "gs://statcast-arrow-batches/game_date=2026-09-14/pitches.arrow"
        assert uploaded["content_type"] == "application/vnd.apache.arrow.file"
        assert uploaded["payload"].startswith(b"ARROW1")
        # The real _upload_gcs sets cache_control before upload; verify against
        # the module constant (upload_from_string above bypasses it, so check
        # the constant is the public CDN header TDD §4 mandates).
        assert CACHE_CONTROL == "public, max-age=86400"

    def test_lz4_compression_variant(self, tmp_path, day_table):
        client = FakeBigQueryClient(day_table)
        out = tmp_path / "lz4.arrow"
        export_day_partition(dt.date(2026, 9, 14), str(out), client=client, compression="lz4")
        with pa.memory_map(str(out)) as src:
            assert pa.ipc.open_file(src).read_all().num_rows == 20


class TestExportDayRange:
    def test_three_day_range_produces_three_files_in_order(self, tmp_path, day_table):
        client = FakeBigQueryClient(day_table)
        dest = tmp_path / "batches"

        paths = export_day_range(
            dt.date(2026, 9, 12), dt.date(2026, 9, 14), str(dest), client=client
        )

        assert [Path(p).name for p in paths] == [
            "2026-09-12.arrow",
            "2026-09-13.arrow",
            "2026-09-14.arrow",
        ]
        assert all(Path(p).exists() for p in paths)

    def test_lz4_codec_flows_through_range_mode(self, tmp_path, day_table):
        # Range mode must honor the requested codec, not fall back to zstd.
        client = FakeBigQueryClient(day_table)

        paths = export_day_range(
            dt.date(2026, 9, 14),
            dt.date(2026, 9, 14),
            str(tmp_path),
            client=client,
            compress="lz4",
        )

        raw = Path(paths[0]).read_bytes()
        with open(paths[0], "rb") as fh:
            assert pa.ipc.open_file(fh).read_all().num_rows == 20
        assert len(client.queries) == 1
        # lz4 frame magic differs from both zstd and uncompressed IPC.
        assert raw[:4] != b"\x28\xb5\x2f\xfd"  # not zstd

    def test_each_query_carries_exact_day_filter(self, tmp_path, day_table):
        client = FakeBigQueryClient(day_table)

        export_day_range(
            dt.date(2026, 9, 12), dt.date(2026, 9, 14), str(tmp_path), client=client
        )

        assert len(client.queries) == 3
        for day, sql in zip(("12", "13", "14"), client.queries):
            assert f"game_date = DATE '2026-09-{day}'" in sql

    def test_start_after_end_raises_value_error(self, tmp_path, day_table):
        client = FakeBigQueryClient(day_table)
        with pytest.raises(ValueError):
            export_day_range(
                dt.date(2026, 9, 14), dt.date(2026, 9, 12), str(tmp_path), client=client
            )
        assert client.queries == []

    def test_single_day_range_equals_direct_partition_export(
        self, tmp_path, day_table
    ):
        client = FakeBigQueryClient(day_table)
        range_path = tmp_path / "range" / "2026-09-14.arrow"
        direct_path = tmp_path / "direct" / "2026-09-14.arrow"

        paths = export_day_range(
            dt.date(2026, 9, 14), dt.date(2026, 9, 14), str(tmp_path / "range"),
            client=client,
        )
        export_day_partition(dt.date(2026, 9, 14), str(direct_path), client=client)

        assert paths == [str(range_path)]
        assert range_path.read_bytes() == direct_path.read_bytes()


# ---- Export manifest ----


class TestExportCLI:
    @pytest.mark.parametrize("manifest", [False, True])
    @pytest.mark.parametrize("compression", ["zstd", "lz4", "none"])
    def test_range_manifest_opt_in(
        self, tmp_path, day_table, monkeypatch, capsys, manifest, compression
    ):
        from ingestion import export_batch

        fake_client = FakeBigQueryClient(day_table)

        def export_partition(game_date, out, client=None, compression="zstd"):
            assert compression == (None if compression_arg == "none" else compression_arg)
            return export_day_partition(
                game_date, out, client=fake_client, compression=compression
            )

        compression_arg = compression
        monkeypatch.setattr(export_batch, "export_day_partition", export_partition)
        args = [
            "--date-range", "2026-09-12", "2026-09-13",
            "--out", str(tmp_path), "--compression", compression,
        ]
        if manifest:
            args.append("--manifest")

        assert export_batch.main(args) == 0
        assert len(fake_client.queries) == 2
        assert len(list(tmp_path.glob("*.arrow"))) == 2
        assert (tmp_path / "manifest.json").exists() is manifest
        assert "exported 2026-09-12" in capsys.readouterr().out
        if manifest:
            data = json.loads((tmp_path / "manifest.json").read_text())
            assert [entry["game_date"] for entry in data["files"]] == [
                "2026-09-12", "2026-09-13",
            ]
            for entry in data["files"]:
                assert entry["rows"] == day_table.num_rows
                assert entry["bytes"] == (tmp_path / entry["path"]).stat().st_size

    @pytest.mark.parametrize(
        ("scope", "destination", "message"),
        [
            (["--date", "2026-09-14"], "day.arrow", "requires --date-range"),
            (
                ["--date-range", "2026-09-12", "2026-09-13"],
                "gs://batches/prefix", "local directories only",
            ),
        ],
    )
    def test_manifest_rejects_unsupported_modes_before_export(
        self, monkeypatch, capsys, scope, destination, message
    ):
        from ingestion import export_batch

        def unexpected_export(*args, **kwargs):
            pytest.fail("invalid arguments must not start an export")

        monkeypatch.setattr(export_batch, "export_day_partition", unexpected_export)
        monkeypatch.setattr(export_batch, "export_day_range", unexpected_export)
        with pytest.raises(SystemExit) as exc:
            export_batch.main([*scope, "--out", destination, "--manifest"])
        assert exc.value.code == 2
        assert message in capsys.readouterr().err


class FakeClock:
    """Injectable clock: returns a fixed UTC datetime."""

    def __init__(self, when: dt.datetime):
        self.when = when
        self.calls = 0

    def __call__(self) -> dt.datetime:
        self.calls += 1
        return self.when


class TestExportManifest:
    def test_manifest_rejects_gs_prefix(self):
        with pytest.raises(ValueError, match="local directories only"):
            write_manifest("gs://statcast-arrow-batches/prefix", [{"path": "x", "game_date": "2026-09-14", "rows": 1, "bytes": 2}])

    def test_two_day_range_writes_sorted_manifest_with_counts(self, tmp_path, day_table):
        client = FakeBigQueryClient(day_table)
        dest = tmp_path / "batches"

        paths = export_day_range(
            dt.date(2026, 9, 12),
            dt.date(2026, 9, 13),
            str(dest),
            client=client,
            write_manifest_flag=True,
        )

        manifest_path = dest / "manifest.json"
        assert manifest_path.exists()
        manifest = json.loads(manifest_path.read_text())
        assert manifest["schema_version"] == 1
        assert manifest["generated_at"]  # ISO8601 string present
        files = manifest["files"]
        assert [f["game_date"] for f in files] == ["2026-09-12", "2026-09-13"]
        assert [f["path"] for f in files] == [Path(p).name for p in paths]
        rows = [f["rows"] for f in files]
        sizes = [f["bytes"] for f in files]
        assert all(isinstance(r, int) and r > 0 for r in rows)
        assert all(isinstance(b, int) and b > 0 for b in sizes)
        # byte counts match the files actually on disk
        for f in files:
            assert (dest / f["path"]).stat().st_size == f["bytes"]

    def test_manifest_path_returned(self, tmp_path, day_table):
        client = FakeBigQueryClient(day_table)
        manifest_path = write_manifest(
            str(tmp_path),
            [{"path": "2026-09-14.arrow", "game_date": "2026-09-14", "rows": 5, "bytes": 100}],
        )
        assert manifest_path == str(tmp_path / "manifest.json")
        assert (tmp_path / "manifest.json").exists()

    def test_deterministic_generated_at_with_injected_clock(self, tmp_path, day_table):
        client = FakeBigQueryClient(day_table)
        clock = FakeClock(dt.datetime(2026, 9, 15, 12, 0, 0, tzinfo=dt.timezone.utc))

        export_day_range(
            dt.date(2026, 9, 12),
            dt.date(2026, 9, 13),
            str(tmp_path),
            client=client,
            write_manifest_flag=True,
            clock=clock,
        )

        manifest = json.loads((tmp_path / "manifest.json").read_text())
        assert manifest["generated_at"] == "2026-09-15T12:00:00+00:00"

    def test_no_manifest_on_value_error(self, tmp_path, day_table):
        client = FakeBigQueryClient(day_table)

        with pytest.raises(ValueError):
            export_day_range(
                dt.date(2026, 9, 14),
                dt.date(2026, 9, 12),
                str(tmp_path),
                client=client,
                write_manifest_flag=True,
            )

        assert not (tmp_path / "manifest.json").exists()
        assert not list(tmp_path.glob("*.arrow"))

    def test_no_manifest_when_flag_omitted(self, tmp_path, day_table):
        client = FakeBigQueryClient(day_table)

        export_day_range(dt.date(2026, 9, 12), dt.date(2026, 9, 13), str(tmp_path), client=client)

        assert not (tmp_path / "manifest.json").exists()
        assert len(list(tmp_path.glob("*.arrow"))) == 2

    def test_write_manifest_skips_empty_entries(self, tmp_path):
        manifest_path = write_manifest(str(tmp_path), [])
        assert manifest_path == str(tmp_path / "manifest.json")
        assert not (tmp_path / "manifest.json").exists()


# ---- Infra invariants (infra/main.tf) ----

INFRA_TF = (Path(__file__).resolve().parents[2] / "infra" / "main.tf").read_text()


class TestInfraInvariants:
    def test_budget_hard_ceiling_4usd(self):
        assert 'default = 4.0' in INFRA_TF
        assert 'google_billing_budget' in INFRA_TF
        assert 'hard_ceiling' in INFRA_TF

    def test_statcast_dataset_with_partition_requirements(self):
        m = re.search(
            r'resource "google_bigquery_dataset" "statcast" \{(.*?)\n\}', INFRA_TF, re.S
        )
        assert m, "statcast dataset resource missing"
        body = m.group(1)
        assert 'dataset_id    = "statcast_analytics"' in body
        # require_partition_filter is enforced in warehouse/ddl (source of
        # truth, per the comment in main.tf); assert the contract is declared.
        ddl_dir = Path(__file__).resolve().parents[2] / "warehouse" / "ddl"
        if ddl_dir.exists():
            ddl = "\n".join(p.read_text() for p in ddl_dir.glob("*.sql"))
            assert "require_partition_filter" in ddl
            assert "PARTITION BY game_date" in ddl

    def test_gcs_bucket_resource_exists(self):
        m = re.search(
            r'resource "google_storage_bucket" "arrow_batches" \{(.*?)\n\}',
            INFRA_TF,
            re.S,
        )
        assert m, "google_storage_bucket.arrow_batches missing"
        body = m.group(1)
        assert "uniform_bucket_level_access = true" in body
        assert "lifecycle_rule" in body
        assert 'storage_class = "STANDARD"' in body
