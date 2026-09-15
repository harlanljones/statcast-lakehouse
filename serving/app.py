"""Serving layer (TDD §4): Arrow IPC over HTTP.

  GET /pitches?date=YYYY-MM-DD  -> Arrow IPC stream from BigQuery
  GET /pitches/sample           -> synthetic Arrow day (no GCP creds)

The client parses this with the apache-arrow JS SDK — zero JSON overhead.
Run: uvicorn serving.app:app --port 8080
"""
from __future__ import annotations

import datetime as dt
import io
import os

from fastapi import FastAPI, HTTPException, Response
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


def _arrow_response(table) -> Response:
    sink = io.BytesIO()
    with pa_ipc_new(sink, table.schema) as writer:  # noqa: F821 - set below
        writer.write_table(table)
    return Response(
        content=sink.getvalue(),
        media_type=MEDIA_ARROW,
        headers={"Cache-Control": "public, max-age=86400"},
    )


# imported after app init so uvicorn reloads pick schema changes
import pyarrow as pa  # noqa: E402

_arrow_response.__globals__["pa_ipc_new"] = pa.ipc.new_file


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.get("/pitches/sample")
def sample(pitches: int = 300) -> Response:
    return _arrow_response(synth_day(dt.date(2026, 9, 14), pitches))


@app.get("/pitches")
def pitches(date: str) -> Response:
    """One game_date partition -> Arrow. Scans a single partition (cost rule)."""
    project = os.environ.get("GCP_PROJECT")
    if not project:
        raise HTTPException(503, "GCP_PROJECT not configured; use /pitches/sample")
    from google.cloud import bigquery

    client = bigquery.Client(project=project)
    q = """
    SELECT pitch_id, game_id, game_date, pitcher_id, batter_id, pitch_type,
           release_speed, release_spin_rate,
           x0, y0, z0, vx0, vy0, vz0, ax, ay, az,
           plate_x, plate_z, sz_top, sz_bot, is_swing, is_whiff
    FROM `statcast_analytics.fct_pitches`
    WHERE game_date = @d
    """
    job = client.query(q, job_config=bigquery.QueryJobConfig(query_parameters=[bigquery.ScalarQueryParameter("d", "DATE", date)]))
    table = job.result().to_arrow()
    return _arrow_response(table)
