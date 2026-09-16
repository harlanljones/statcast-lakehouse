"""Tests for the manifest-driven /pitches/cold endpoint (TDD §4 cold batches).

Offline: a temp batch dir is built with export_day_range + a fake BQ client
(the same pattern as ingestion/tests/test_export_batch.py). No network.
"""
from __future__ import annotations

import datetime as dt
import io
import json

import pyarrow as pa
import pytest
from fastapi.testclient import TestClient

import serving.app as app_module
from ingestion.export_batch import export_day_range, write_manifest
from ingestion.worker import synth_day

MEDIA_ARROW = "application/vnd.apache.arrow.file"


class FakeQueryResult:
    def __init__(self, table: pa.Table):
        self._table = table

    def to_arrow(self) -> pa.Table:
        return self._table


class FakeQueryJob:
    def __init__(self, table: pa.Table):
        self._table = table

    def result(self) -> FakeQueryResult:
        return FakeQueryResult(self._table)


class FakeBigQueryClient:
    def __init__(self, table: pa.Table):
        self._table = table

    def query(self, sql: str) -> FakeQueryJob:
        return FakeQueryJob(self._table)


@pytest.fixture()
def batch_dir(tmp_path, monkeypatch):
    """Two exported days + manifest; env pointed at the temp dir."""
    client = FakeBigQueryClient(synth_day(__import__("random").Random(7), dt.date(2026, 9, 14), 20))
    paths = export_day_range(
        dt.date(2026, 9, 13),
        dt.date(2026, 9, 14),
        str(tmp_path),
        client=client,
    )
    entries = [
        {"path": p, "game_date": p.split("/")[-1].removesuffix(".arrow")} for p in paths
    ]
    write_manifest(str(tmp_path), entries)
    monkeypatch.setenv("STATCAST_BATCH_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture()
def client():
    return TestClient(app_module.app)


class TestColdEndpoint:
    def test_serves_day_byte_identical_with_etag(self, client, batch_dir):
        r = client.get("/pitches/cold", params={"date": "2026-09-14"})
        assert r.status_code == 200
        assert r.headers["content-type"].startswith(MEDIA_ARROW)
        assert r.headers["cache-control"] == "public, max-age=86400"
        assert "etag" in r.headers
        on_disk = (batch_dir / "2026-09-14.arrow").read_bytes()
        assert r.content == on_disk  # byte-identity: served as stored
        # and it is still valid IPC
        with pa.ipc.open_file(io.BytesIO(r.content)) as reader:
            assert reader.read_all().num_rows > 0

    def test_if_none_match_returns_304(self, client, batch_dir):
        etag = client.get("/pitches/cold", params={"date": "2026-09-14"}).headers["etag"]
        r = client.get(
            "/pitches/cold",
            params={"date": "2026-09-14"},
            headers={"If-None-Match": etag},
        )
        assert r.status_code == 304
        assert r.headers["etag"] == etag

    def test_date_not_in_manifest_404(self, client, batch_dir):
        r = client.get("/pitches/cold", params={"date": "2026-09-10"})
        assert r.status_code == 404
        assert "2026-09-10" in r.json()["detail"]

    def test_missing_batch_dir_503(self, client, monkeypatch, tmp_path):
        monkeypatch.setenv("STATCAST_BATCH_DIR", str(tmp_path / "nope"))
        r = client.get("/pitches/cold", params={"date": "2026-09-14"})
        assert r.status_code == 503
        assert "export_batch" in r.json()["detail"]

    def test_malformed_manifest_clear_error(self, client, batch_dir):
        (batch_dir / "manifest.json").write_text("{not json")
        r = client.get("/pitches/cold", params={"date": "2026-09-14"})
        assert r.status_code == 503
        assert "manifest" in r.json()["detail"].lower()

    def test_manifest_entry_but_file_missing_404(self, client, batch_dir):
        (batch_dir / "2026-09-14.arrow").unlink()
        r = client.get("/pitches/cold", params={"date": "2026-09-14"})
        assert r.status_code == 404

    def test_bad_date_format_400(self, client, batch_dir):
        r = client.get("/pitches/cold", params={"date": "not-a-date"})
        assert r.status_code == 400

    def test_compact_date_form_rejected_400(self, client, batch_dir):
        # fromisoformat on py>=3.11 accepts 20260914; the endpoint is stricter.
        r = client.get("/pitches/cold", params={"date": "20260914"})
        assert r.status_code == 400

    def test_manifest_path_escape_blocked_503(self, client, batch_dir):
        # A hand-edited manifest must not become arbitrary file read.
        import json as _json

        manifest_path = batch_dir / "manifest.json"
        manifest = _json.loads(manifest_path.read_text())
        secret = batch_dir.parent / "secret.txt"
        secret.write_text("top secret")
        for entry in manifest["files"]:
            if entry["game_date"] == "2026-09-14":
                entry["path"] = str(secret)
        manifest_path.write_text(_json.dumps(manifest))
        r = client.get("/pitches/cold", params={"date": "2026-09-14"})
        assert r.status_code == 503
        assert "escapes batch dir" in r.text

    def test_manifest_entry_without_path_503(self, client, batch_dir):
        import json as _json

        manifest_path = batch_dir / "manifest.json"
        manifest = _json.loads(manifest_path.read_text())
        manifest["files"][0] = {"game_date": "2026-09-13"}
        manifest_path.write_text(_json.dumps(manifest))
        r = client.get("/pitches/cold", params={"date": "2026-09-13"})
        assert r.status_code == 503
        assert "missing path" in r.text


def test_pitches_dates_falls_back_to_manifest_when_no_gcp_project(
    client, batch_dir, monkeypatch
):
    monkeypatch.delenv("GCP_PROJECT", raising=False)
    r = client.get("/pitches/dates")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    manifest = json.loads((batch_dir / "manifest.json").read_text())
    expected = [
        {"game_date": f["game_date"], "rows": f.get("rows", 0)}
        for f in manifest["files"]
    ]
    assert r.json() == expected
    assert [d["game_date"] for d in r.json()] == [
        f["game_date"] for f in manifest["files"]
    ]
