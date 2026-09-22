"""Offline tests for --backfill START END multi-day live mode.

Same fake strategy as test_worker_live.py: fetch_game_day is monkeypatched
(offline) and the google.cloud.bigquery load path is faked via sys.modules.
"""
from __future__ import annotations

import datetime as dt
import json
from unittest import mock

import pytest

from ingestion.tests.test_worker_live import (  # reuse fake google modules + state
    _FAKE_STATE,
    _install_fake_google_modules,
)
from ingestion import worker
from ingestion.worker import main


@pytest.fixture(autouse=True)
def fake_google(monkeypatch):
    _install_fake_google_modules(monkeypatch)
    _FAKE_STATE.reset()
    curated = set()

    def counts(day, project, table, *, client):
        if table == "fct_pitches" and day not in curated:
            return {}
        result = {}
        for call in _FAKE_STATE.load_calls:
            for row in call.rows:
                if row["game_date"] == day.isoformat():
                    result[row["pitch_id"]] = result.get(row["pitch_id"], 0) + 1
        return {key: 1 for key in result} if table == "fct_pitches" else result

    monkeypatch.setattr(worker, "_partition_pitch_counts", counts)
    monkeypatch.setattr(worker, "_curate_day", lambda day, project, *, client: curated.add(day))
    yield
    _FAKE_STATE.reset()


def _install_fetch(monkeypatch, failing_days=(), rows_per_day=5):
    """fetch_game_day stub: records fetched dates, raises for failing days."""
    fetched: list[dt.date] = []

    def fetch(day: dt.date, client=None):
        fetched.append(day)
        if day in failing_days:
            raise RuntimeError(f"transport error for {day.isoformat()}")
        return iter(
            [
                {"game_id": 1, "game_date": day, "pitch_id": f"{day}-{i}"}
                for i in range(rows_per_day)
            ]
        )

    monkeypatch.setattr("ingestion.mlb_client.fetch_game_day", fetch)
    return fetched


class TestBackfillHappyPath:
    def test_three_days_written_in_date_order(self, monkeypatch, capsys):
        fetched = _install_fetch(monkeypatch)
        rc = main(
            [
                "--live",
                "--project",
                "proj-y",
                "--backfill",
                "2026-09-10",
                "2026-09-12",
            ]
        )
        assert rc == 0
        assert fetched == [
            dt.date(2026, 9, 10),
            dt.date(2026, 9, 11),
            dt.date(2026, 9, 12),
        ]
        # one write per day, in date order, 5 rows each
        tables = [c.table_ref for c in _FAKE_STATE.load_calls]
        assert tables == ["proj-y.statcast_analytics.bronze_pitches"] * 3
        assert _FAKE_STATE.rows_loaded == 15
        out = capsys.readouterr().out
        for day in ("2026-09-10", "2026-09-11", "2026-09-12"):
            assert day in out
        assert "3 ok" in out

    def test_single_day_backfill_works(self, monkeypatch):
        fetched = _install_fetch(monkeypatch)
        assert (
            main(["--live", "--project", "p", "--backfill", "2026-09-10", "2026-09-10"])
            == 0
        )
        assert fetched == [dt.date(2026, 9, 10)]

    def test_empty_day_counts_as_ok(self, monkeypatch, capsys):
        _install_fetch(monkeypatch, rows_per_day=0)
        rc = main(
            ["--live", "--project", "p", "--backfill", "2026-09-10", "2026-09-10"]
        )
        assert rc == 0
        assert "ok (0 pitches)" in capsys.readouterr().out


class TestBackfillPartialFailure:
    def test_middle_day_fails_others_still_written_nonzero(
        self, monkeypatch, capsys
    ):
        fetched = _install_fetch(
            monkeypatch, failing_days={dt.date(2026, 9, 11)}
        )
        rc = main(
            [
                "--live",
                "--project",
                "proj-y",
                "--backfill",
                "2026-09-10",
                "2026-09-12",
            ]
        )
        assert rc == 1
        # all three days were attempted, in order
        assert fetched == [
            dt.date(2026, 9, 10),
            dt.date(2026, 9, 11),
            dt.date(2026, 9, 12),
        ]
        # 2 successful writes only (10 rows)
        assert _FAKE_STATE.rows_loaded == 10
        out = capsys.readouterr().out
        assert "ok" in out
        assert "failed" in out
        assert "transport error" in out  # failure summary includes exception


class TestBackfillResume:
    def test_repeated_range_does_not_append_existing_rows(self, monkeypatch, capsys):
        _install_fetch(monkeypatch)
        args = ["--live", "--project", "p", "--backfill", "2024-04-01", "2024-04-01"]
        assert main(args) == 0
        assert main(args) == 0
        assert len(_FAKE_STATE.load_calls) == 1
        assert "skipped" in capsys.readouterr().out

    def test_partial_partition_loads_only_missing_ids(self, monkeypatch):
        _install_fetch(monkeypatch)
        day = dt.date(2024, 4, 1)
        worker.write_bq([{"game_date": day, "pitch_id": f"{day}-0"}], "p", "bronze_pitches")
        assert worker.run_backfill(day, day, "p") == 0
        assert _FAKE_STATE.rows_loaded == 5
        assert len(_FAKE_STATE.load_calls[-1].rows) == 4

    def test_curation_failure_retries_without_reloading(self, monkeypatch, tmp_path):
        _install_fetch(monkeypatch)
        original = worker._curate_day
        monkeypatch.setattr(worker, "_curate_day", mock.Mock(side_effect=RuntimeError("curation failed")))
        day = dt.date(2024, 4, 1)
        manifest = tmp_path / "manifest.jsonl"
        assert worker.run_backfill(day, day, "p", manifest=manifest) == 1
        monkeypatch.setattr(worker, "_curate_day", original)
        assert worker.run_backfill(day, day, "p", manifest=manifest) == 0
        assert len(_FAKE_STATE.load_calls) == 1
        records = [json.loads(line) for line in manifest.read_text().splitlines()]
        assert [r["status"] for r in records] == ["failed", "skipped"]
        assert records[-1]["curated_rows"] == 5

    def test_fetch_failure_after_some_rows_never_writes(self, monkeypatch):
        def fetch(day):
            yield {"pitch_id": "one", "game_date": day}
            raise RuntimeError("truncated response")
        monkeypatch.setattr("ingestion.mlb_client.fetch_game_day", fetch)
        day = dt.date(2024, 4, 1)
        assert worker.run_backfill(day, day, "p") == 1
        assert not _FAKE_STATE.load_calls

    def test_invalid_source_date_never_writes(self, monkeypatch):
        monkeypatch.setattr("ingestion.mlb_client.fetch_game_day", lambda day: iter([
            {"pitch_id": "one", "game_date": dt.date(2024, 4, 2)},
        ]))
        day = dt.date(2024, 4, 1)
        assert worker.run_backfill(day, day, "p") == 1
        assert not _FAKE_STATE.load_calls

    def test_curated_verification_failure_is_reported(self, monkeypatch, capsys):
        _install_fetch(monkeypatch)
        monkeypatch.setattr(worker, "_curate_day", lambda *a, **kw: None)
        day = dt.date(2024, 4, 1)
        assert worker.run_backfill(day, day, "p") == 1
        assert "curated" in capsys.readouterr().out

    def test_existing_unexpected_ids_fail_before_write(self, monkeypatch):
        _install_fetch(monkeypatch)
        day = dt.date(2024, 4, 1)
        worker.write_bq([{"game_date": day, "pitch_id": "unexpected"}], "p", "bronze_pitches")
        assert worker.run_backfill(day, day, "p") == 1
        assert len(_FAKE_STATE.load_calls) == 1

    def test_existing_bronze_duplicates_are_reported_but_curated_once(self, monkeypatch, tmp_path):
        _install_fetch(monkeypatch, rows_per_day=1)
        day = dt.date(2024, 4, 1)
        worker.write_bq([{"game_date": day, "pitch_id": f"{day}-0"}] * 2, "p", "bronze_pitches")
        report = tmp_path / "report.jsonl"
        assert worker.run_backfill(day, day, "p", manifest=report) == 0
        result = json.loads(report.read_text())
        assert result["bronze_duplicate_rows"] == 1
        assert result["curated_rows"] == 1

    def test_manifest_path_checked_before_fetch(self, monkeypatch, tmp_path):
        fetched = _install_fetch(monkeypatch)
        day = dt.date(2024, 4, 1)
        with pytest.raises(FileNotFoundError):
            worker.run_backfill(day, day, "p", manifest=tmp_path / "missing" / "report.jsonl")
        assert fetched == []


class TestBackfillAllFail:
    def test_all_days_fail_exit_nonzero(self, monkeypatch, capsys):
        _install_fetch(
            monkeypatch,
            failing_days={
                dt.date(2026, 9, 10),
                dt.date(2026, 9, 11),
                dt.date(2026, 9, 12),
            },
        )
        rc = main(
            [
                "--live",
                "--project",
                "proj-y",
                "--backfill",
                "2026-09-10",
                "2026-09-12",
            ]
        )
        assert rc != 0
        assert "failed" in capsys.readouterr().out


class TestBackfillValidation:
    def test_manifest_without_backfill_rejected(self):
        with pytest.raises(SystemExit):
            main(["--dry-run", "--manifest", "report.jsonl"])

    def test_backfill_without_live_rejected(self):
        with pytest.raises(SystemExit) as exc:
            main(["--backfill", "2026-09-10", "2026-09-12"])
        assert exc.value.code != 0

    def test_backfill_with_dry_run_rejected(self):
        with pytest.raises(SystemExit) as exc:
            main(["--dry-run", "--backfill", "2026-09-10", "2026-09-12"])
        assert exc.value.code != 0

    def test_start_after_end_rejected_before_any_fetch(self, monkeypatch):
        fetched = _install_fetch(monkeypatch)
        with pytest.raises(SystemExit) as exc:
            main(
                [
                    "--live",
                    "--project",
                    "p",
                    "--backfill",
                    "2026-09-12",
                    "2026-09-10",
                ]
            )
        assert exc.value.code != 0
        assert fetched == []  # no fetch attempted

    def test_backfill_and_date_mutually_exclusive(self):
        with pytest.raises(SystemExit):
            main(
                [
                    "--live",
                    "--project",
                    "p",
                    "--date",
                    "2026-09-14",
                    "--backfill",
                    "2026-09-10",
                    "2026-09-12",
                ]
            )
