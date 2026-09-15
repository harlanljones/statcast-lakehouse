"""Serving layer tests (TDD.md §4, Sprint 2: serving hardening).

All tests run offline: no GCP credentials, no live network access.
The BigQuery-backed /pitches endpoint is exercised with a mocked client
injected via monkeypatching.
"""
from __future__ import annotations

import io
import time
from datetime import date as dt_date

import pyarrow as pa
import pytest
from fastapi.testclient import TestClient

import serving.app as app_module
from ingestion.worker import SCHEMA

MEDIA_ARROW = "application/vnd.apache.arrow.file"


@pytest.fixture()
def client():
    return TestClient(app_module.app)


def _parse_arrow(body: bytes) -> pa.Table:
    with pa.ipc.open_file(io.BytesIO(body)) as reader:
        return reader.read_all()


# ---------------------------------------------------------------- healthz


def test_healthz_returns_ok(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


# ------------------------------------------------------------ /pitches/sample


def test_sample_returns_arrow_ipc_media_type(client):
    r = client.get("/pitches/sample")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(MEDIA_ARROW)


def test_sample_sets_public_cdn_cache_header(client):
    r = client.get("/pitches/sample")
    assert "public, max-age=86400" in r.headers["cache-control"]


def test_sample_body_deserializes_with_ipc_and_matches_schema(client):
    r = client.get("/pitches/sample")
    table = _parse_arrow(r.content)
    assert table.schema.equals(SCHEMA, check_metadata=False)
    assert table.num_rows > 0


def test_sample_respects_pitches_query_param(client):
    r = client.get("/pitches/sample", params={"pitches": 7})
    table = _parse_arrow(r.content)
    assert table.num_rows == 7


def test_sample_response_is_binary_arrow_not_json(client):
    r = client.get("/pitches/sample")
    # Invariant: no JSON on the serving path — payload starts with the Arrow
    # IPC file magic, not '{' or '['.
    assert r.content[:6] == b"ARROW1"


def test_sample_generation_under_10ms():
    """Performance: synthetic batch generation must stay <10ms (Sprint 2)."""
    import random
    import datetime as dt

    rng = random.Random(2026)
    # Warm up interpreter/imports so we measure steady-state generation.
    app_module._arrow_response(
        __import__("ingestion.worker", fromlist=["synth_day"]).synth_day(
            rng, dt.date(2026, 9, 14), 300
        )
    )
    from ingestion.worker import synth_day

    t0 = time.perf_counter()
    resp = app_module._arrow_response(synth_day(rng, dt.date(2026, 9, 14), 300))
    elapsed_ms = (time.perf_counter() - t0) * 1000
    assert resp.status_code == 200 if hasattr(resp, "status_code") else True
    assert elapsed_ms < 10.0, f"batch generation took {elapsed_ms:.2f}ms (>10ms)"


# ----------------------------------------------------------------- /pitches


class _FakeJob:
    def __init__(self, table):
        self._table = table

    def result(self):
        return self

    def to_arrow(self):
        return self._table


class _FakeClient:
    last_query = None
    last_params = None

    def __init__(self, project):
        self.project = project

    def query(self, q, job_config=None):
        _FakeClient.last_query = q
        _FakeClient.last_params = job_config.query_parameters
        return _FakeJob(_fake_bq_table())

    def close(self):
        pass


def _fake_bq_table() -> pa.Table:
    return pa.Table.from_pylist(
        [
            {
                "pitch_id": "202609140001-0001",
                "game_id": 202609140001,
                "game_date": dt_date(2026, 9, 14),
                "pitcher_id": 123456,
                "batter_id": 654321,
                "pitch_type": "FF",
                "release_speed": 95.5,
                "release_spin_rate": 2300.0,
                "x0": 1.0, "y0": 55.0, "z0": 5.5,
                "vx0": -5.0, "vy0": -130.0, "vz0": -2.0,
                "ax": 5.0, "ay": 0.0, "az": 32.174,
                "plate_x": 0.3, "plate_z": 2.0,
                "sz_top": 3.4, "sz_bot": 1.5,
                "is_swing": 1, "is_whiff": 0,
            }
        ],
        schema=SCHEMA,
    )


def test_pitches_without_gcp_project_returns_503(client, monkeypatch):
    monkeypatch.delenv("GCP_PROJECT", raising=False)
    r = client.get("/pitches", params={"date": "2026-09-14"})
    assert r.status_code == 503
    assert "GCP_PROJECT" in r.json()["detail"]


def test_pitches_queries_with_date_param_and_streams_arrow(
    client, monkeypatch
):
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

    r = client.get("/pitches", params={"date": "2026-09-14"})

    assert r.status_code == 200
    assert r.headers["content-type"].startswith(MEDIA_ARROW)
    # The query must be parameterized by the requested date.
    assert _FakeClient.last_params == [("d", "DATE", "2026-09-14")]
    assert "fct_pitches" in _FakeClient.last_query
    table = _parse_arrow(r.content)
    assert table.schema.equals(SCHEMA, check_metadata=False)
    assert table.num_rows == 1
    assert table.column("pitch_id").to_pylist() == ["202609140001-0001"]


# -------------------------------------------------------------------- CORS


def test_cors_headers_on_cross_origin_request(client):
    r = client.get(
        "/pitches/sample",
        headers={"Origin": "http://localhost:5173"},
    )
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_preflight_allows_get(client):
    r = client.options(
        "/pitches/sample",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert r.status_code in (200, 204)
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "GET" in r.headers["access-control-allow-methods"]


def test_cors_rejects_unlisted_origin(client):
    r = client.get(
        "/pitches/sample",
        headers={"Origin": "https://evil.example.com"},
    )
    assert "access-control-allow-origin" not in r.headers
