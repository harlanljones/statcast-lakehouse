"""GET /pitches/scenario/{id}: Arrow-only, byte-stable, cacheable, 404 on unknown."""
from __future__ import annotations

import io

import pyarrow as pa
import pytest
from fastapi.testclient import TestClient

import serving.app as app_module
from ingestion.scenarios import SCENARIOS
from ingestion.worker import SCHEMA

MEDIA_ARROW = "application/vnd.apache.arrow.file"
SCENARIO_ROWS = {
    "twenty-run-night": 370,
    "ohtani-50-50": 22,
    "ohtani-50th-home-run": 4,
    "freeman-walk-off": 13,
    "snell-no-hitter": 114,
}


@pytest.fixture()
def client():
    return TestClient(app_module.app)


def _table(body: bytes) -> pa.Table:
    with pa.ipc.open_file(io.BytesIO(body)) as reader:
        return reader.read_all()


@pytest.mark.parametrize(("sid", "row_count"), SCENARIO_ROWS.items())
def test_scenario_returns_real_game_slice_as_arrow(client, sid, row_count):
    r = client.get(f"/pitches/scenario/{sid}")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(MEDIA_ARROW)
    t = _table(r.content)
    assert t.num_rows == row_count
    assert t.schema.equals(SCHEMA)


def test_scenario_is_byte_stable_with_etag_and_304(client):
    a = client.get("/pitches/scenario/twenty-run-night")
    b = client.get("/pitches/scenario/twenty-run-night")
    assert a.content == b.content
    etag = a.headers["etag"]
    assert etag.startswith('"')
    assert a.headers["cache-control"] == "no-cache"
    r304 = client.get("/pitches/scenario/twenty-run-night", headers={"If-None-Match": etag})
    assert r304.status_code == 304
    assert r304.content == b""
    assert r304.headers["cache-control"] == "no-cache"


def test_scenarios_have_distinct_bodies(client):
    etags = {sid: client.get(f"/pitches/scenario/{sid}").headers["etag"] for sid in SCENARIOS}
    assert len(set(etags.values())) == len(SCENARIOS)


def test_unknown_scenario_is_404(client):
    assert client.get("/pitches/scenario/nope").status_code == 404


def test_scenario_body_is_zstd_compressed(client):
    """Bodies use zstd IPC compression: same table, fewer bytes on the wire."""
    body = client.get("/pitches/scenario/twenty-run-night").content
    table = _table(body)
    plain = io.BytesIO()
    with pa.ipc.new_file(plain, table.schema) as writer:
        writer.write_table(table)
    assert len(body) < 0.8 * len(plain.getvalue())
    assert table.equals(SCENARIOS["twenty-run-night"]())
