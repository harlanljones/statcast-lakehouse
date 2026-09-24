"""Offline unit tests for the live BigQuery load-job path and worker CLI.

No GCP credentials, no network: google.cloud.bigquery is faked via
sys.modules so write_bq() can be exercised end to end with mocks.
"""
from __future__ import annotations

import datetime as dt
import json
import sys
import types as pytypes
from unittest import mock

import pyarrow as pa
import pytest

from ingestion import worker
from ingestion.scenarios import real_pitches
from ingestion.worker import SCHEMA, main, write_bq


# ---------------------------------------------------------------------------
# Fake google.cloud.bigquery (google-cloud-bigquery is not needed to run the
# suite; everything below stands in for the load-job surface write_bq uses).
# ---------------------------------------------------------------------------
class FakeGoogleAPICallError(Exception):
    """Stand-in for google.api_core.exceptions.GoogleAPICallError."""


class FakeConflict(FakeGoogleAPICallError):
    pass


class _FakeLoadJob:
    def __init__(self, exc):
        self._exc = exc

    def result(self):
        _FAKE_STATE.jobs_completed += 1
        if self._exc is not None:
            raise self._exc
        return None


class _FakeBigQueryClient:
    def __init__(self, project=None, **kwargs):
        _FAKE_STATE.client_projects.append(project)

    def load_table_from_json(self, json_rows, destination, job_config=None, job_id=None):
        rows = list(json_rows)
        _FAKE_STATE.load_calls.append(
            pytypes.SimpleNamespace(rows=rows, table_ref=destination, job_config=job_config, job_id=job_id)
        )
        return _FakeLoadJob(_FAKE_STATE.job_exc)


class _FakeLoadJobConfig:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class _FakeState:
    """Module-level capture shared across the fake client instances."""

    def __init__(self):
        self.reset()
        self.job_exc: Exception | None = None

    def reset(self):
        self.load_calls: list = []
        self.client_projects: list = []
        self.jobs_completed = 0
        self.job_exc = None

    @property
    def rows_loaded(self) -> int:
        return sum(len(c.rows) for c in self.load_calls)


_FAKE_STATE = _FakeState()


def _install_fake_google_modules(monkeypatch):
    bigquery = pytypes.ModuleType("google.cloud.bigquery")
    bigquery.Client = _FakeBigQueryClient
    bigquery.LoadJobConfig = _FakeLoadJobConfig
    bigquery.QueryJobConfig = _FakeLoadJobConfig
    bigquery.ScalarQueryParameter = lambda name, type_, value: pytypes.SimpleNamespace(
        name=name, type_=type_, value=value,
    )
    bigquery.WriteDisposition = pytypes.SimpleNamespace(WRITE_APPEND="WRITE_APPEND")

    google_cloud = pytypes.ModuleType("google.cloud")
    google_cloud.bigquery = bigquery
    google = pytypes.ModuleType("google")
    google.cloud = google_cloud
    api_core = pytypes.ModuleType("google.api_core")
    exceptions = pytypes.ModuleType("google.api_core.exceptions")
    exceptions.Conflict = FakeConflict
    api_core.exceptions = exceptions
    google.api_core = api_core

    monkeypatch.setitem(sys.modules, "google", google)
    monkeypatch.setitem(sys.modules, "google.cloud", google_cloud)
    monkeypatch.setitem(sys.modules, "google.cloud.bigquery", bigquery)
    monkeypatch.setitem(sys.modules, "google.api_core", api_core)
    monkeypatch.setitem(sys.modules, "google.api_core.exceptions", exceptions)


@pytest.fixture(autouse=True)
def fake_google(monkeypatch):
    _install_fake_google_modules(monkeypatch)
    _FAKE_STATE.reset()
    yield
    _FAKE_STATE.reset()


def _sample_rows(n: int) -> list[dict]:
    """Rows with the exact types that break a bare json.dumps: date + datetime."""
    return real_pitches(limit=n).to_pylist()


# ---------------------------------------------------------------------------
# write_bq()
# ---------------------------------------------------------------------------
class TestWriteBqSerialization:
    def test_rows_reach_the_load_job_json_safe(self):
        rows = _sample_rows(10)
        n = write_bq(iter(rows), "proj-x", "bronze_pitches")
        assert n == 10
        assert _FAKE_STATE.rows_loaded == 10
        # load_table_from_json runs a bare json.dumps: every row must survive it.
        for call in _FAKE_STATE.load_calls:
            json.dumps(call.rows)

    def test_dates_and_datetimes_become_iso_strings(self):
        write_bq(iter(_sample_rows(3)), "proj-x", "bronze_pitches")
        for obj in _FAKE_STATE.load_calls[0].rows:
            assert obj["game_date"] == "2024-08-02"
            # datetime ISO format, UTC offset preserved
            parsed = dt.datetime.fromisoformat(obj["ingestion_time"])
            assert parsed.utcoffset() == dt.timedelta(0)
            assert isinstance(obj["pitch_type"], str) and obj["pitch_type"]


class TestWriteBqJob:
    def test_destination_table_reference(self):
        write_bq(iter(_sample_rows(2)), "my-proj", "bronze_pitches")
        assert [c.table_ref for c in _FAKE_STATE.load_calls] == [
            "my-proj.statcast_analytics.bronze_pitches"
        ]

    def test_appends_and_never_truncates(self):
        write_bq(iter(_sample_rows(2)), "p", "bronze_pitches")
        assert _FAKE_STATE.load_calls[0].job_config.write_disposition == "WRITE_APPEND"

    def test_builds_a_client_for_the_project(self):
        write_bq(iter(_sample_rows(2)), "my-proj", "bronze_pitches")
        assert _FAKE_STATE.client_projects == ["my-proj"]

    def test_uses_an_injected_client_instead_of_building_one(self):
        injected = _FakeBigQueryClient(project="injected")
        _FAKE_STATE.client_projects.clear()
        n = write_bq(iter(_sample_rows(4)), "p", "bronze_pitches", client=injected)
        assert n == 4
        assert _FAKE_STATE.client_projects == []  # no second client was created
        assert _FAKE_STATE.rows_loaded == 4

    def test_waits_for_every_load_job(self):
        write_bq(iter(_sample_rows(5)), "p", "bronze_pitches")
        assert _FAKE_STATE.jobs_completed == len(_FAKE_STATE.load_calls) == 1


class TestWriteBqChunking:
    def test_chunks_of_5000(self):
        total = 11_001
        # More rows than the checked-in sample holds: cycle it (ids repeat;
        # write_bq only chunks, it does not dedup).
        rows = _sample_rows(100)
        n = write_bq((rows[i % len(rows)] for i in range(total)), "p", "bronze_pitches")
        assert n == total
        assert [len(c.rows) for c in _FAKE_STATE.load_calls] == [5000, 5000, 1001]
        assert _FAKE_STATE.jobs_completed == 3

    def test_empty_rows_is_noop(self):
        n = write_bq(iter([]), "p", "bronze_pitches")
        assert n == 0
        assert _FAKE_STATE.load_calls == []


class TestWriteBqErrorHandling:
    def test_load_job_error_propagates(self):
        _FAKE_STATE.job_exc = FakeGoogleAPICallError("load failed")
        with pytest.raises(FakeGoogleAPICallError, match="load failed"):
            write_bq(iter(_sample_rows(3)), "p", "bronze_pitches")

    def test_resumable_jobs_have_stable_ids(self):
        rows = _sample_rows(2)
        write_bq(rows, "p", "bronze_pitches", resumable=True)
        write_bq(rows, "p", "bronze_pitches", resumable=True)
        assert _FAKE_STATE.load_calls[0].job_id == _FAKE_STATE.load_calls[1].job_id

    def test_resumable_conflict_waits_for_previously_submitted_job(self):
        prior = mock.Mock(error_result=None)
        client = mock.Mock()
        client.load_table_from_json.side_effect = FakeConflict("already submitted")
        client.get_job.return_value = prior
        assert write_bq(_sample_rows(2), "p", "bronze_pitches", client=client, resumable=True) == 2
        assert client.load_table_from_json.call_count == 1
        prior.result.assert_called_once_with()

    def test_resumable_known_failed_job_gets_next_attempt_id(self):
        prior = mock.Mock(error_result={"reason": "backendError"})
        prior.done.return_value = True
        new = mock.Mock()
        client = mock.Mock()
        client.load_table_from_json.side_effect = [FakeConflict("already submitted"), new]
        client.get_job.return_value = prior
        assert write_bq(_sample_rows(2), "p", "bronze_pitches", client=client, resumable=True) == 2
        ids = [call.kwargs["job_id"] for call in client.load_table_from_json.call_args_list]
        assert ids[0].endswith("_0") and ids[1].endswith("_1")
        new.result.assert_called_once_with()


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
    def test_date_selects_one_real_game_day(self, tmp_path):
        out = tmp_path / "d.arrow"
        assert main(["--dry-run", "--date", "2024-09-19", "--pitches", "1000", "--out", str(out)]) == 0
        with pa.memory_map(str(out)) as src:
            table = pa.ipc.open_file(src).read_all()
        assert table.num_rows == 370
        assert set(table.column("game_date").to_pylist()) == {dt.date(2024, 9, 19)}
        assert set(table.column("game_id").to_pylist()) == {746011}

    def test_date_without_real_pitches_exits_2_and_lists_dates(self, tmp_path, capsys):
        with pytest.raises(SystemExit) as exc:
            main(["--dry-run", "--date", "2025-04-01", "--out", str(tmp_path / "d.arrow")])
        assert exc.value.code == 2
        err = capsys.readouterr().err
        assert "2025-04-01" in err
        assert "2024-09-19" in err
        assert not (tmp_path / "d.arrow").exists()

    def test_dry_run_is_real_pitches_not_generated(self, tmp_path):
        out = tmp_path / "d.arrow"
        assert main(["--dry-run", "--pitches", "25", "--out", str(out)]) == 0
        with pa.memory_map(str(out)) as src:
            table = pa.ipc.open_file(src).read_all()
        assert table.equals(real_pitches(limit=25))

    def test_invalid_date_exits_2(self):
        with pytest.raises(SystemExit) as exc:
            main(["--dry-run", "--date", "not-a-date"])
        assert exc.value.code == 2
