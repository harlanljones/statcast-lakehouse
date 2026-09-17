"""Serving layer (TDD §4): Arrow IPC over HTTP.

  GET /pitches?date=YYYY-MM-DD  -> Arrow IPC stream from BigQuery
  GET /pitches/sample           -> synthetic Arrow day (no GCP creds)

The client parses this with the apache-arrow JS SDK — zero JSON overhead.
Run: uvicorn serving.app:app --port 8080
"""
from __future__ import annotations

import datetime as dt
import functools
import hashlib
import io
import json
import os
import pathlib
import random
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse

from ingestion.worker import synth_day

app = FastAPI(title="statcast-lakehouse serving", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["GET"],
)

MEDIA_ARROW = "application/vnd.apache.arrow.file"


def _etag_for(body: bytes) -> str:
    return '"' + hashlib.sha256(body).hexdigest() + '"'


def _etag_matches(header_value: str, etag: str) -> bool:
    """If-None-Match: accept exact, W/ prefixed, and comma-separated lists."""
    for candidate in header_value.split(","):
        candidate = candidate.strip()
        if candidate == "*":
            return True
        if candidate.startswith("W/"):
            candidate = candidate[2:]
        if candidate == etag:
            return True
    return False


def _serialize(table) -> tuple[bytes, str]:
    sink = io.BytesIO()
    with pa.ipc.new_file(sink, table.schema) as writer:
        writer.write_table(table)
    body = sink.getvalue()
    return body, _etag_for(body)


def _respond(body: bytes, etag: str, if_none_match: str | None) -> Response:
    if if_none_match and _etag_matches(if_none_match, etag):
        # RFC 9111 4.3.4: 304 should carry the Cache-Control of the stored
        # response so caches refresh with the same directives.
        return Response(
            status_code=304,
            headers={"ETag": etag, "Cache-Control": "public, max-age=86400"},
        )
    return Response(
        content=body,
        media_type=MEDIA_ARROW,
        headers={
            "Cache-Control": "public, max-age=86400",
            "ETag": etag,
        },
    )


def _arrow_response(table, if_none_match: str | None = None) -> Response:
    body, etag = _serialize(table)
    return _respond(body, etag, if_none_match)


# imported after app init so uvicorn reloads pick schema changes
import pyarrow as pa  # noqa: E402


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


SAMPLE_PITCHES_CAP = 5000
_SAMPLE_DAY = dt.date(2026, 9, 14)

# Byte-stable synthetic sample cache, keyed by row count: the seed and
# ingestion_time are fixed, so regenerating or re-serializing per request is
# pure waste — a 304 must do neither. lru_cache(maxsize=8) bounds memory:
# only the 8 most recently used row counts keep a full serialized body
# (each is on the order of a few hundred KB, so 8 entries stay small).
# Thread-safety: functools.lru_cache is thread-safe — concurrent misses may
# each compute once (benign duplicate work), but reads never see partial
# state and the same key always yields the same bytes.
@functools.lru_cache(maxsize=8)
def _sample_body(n: int) -> tuple[bytes, str]:
    table = synth_day(
        random.Random(2026),
        _SAMPLE_DAY,
        n,
        ingestion_time=datetime(2026, 9, 14, 12, 0, 0, tzinfo=timezone.utc),
    )
    return _serialize(table)


@app.get("/pitches/sample")
def sample(request: Request, pitches: int = 300) -> Response:
    n = max(1, min(pitches, SAMPLE_PITCHES_CAP))
    body, etag = _sample_body(n)
    return _respond(body, etag, request.headers.get("if-none-match"))


def _bq_client():
    """BigQuery client factory; monkeypatched in tests with fakes."""
    project = os.environ.get("GCP_PROJECT")
    if not project:
        raise HTTPException(503, "GCP_PROJECT not configured; use /pitches/sample")
    from google.cloud import bigquery

    return bigquery.Client(project=project)


def _bq_query_config(date: str):
    """Parameterized single-partition query config (module-level for tests)."""
    from google.cloud import bigquery

    return bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("d", "DATE", date)]
    )


def _batch_dir() -> str:
    """Directory holding exported cold batches + manifest.json."""
    return os.environ.get("STATCAST_BATCH_DIR", "data/batches")


def _read_batch_manifest() -> list[dict]:
    """Parse manifest.json's file entries (read-side only; no export changes)."""
    import pathlib

    manifest_path = pathlib.Path(_batch_dir()) / "manifest.json"
    if not manifest_path.is_file():
        raise HTTPException(
            503,
            "No cold batch directory found at "
            f"{manifest_path.parent}; run "
            "`python -m ingestion.export_batch --date-range ... --out "
            "<dir> --manifest` to export batches first",
        )
    try:
        manifest = json.loads(manifest_path.read_text())
        files = manifest["files"]
        if not isinstance(files, list):
            raise ValueError("files must be a list")
        return files
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(
            503, f"Malformed batch manifest at {manifest_path}: {exc}"
        ) from None


def _find_cold_entry(files: list[dict], date: str) -> dict:
    """Only the matching game_date entry; no full-table scans."""
    for entry in files:
        if str(entry.get("game_date", "")) == date:
            return entry
    raise HTTPException(404, f"No cold batch exported for game_date {date}")


@app.get("/pitches/cold")
def pitches_cold(request: Request, date: str) -> Response:
    """Serve a previously exported batch as Arrow IPC bytes, as stored.

    Resolution: STATCAST_BATCH_DIR (default data/batches) -> manifest.json.
    Byte-identity is preserved: raw file bytes are streamed without
    re-serialization; the ETag hashes those bytes so 304 revalidation works.
    """
    try:
        parsed = dt.datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD") from None
    entry = _find_cold_entry(_read_batch_manifest(), parsed.isoformat())
    rel = entry.get("path") if isinstance(entry, dict) else None
    if not isinstance(rel, str) or not rel:
        raise HTTPException(503, "Malformed manifest entry (missing path)")
    batch_root = os.path.realpath(_batch_dir())
    path = os.path.realpath(os.path.join(_batch_dir(), rel))
    # Containment check: manifest entries must resolve inside the batch dir
    # (a hand-edited or hostile manifest must not become arbitrary file read).
    if not path.startswith(batch_root + os.sep):
        raise HTTPException(503, f"Manifest entry escapes batch dir: {rel!r}")
    if not os.path.isfile(path):
        raise HTTPException(
            404,
            f"Cold batch file for {date} listed in manifest but missing on disk: {path}",
        )
    with open(path, "rb") as fh:
        body = fh.read()
    etag = _etag_for(body)
    if_none_match = request.headers.get("if-none-match")
    if if_none_match and _etag_matches(if_none_match, etag):
        return Response(
            status_code=304,
            headers={"ETag": etag, "Cache-Control": "public, max-age=86400"},
        )
    return Response(
        content=body,
        media_type=MEDIA_ARROW,
        headers={"Cache-Control": "public, max-age=86400", "ETag": etag},
    )


@app.get("/pitches/dates")
def pitches_dates() -> Response:
    """Distinct recent game_date partitions + row counts (metadata, JSON)."""
    if not os.environ.get("GCP_PROJECT"):
        manifest_path = pathlib.Path(_batch_dir()) / "manifest.json"
        if not manifest_path.is_file():
            raise HTTPException(503, "GCP_PROJECT not configured; use /pitches/sample")
        files = _read_batch_manifest()
        rows = [
            {"game_date": f["game_date"], "rows": f.get("rows", 0)} for f in files
        ]
        return Response(content=json.dumps(rows), media_type="application/json")

    client = _bq_client()
    q = """
    SELECT game_date, COUNT(*) AS n
    FROM `statcast_analytics.fct_pitches`
    WHERE game_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    GROUP BY game_date
    ORDER BY game_date DESC
    """
    rows = [
        {"game_date": str(row[0]), "rows": row[1]} for row in client.query(q).result()
    ]
    return Response(content=json.dumps(rows), media_type="application/json")


@app.get("/pitches")
def pitches(request: Request, date: str) -> Response:
    """One game_date partition -> Arrow. Scans a single partition (cost rule)."""
    try:
        dt.date.fromisoformat(date)
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD") from None
    client = _bq_client()
    q = """
    SELECT pitch_id, game_id, game_date, pitcher_id, batter_id, pitch_type,
           release_speed, release_spin_rate,
           x0, y0, z0, vx0, vy0, vz0, ax, ay, az,
           plate_x, plate_z, sz_top, sz_bot, is_swing, is_whiff
    FROM `statcast_analytics.fct_pitches`
    WHERE game_date = @d
    """
    job = client.query(q, job_config=_bq_query_config(date))
    table = job.result().to_arrow()
    return _arrow_response(
        table, if_none_match=request.headers.get("if-none-match")
    )
