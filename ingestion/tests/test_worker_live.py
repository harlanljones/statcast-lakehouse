"""Offline unit tests for the live Storage Write path and worker CLI.

No GCP credentials, no network: google-cloud modules are faked via
sys.modules so write_bq() can be exercised end to end with mocks.
"""
from __future__ import annotations

import datetime as dt
import json
import random
import sys
import types as pytypes
from unittest import mock

import pyarrow as pa
import pytest

from ingestion import worker
from ingestion.worker import SCHEMA, main, synth_day, write_bq


# ---------------------------------------------------------------------------
# Fake google.cloud modules (google-cloud-bigquery[-storage] not installed;
# everything below stands in for the Storage Write API surface write_bq uses).
# ---------------------------------------------------------------------------
class FakeGoogleAPICallError(Exception):
    """Stand-in for google.api_core.exceptions.GoogleAPICallError."""


class _FakeClient:
    def __init__(self, *args, **kwargs):
        self.append_rows_calls: list = []
        self.result_exc: Exception | None = None

    def append_rows(self, requests):
        reqs = list(requests)
        # Requests self-register in FakeAppendRowsRequest.__init__.
        self.append_rows_calls.append(reqs)

        class _Future:
            def __init__(self, exc):
                self._exc = exc

            def result(self):
                if self._exc is not None:
                    raise self._exc
                return None

        return _Future(_FAKE_STATE.client_exc)


class _FakeState:
    """Module-level capture shared across the fake client instances."""

    def __init__(self):
        self.append_rows_requests: list = []
        self.serialized_row_payloads: list = []
        self.client_exc: Exception | None = None

    def reset(self):
        self.append_rows_requests = []
        self.serialized_row_payloads = []


_FAKE_STATE = _FakeState()


class FakeProtoRows:
    def __init__(self):
        # Plain list: only the request-level sink (FakeAppendRowsRequest)
        # records payloads, so each row is captured exactly once.
        self.serialized_rows = []


class _RowSink(list):
    def extend(self, iterable):
        for item in iterable:
            super().append(item)
            _FAKE_STATE.serialized_row_payloads.append(item)


class FakeAppendRowsRequest:
    def __init__(self):
        self.write_stream = None
        self.proto_rows = pytypes.SimpleNamespace(serialized_rows=_RowSink())
        _FAKE_STATE.append_rows_requests.append(self)


def _install_fake_google_modules(monkeypatch):
    bigquery_storage_v1 = pytypes.ModuleType("google.cloud.bigquery_storage_v1")
    bigquery_storage_v1.BigQueryWriteClient = _FakeClient
    bigquery_storage_v1.types = pytypes.SimpleNamespace(
        AppendRowsRequest=FakeAppendRowsRequest
    )
    bigquery_storage_v1.pb2 = pytypes.SimpleNamespace(ProtoRows=FakeProtoRows)

    google_cloud = pytypes.ModuleType("google.cloud")
    google_cloud.bigquery = pytypes.ModuleType("google.cloud.bigquery")
    google_cloud.bigquery_storage_v1 = bigquery_storage_v1

    google = pytypes.ModuleType("google")
    google.cloud = google_cloud

    monkeypatch.setitem(sys.modules, "google", google)
    monkeypatch.setitem(sys.modules, "google.cloud", google_cloud)
    monkeypatch.setitem(sys.modules, "google.cloud.bigquery", google_cloud.bigquery)
    monkeypatch.setitem(
        sys.modules, "google.cloud.bigquery_storage_v1", bigquery_storage_v1
    )


@pytest.fixture(autouse=True)
def fake_google(monkeypatch):
    _install_fake_google_modules(monkeypatch)
    _FAKE_STATE.reset()
    yield
    _FAKE_STATE.reset()


def _sample_rows(n: int) -> list[dict]:
    """Rows with the exact types that broke naive json.dumps: date + datetime."""
    table = synth_day(random.Random(3), dt.date(2026, 9, 14), n)
    return table.to_pylist()


# ---------------------------------------------------------------------------
# write_bq()
# ---------------------------------------------------------------------------
class TestWriteBqSerialization:
    def test_date_and_datetime_serialize_without_typeerror(self):
        rows = _sample_rows(10)
        n = write_bq(iter(rows), "proj-x", "bronze_pitches")
        assert n == 10
        assert len(_FAKE_STATE.serialized_row_payloads) == 10

    def test_payload_is_valid_json_with_iso_strings(self):
        rows = _sample_rows(3)
        write_bq(iter(rows), "proj-x", "bronze_pitches")
        for payload in _FAKE_STATE.serialized_row_payloads:
            obj = json.loads(payload)
            assert obj["game_date"] == "2026-09-14"
            # datetime ISO format, UTC offset preserved
            parsed = dt.datetime.fromisoformat(obj["ingestion_time"])
            assert parsed.utcoffset() == dt.timedelta(0)
            assert obj["pitch_type"] in worker.PITCH_TYPES


class TestWriteBqStreamAndRequest:
    def test_stream_name_format(self):
        write_bq(iter(_sample_rows(2)), "my-proj", "bronze_pitches")
        assert len(_FAKE_STATE.append_rows_requests) == 1
        req = _FAKE_STATE.append_rows_requests[0]
        assert req.write_stream == (
            "projects/my-proj/datasets/statcast_analytics/tables/"
            "bronze_pitches/streams/_default"
        )

    def test_one_append_rows_call_per_request(self):
        write_bq(iter(_sample_rows(5)), "p", "bronze_pitches")
        # Single batch -> exactly one AppendRowsRequest sent.
        assert len(_FAKE_STATE.append_rows_requests) == 1
        assert len(_FAKE_STATE.serialized_row_payloads) == 5


class TestWriteBqChunking:
    def test_chunks_of_5000(self):
        total = 11_001
        n = write_bq(iter(_sample_rows(total)), "p", "bronze_pitches")
        assert n == total
        sizes = [len(r.proto_rows.serialized_rows) for r in _FAKE_STATE.append_rows_requests]
        assert sizes == [5000, 5000, 1001]
        # serialized payloads mirror the request contents
        assert len(_FAKE_STATE.serialized_row_payloads) == total

    def test_empty_rows_is_noop(self):
        n = write_bq(iter([]), "p", "bronze_pitches")
        assert n == 0
        assert _FAKE_STATE.append_rows_requests == []


class TestWriteBqErrorHandling:
    def test_google_api_call_error_propagates(self):
        _FAKE_STATE.client_exc = FakeGoogleAPICallError("stream closed")
        with pytest.raises(FakeGoogleAPICallError, match="stream closed"):
            write_bq(iter(_sample_rows(3)), "p", "bronze_pitches")


# ---------------------------------------------------------------------------
# main() CLI
# ---------------------------------------------------------------------------
class TestMainDryRun:
    def test_dry_run_writes_arrow_and_returns_0(self, tmp_path, capsys):
        out = tmp_path / "day.arrow"
        rc = main(["--dry-run", "--pitches", "50", "--out", str(out)])
        assert rc == 0
        assert out.exists()
        with pa.memory_map(str(out)) as src:
            back = pa.ipc.open_file(src).read_all()
        assert back.num_rows == 50
        assert back.schema.equals(SCHEMA)
        assert f"{out}" in capsys.readouterr().out

    def test_dry_run_default_mode_when_no_flags(self, tmp_path):
        # no --live: dry-run is the default mode
        out = tmp_path / "day.arrow"
        assert main(["--pitches", "10", "--out", str(out)]) == 0
        assert out.exists()


class TestMainLiveValidation:
    def test_live_without_project_exits_2(self, capsys):
        rc = main(["--live", "--date", "2026-09-14"])
        assert rc == 2
        err = capsys.readouterr().err
        assert "--project" in err

    def test_dry_run_does_not_require_project(self, tmp_path):
        assert main(["--dry-run", "--out", str(tmp_path / "d.arrow")]) == 0


class TestMainLivePath:
    def test_live_calls_fetch_and_write_bq_with_correct_params(self, tmp_path, monkeypatch):
        rows = _sample_rows(7)
        fetch = mock.Mock(return_value=iter(rows))
        write = mock.Mock(return_value=7)
        monkeypatch.setattr("ingestion.mlb_client.fetch_game_day", fetch)
        monkeypatch.setattr(worker, "write_bq", write)

        rc = main(["--live", "--project", "proj-y", "--date", "2026-09-14"])
        assert rc == 0
        fetch.assert_called_once_with(dt.date(2026, 9, 14))
        assert write.call_count == 1
        rows_arg, project_arg, table_arg = write.call_args.args
        assert list(rows_arg) == rows
        assert project_arg == "proj-y"
        assert table_arg == "bronze_pitches"


class TestMainDateArg:
    def test_date_passed_through_to_synth(self, tmp_path):
        out = tmp_path / "d.arrow"
        assert main(["--dry-run", "--date", "2025-04-01", "--out", str(out)]) == 0
        with pa.memory_map(str(out)) as src:
            table = pa.ipc.open_file(src).read_all()
        assert table.column("game_date").to_pylist()[0] == dt.date(2025, 4, 1)

    def test_invalid_date_exits_2(self):
        with pytest.raises(SystemExit) as exc:
            main(["--dry-run", "--date", "not-a-date"])
        assert exc.value.code == 2
