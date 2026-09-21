"""Offline tests for --backfill START END multi-day live mode.

Same fake strategy as test_worker_live.py: fetch_game_day is monkeypatched
(offline) and the google.cloud.bigquery load path is faked via sys.modules.
"""
from __future__ import annotations

import datetime as dt

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
    def test_middle_day_fails_others_still_written_rc0(
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
        assert rc == 0
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
