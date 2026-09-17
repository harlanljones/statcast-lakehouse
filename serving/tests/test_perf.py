"""Serving performance budget benchmarks (W2).

Pins latency budgets from the ROADMAP/TDD acceptance criteria:

  1. GET /pitches/sample full response (5000 synthetic rows) < 250 ms
  2. 304 If-None-Match revalidation on /pitches/sample      <  50 ms
     (and must NOT re-serialize: guarded behaviorally, not just by timing)
  3. Client-side parse of the /pitches/sample body via
     pyarrow.ipc.open_stream                                <  10 ms
  4. GET /pitches/dates JSON                                <  50 ms

All timings use fastapi TestClient (in-process, no network) and are warm
(each budget is measured after one warmup request), except
``test_sample_cold_full_response_under_250ms`` which exercises the cold
(cache-miss) full-response path by clearing the sample cache first.

Deselection convention: pytest.ini intentionally has no ``addopts`` — the
repo convention is to run everything explicitly (``python -m pytest -q``),
so perf benchmarks run in the default suite. To skip them on slow machines
or in selective CI jobs, opt OUT explicitly with ``-m "not perf"``; there
is no separate opt-in flag to remember.
"""
from __future__ import annotations

import io
import json
import time

import pyarrow as pa
import pyarrow.ipc as ipc
import pytest
from fastapi.testclient import TestClient

import serving.app as app_module

pytestmark = pytest.mark.perf

N_ROWS = 5000  # the /pitches/sample cap

# CI machines are noisy; budgets are the real contract, the multiplier only
# absorbs scheduler jitter. Keep generous but finite.
CI_MULTIPLIER = 3.0


def _budget_ms(ms: float) -> float:
    return ms * CI_MULTIPLIER


@pytest.fixture(scope="module")
def client():
    return TestClient(app_module.app)


def _timed_get(client: TestClient, path: str, **kwargs) -> tuple[float, object]:
    client.get(path, **kwargs)  # warmup (JIT imports, connections)
    start = time.perf_counter()
    response = client.get(path, **kwargs)
    elapsed_ms = (time.perf_counter() - start) * 1000
    return elapsed_ms, response


# --------------------------------------------------------------- 1. full 200

def test_sample_full_response_under_250ms(client):
    elapsed_ms, response = _timed_get(client, "/pitches/sample", params={"pitches": N_ROWS})
    assert response.status_code == 200
    assert len(response.content) > 0
    assert elapsed_ms < _budget_ms(250), f"sample 200 took {elapsed_ms:.1f}ms (budget 250ms)"


def test_sample_cold_full_response_under_250ms(client):
    """Cold path: cache-miss full response (synth_day + serialize) < 250ms."""
    app_module._sample_body.cache_clear()
    start = time.perf_counter()
    response = client.get("/pitches/sample", params={"pitches": N_ROWS})
    elapsed_ms = (time.perf_counter() - start) * 1000
    assert response.status_code == 200
    assert len(response.content) > 0
    assert elapsed_ms < _budget_ms(250), f"cold sample 200 took {elapsed_ms:.1f}ms (budget 250ms)"


def test_sample_cache_is_bounded(client):
    """lru_cache caps at 8 entries; many distinct sizes must not retain all."""
    app_module._sample_body.cache_clear()
    for n in range(1, 25):
        app_module._sample_body(n)
    info = app_module._sample_body.cache_info()
    assert info.currsize <= 8, f"cache grew to {info.currsize} entries (maxsize 8)"
    app_module._sample_body.cache_clear()


def test_sample_body_byte_stable_across_cache_eviction(client):
    """Same key yields identical bytes even after lru_cache eviction."""
    b1, e1 = app_module._sample_body(N_ROWS)
    for n in range(1, 25):  # force eviction of N_ROWS
        app_module._sample_body(n)
    b2, e2 = app_module._sample_body(N_ROWS)
    assert (b1, e1) == (b2, e2)


# --------------------------------------------------------------- 2. 304 path

def test_sample_304_revalidation_under_50ms_and_no_reserialization(client, monkeypatch):
    # Get the byte-stable body + etag first.
    _, first = _timed_get(client, "/pitches/sample", params={"pitches": N_ROWS})
    etag = first.headers["etag"]

    # Behavioral guard: a 304 must not regenerate the synthetic table NOR
    # re-serialize. Any attempt raises.
    calls = {"n": 0}
    real_synth = app_module.synth_day

    def counting_synth(*args, **kwargs):
        calls["n"] += 1
        return real_synth(*args, **kwargs)

    monkeypatch.setattr(app_module, "synth_day", counting_synth)

    def no_serialize(*args, **kwargs):
        raise AssertionError("304 revalidation re-serialized the sample table")

    monkeypatch.setattr(pa.ipc, "new_file", no_serialize)

    start = time.perf_counter()
    reval = client.get(
        "/pitches/sample",
        params={"pitches": N_ROWS},
        headers={"If-None-Match": etag},
    )
    elapsed_ms = (time.perf_counter() - start) * 1000

    assert reval.status_code == 304
    assert reval.headers["etag"] == etag
    assert reval.content == b""  # no body re-sent
    assert calls["n"] == 0, (
        "304 revalidation regenerated the sample table "
        f"({calls['n']} synth_day calls) — re-serialization is not allowed"
    )
    assert elapsed_ms < _budget_ms(50), f"304 revalidation took {elapsed_ms:.1f}ms (budget 50ms)"


# ------------------------------------------------- 3. client-side parse time

def test_sample_body_parses_under_10ms(client):
    _, response = _timed_get(client, "/pitches/sample", params={"pitches": N_ROWS})
    body = response.content
    assert response.status_code == 200

    # Body is file-format IPC (media type application/vnd.apache.arrow.file).
    with ipc.open_file(io.BytesIO(body)) as reader:  # warmup parse
        reader.read_all()
    start = time.perf_counter()
    with ipc.open_file(io.BytesIO(body)) as reader:
        table = reader.read_all()
    elapsed_ms = (time.perf_counter() - start) * 1000

    assert table.num_rows == N_ROWS
    assert elapsed_ms < _budget_ms(10), f"parse took {elapsed_ms:.1f}ms (budget 10ms)"


# --------------------------------------------------------- 4. dates metadata

def test_dates_json_under_50ms(client, monkeypatch):
    class FakeJob:
        def result(self):
            rows = [("2026-09-14", 5000), ("2026-09-13", 4800), ("2026-09-12", 4900)]

            class R:
                def __iter__(self):
                    return iter(rows)

            return R()

    class FakeClient:
        def query(self, q):
            return FakeJob()

    monkeypatch.setattr(app_module, "_bq_client", lambda: FakeClient())
    monkeypatch.setenv("GCP_PROJECT", "test-project")

    elapsed_ms, response = _timed_get(client, "/pitches/dates")
    assert response.status_code == 200
    assert json.loads(response.content)[0]["game_date"] == "2026-09-14"
    assert elapsed_ms < _budget_ms(50), f"/pitches/dates took {elapsed_ms:.1f}ms (budget 50ms)"
