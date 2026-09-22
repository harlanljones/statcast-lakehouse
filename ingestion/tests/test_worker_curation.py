"""Offline checks for bounded, explicit-project backfill warehouse queries."""
from datetime import date
from unittest.mock import Mock

import pytest

from ingestion import worker
from ingestion.tests.test_worker_live import _install_fake_google_modules


@pytest.fixture(autouse=True)
def fake_google(monkeypatch):
    _install_fake_google_modules(monkeypatch)


@pytest.mark.parametrize("table", ["bronze_pitches", "fct_pitches"])
def test_partition_verification_has_date_filter_and_scan_cap(table):
    client = Mock()
    client.query.return_value.result.return_value = [{"pitch_id": "1-2-3", "row_count": 2}]
    day = date(2024, 4, 1)
    assert worker._partition_pitch_counts(day, "test-proj", table, client=client) == {"1-2-3": 2}
    sql = client.query.call_args.args[0]
    config = client.query.call_args.kwargs["job_config"]
    assert f"`test-proj.statcast_analytics.{table}`" in sql
    assert "game_date = @target_date" in sql
    assert ("DATE(ingestion_time) = @target_date" in sql) == (table == "bronze_pitches")
    assert config.query_parameters[0].value == day
    assert config.maximum_bytes_billed == 100 * 1024 * 1024


def test_curate_uses_canonical_sql_and_explicit_project():
    client = Mock()
    day = date(2024, 5, 11)
    worker._curate_day(day, "test-proj", client=client)
    sql = client.query.call_args.args[0]
    config = client.query.call_args.kwargs["job_config"]
    assert "MERGE `test-proj.statcast_analytics.fct_pitches`" in sql
    assert "FROM `test-proj.statcast_analytics.bronze_pitches`" in sql
    assert "@target_date" in sql
    assert config.query_parameters[0].value == day
    client.query.return_value.result.assert_called_once_with()
