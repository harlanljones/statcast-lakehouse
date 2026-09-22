"""Warehouse date discovery uses partition metadata, including old seasons."""
import datetime as dt

from fastapi.testclient import TestClient

import serving.app as app_module


def test_historical_dates_use_partition_metadata_without_fact_scan(monkeypatch):
    queries = []

    class Job:
        def result(self):
            return [(dt.date(2024, 9, 4), 4200), (dt.date(2024, 4, 1), 4100)]

    class Client:
        def query(self, sql):
            queries.append(sql)
            return Job()

    monkeypatch.setenv("GCP_PROJECT", "test-project")
    monkeypatch.setattr(app_module, "_bq_client", Client)
    response = TestClient(app_module.app).get("/pitches/dates")
    assert response.status_code == 200
    assert response.json() == [
        {"game_date": "2024-09-04", "rows": 4200},
        {"game_date": "2024-04-01", "rows": 4100},
    ]
    [sql] = queries
    assert "FROM `statcast_analytics.INFORMATION_SCHEMA.PARTITIONS`" in sql
    assert "table_name = 'fct_pitches'" in sql
    assert "SUM(total_rows)" in sql
    assert "SAFE.PARSE_DATE('%Y%m%d', partition_id)" in sql
    assert "REGEXP_CONTAINS(partition_id, r'^[0-9]{8}$')" in sql
    assert "HAVING game_date IS NOT NULL AND n > 0" in sql
    assert "ORDER BY game_date DESC" in sql
    assert "CURRENT_DATE" not in sql
    assert "FROM `statcast_analytics.fct_pitches`" not in sql


def test_empty_warehouse_date_catalog_is_empty_list(monkeypatch):
    class Client:
        def query(self, sql):
            return self

        def result(self):
            return []

    monkeypatch.setenv("GCP_PROJECT", "test-project")
    monkeypatch.setattr(app_module, "_bq_client", Client)
    response = TestClient(app_module.app).get("/pitches/dates")
    assert response.status_code == 200
    assert response.json() == []
