"""HTTP caching tests (TDD.md §4: ETag/304 + partitions metadata).

All offline: /pitches/dates uses a fake BigQuery client injected via
monkeypatching of the module-level _bq_client factory.
"""
from __future__ import annotations

import io
import json

import pyarrow as pa
import pytest

import serving.app as app_module
from fastapi.testclient import TestClient


@pytest.fixture()
def client():
    return TestClient(app_module.app)

# ------------------------------------------------------------------ ETag/304


def test_sample_response_has_strong_etag(client):
    r = client.get("/pitches/sample")
    assert r.status_code == 200
    etag = r.headers["etag"]
    assert etag.startswith('"') and etag.endswith('"')
    assert not etag.startswith("W/")


def test_sample_etag_is_sha256_of_body(client):
    import hashlib

    r = client.get("/pitches/sample")
    expected = '"' + hashlib.sha256(r.content).hexdigest() + '"'
    assert r.headers["etag"] == expected


def test_if_none_match_with_exact_etag_returns_304_empty_body(client):
    # /pitches/sample is byte-stable (fixed seed + ingestion_time), so the
    # real sample body must produce a working 304 end-to-end.
    r1 = client.get("/pitches/sample")
    etag = r1.headers["etag"]
    r2 = client.get("/pitches/sample", headers={"If-None-Match": etag})
    assert r2.status_code == 304
    assert r2.content == b""
    assert r2.headers["cache-control"] == "public, max-age=86400"


def test_sample_body_is_byte_stable_across_requests(client):
    b1 = client.get("/pitches/sample").content
    b2 = client.get("/pitches/sample").content
    assert b1 == b2


def test_sample_caps_unbounded_pitch_param(client):
    r = client.get("/pitches/sample", params={"pitches": 10**9})
    assert r.status_code == 200
    table = pa.ipc.open_file(io.BytesIO(r.content)).read_all()
    assert 0 < table.num_rows <= app_module.SAMPLE_PITCHES_CAP


def test_if_none_match_with_stale_etag_returns_200(client):
    r = client.get("/pitches/sample", headers={"If-None-Match": '"deadbeef"'})
    assert r.status_code == 200
    assert len(r.content) > 0


def test_if_none_match_accepts_weak_prefix_and_lists(client):
    r1 = client.get("/pitches/sample")
    etag = r1.headers["etag"]
    weak = client.get(
        "/pitches/sample", headers={"If-None-Match": f"W/{etag}"}
    )
    listed = client.get(
        "/pitches/sample", headers={"If-None-Match": f'"other", {etag}'}
    )
    assert weak.status_code == 304
    assert listed.status_code == 304


# ------------------------------------------------------------- /pitches (BQ)


def _deterministic_bq_table():
    """Stand-in fct_pitches table for the /pitches fake client."""
    return pa.Table.from_pydict({"a": [1, 2, 3]})


class _FakeJob:
    def __init__(self, table):
        self._table = table

    def result(self):
        return self

    def to_arrow(self):
        return self._table


class _FakeClient:
    def __init__(self, project):
        self.project = project

    def query(self, q, job_config=None):
        return _FakeJob(_deterministic_bq_table())


def test_pitches_honors_if_none_match(client, monkeypatch):
    import sys
    import types

    fake_bq = types.ModuleType("google.cloud.bigquery")
    fake_bq.ScalarQueryParameter = lambda name, type_, value: (name, type_, value)
    fake_bq.QueryJobConfig = lambda query_parameters=None: types.SimpleNamespace(
        query_parameters=query_parameters
    )
    fake_bq.Client = _FakeClient
    fake_gc = types.ModuleType("google.cloud")
    monkeypatch.setitem(sys.modules, "google.cloud", fake_gc)
    monkeypatch.setitem(sys.modules, "google.cloud.bigquery", fake_bq)
    monkeypatch.setenv("GCP_PROJECT", "fake-project")

    r1 = client.get("/pitches", params={"date": "2026-09-14"})
    r2 = client.get(
        "/pitches",
        params={"date": "2026-09-14"},
        headers={"If-None-Match": r1.headers["etag"]},
    )
    assert r1.status_code == 200
    assert r2.status_code == 304
    assert r2.content == b""


def test_pitches_rejects_malformed_date_with_400(client):
    r = client.get("/pitches", params={"date": "not-a-date"})
    assert r.status_code == 400


# ---------------------------------------------------------- /pitches/dates


class _FakeDatesClient:
    def __init__(self, rows):
        self._rows = rows
        self.last_query = None

    def query(self, q, job_config=None):
        self.last_query = q
        return self

    def result(self):
        return [tuple(r) for r in self._rows]


@pytest.fixture()
def fake_dates_client(monkeypatch):
    rows = [("2026-09-14", 1200), ("2026-09-13", 950)]
    client = _FakeDatesClient(rows)
    monkeypatch.setattr(app_module, "_bq_client", lambda: client)
    monkeypatch.setenv("GCP_PROJECT", "fake-project")
    return client


def test_pitches_dates_returns_json_partition_list(client, fake_dates_client):
    r = client.get("/pitches/dates")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    data = json.loads(r.content)
    assert data == [
        {"game_date": "2026-09-14", "rows": 1200},
        {"game_date": "2026-09-13", "rows": 950},
    ]


def test_pitches_dates_entries_carry_game_date_for_web_client(client, fake_dates_client):
    # Cross-layer contract: web/src/lib/arrow-loader.ts's fetchDatePartitions
    # consumes every entry as a DatePartition ({ game_date: string, rows:
    # number }), reading `game_date` directly. If the serving shape changes,
    # this pin fails alongside the web tests.
    r = client.get("/pitches/dates")
    assert r.status_code == 200
    data = json.loads(r.content)
    assert isinstance(data, list) and data
    for entry in data:
        assert set(entry) == {"game_date", "rows"}
        assert isinstance(entry["game_date"], str)
        assert entry["game_date"].startswith("20")


def test_pitches_dates_query_reads_all_partition_metadata(client, fake_dates_client):
    client.get("/pitches/dates")
    q = fake_dates_client.last_query
    assert "INFORMATION_SCHEMA.PARTITIONS" in q
    assert "table_name = 'fct_pitches'" in q
    assert "30 DAY" not in q
    assert "FROM `statcast_analytics.fct_pitches`" not in q
    assert "GROUP BY" in q


def test_pitches_dates_without_gcp_project_returns_503(client, monkeypatch):
    monkeypatch.delenv("GCP_PROJECT", raising=False)
    r = client.get("/pitches/dates")
    assert r.status_code == 503
    assert "GCP_PROJECT" in r.json()["detail"]
