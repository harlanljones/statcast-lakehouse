"""Export a day's pitch partition from BigQuery to Arrow IPC.

Per TDD.md §4.1 (Historical / Cold Batches): Cloud Run extracts date/pitcher
partitions into compressed Arrow IPC batches in Cloud Storage (GCS) with
public CDN cache headers.

Local mode needs no GCP credentials; GCS mode imports google-cloud-storage
lazily so tests and dry runs stay dependency-light.

Usage:
  python -m ingestion.export_batch --date 2026-09-14 --out data/2026-09-14.arrow
  python -m ingestion.export_batch --date 2026-09-14 \
      --out gs://statcast-arrow-batches/game_date=2026-09-14/pitches.arrow
"""
from __future__ import annotations

import argparse
import io
from datetime import date
from typing import Any

import pyarrow as pa

from ingestion.worker import SCHEMA

DATASET = "statcast_analytics"
TABLE = "fct_pitches"

# TDD §4: public CDN cache headers on GCS batch objects.
CACHE_CONTROL = "public, max-age=86400"
ARROW_CONTENT_TYPE = "application/vnd.apache.arrow.file"

# Explicit projection keeps the exported batch aligned with the worker's
# canonical schema even if fct_pitches grows extra columns later.
_PROJECTION = ", ".join(col.name for col in SCHEMA)


def day_partition_query(game_date: date) -> str:
    """Partition-filtered scan of one game_date (TDD §5: enforce filters)."""
    return (
        f"SELECT {_PROJECTION} FROM `{DATASET}.{TABLE}` "
        f"WHERE game_date = DATE '{game_date.isoformat()}'"
    )


def export_day_partition(
    game_date: date,
    out_path_or_bucket: str,
    client: Any = None,
    compression: str | None = "zstd",
) -> str:
    """Export one day's partition to compressed Arrow IPC.

    out_path_or_bucket: a local file path, or a ``gs://bucket[/prefix]``
    target for GCS upload (object metadata gets public cache headers).

    client: a BigQuery client duck-type exposing ``query(sql).result()``
    whose result supports ``to_arrow()`` (e.g. google.cloud.bigquery.Client).
    When None a real client is constructed from ambient credentials.

    compression: 'zstd', 'lz4', or None for uncompressed standard IPC.

    Returns the destination path/URI written.
    """
    if client is None:
        from google.cloud import bigquery

        client = bigquery.Client()

    table = client.query(day_partition_query(game_date)).result().to_arrow()
    if not isinstance(table, pa.Table):
        table = pa.Table.from_batches(list(table), schema=SCHEMA)
    table = table.combine_chunks()

    buf = io.BytesIO()
    options = pa.ipc.IpcWriteOptions(compression=compression) if compression else None
    with pa.ipc.new_file(buf, table.schema, options=options) as writer:
        writer.write_table(table)
    payload = buf.getvalue()

    if out_path_or_bucket.startswith("gs://"):
        return _upload_gcs(out_path_or_bucket, payload, game_date)

    import os

    os.makedirs(os.path.dirname(os.path.abspath(out_path_or_bucket)), exist_ok=True)
    with open(out_path_or_bucket, "wb") as fh:
        fh.write(payload)
    return out_path_or_bucket


def _upload_gcs(gs_uri: str, payload: bytes, game_date: date) -> str:
    """Upload payload to gs://bucket/prefix, setting public CDN cache headers."""
    from google.cloud import storage  # lazy: not needed for local exports

    if not gs_uri.endswith(".arrow"):
        gs_uri = f"{gs_uri.rstrip('/')}/game_date={game_date.isoformat()}/pitches.arrow"
    bucket_name, _, blob_name = gs_uri[len("gs://"):].partition("/")
    blob = storage.Client().bucket(bucket_name).blob(blob_name)
    blob.cache_control = CACHE_CONTROL
    blob.content_type = ARROW_CONTENT_TYPE
    blob.upload_from_string(payload, content_type=ARROW_CONTENT_TYPE)
    return gs_uri


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--date", required=True, help="game_date to export (YYYY-MM-DD)")
    ap.add_argument(
        "--out",
        required=True,
        help="local file path or gs://bucket[/prefix] destination",
    )
    ap.add_argument(
        "--compression",
        choices=["zstd", "lz4", "none"],
        default="zstd",
        help="IPC compression codec (default zstd)",
    )
    args = ap.parse_args(argv)

    dest = export_day_partition(
        date.fromisoformat(args.date),
        args.out,
        compression=None if args.compression == "none" else args.compression,
    )
    print(f"exported {args.date} -> {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
