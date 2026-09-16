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
  python -m ingestion.export_batch --date-range 2026-09-12 2026-09-14 \
      --out data/batches
"""
from __future__ import annotations

import argparse
import io
import json
import os
from datetime import date, datetime, timedelta, timezone
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

    os.makedirs(os.path.dirname(os.path.abspath(out_path_or_bucket)), exist_ok=True)
    with open(out_path_or_bucket, "wb") as fh:
        fh.write(payload)
    return out_path_or_bucket


MANIFEST_NAME = "manifest.json"
MANIFEST_SCHEMA_VERSION = 1


def write_manifest(
    dest_dir_or_prefix: str,
    entries: list[dict[str, Any]],
    client: Any = None,
    clock: Any = None,
) -> str:
    """Write manifest.json next to the exported batches.

    entries: per-file dicts of {path, game_date, rows, bytes}; sorted by
    game_date before writing. Returns the manifest path. Local directories
    only: gs:// prefixes raise ValueError (the GCS object write is not
    wired; use a local staging dir and upload the pair together).

    clock: injectable zero-arg callable returning a datetime for
    deterministic generated_at in tests; defaults to the real UTC clock.
    Returns the would-be path (without creating a file) when entries is
    empty — callers cannot distinguish skipped from written by the return
    value alone.
    """
    if dest_dir_or_prefix.startswith("gs://"):
        raise ValueError(
            "write_manifest supports local directories only; got "
            f"{dest_dir_or_prefix!r} (upload manifest.json alongside the "
            "batches after a local export)"
        )
    if not entries:
        # No files exported -> no manifest (avoids a misleading empty index).
        return str(os.path.join(dest_dir_or_prefix, MANIFEST_NAME))

    sorted_entries = sorted(entries, key=lambda e: e["game_date"])
    clock = clock or dt_now_utc

    manifest = {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "generated_at": clock().isoformat(),
        "files": sorted_entries,
    }
    manifest_path = os.path.join(dest_dir_or_prefix, MANIFEST_NAME)
    os.makedirs(os.path.dirname(os.path.abspath(manifest_path)), exist_ok=True)
    with open(manifest_path, "w") as fh:
        json.dump(manifest, fh, indent=2)
    return manifest_path


def dt_now_utc() -> datetime:
    """Real UTC clock (the default for the injectable-clock seam)."""
    return datetime.now(timezone.utc)


def _rows_and_bytes(path: str) -> tuple[int | None, int | None]:
    """Re-read an exported IPC file to count rows; measure its byte size.

    Local paths only today; for gs:// destinations callers pass None/None
    until object metadata round-trips are wired up (see export_day_range).
    """
    if path.startswith("gs://"):
        # GCS object read (downloader + blob.size) is not wired yet; keep
        # rows/bytes null in the manifest rather than guessing.
        return None, None

    with open(path, "rb") as fh:
        table = pa.ipc.open_file(fh).read_all()
    return table.num_rows, os.path.getsize(path)


def export_day_range(
    start_date: date,
    end_date: date,
    dest_dir: str,
    client: Any = None,
    compress: str | None = "zstd",
    write_manifest_flag: bool = False,
    clock: Any = None,
) -> list[str]:
    """Export every day's partition in an inclusive date range.

    One file per day, named ``YYYY-MM-DD.arrow`` inside dest_dir; each day
    gets its own partition-pruned query (require_partition_filter cost rule).

    ``compress`` carries the IPC codec: 'zstd' (default), 'lz4', or None.

    ``write_manifest_flag`` (default False, so existing callers are
    unchanged): after exporting all days, re-read each local IPC file for its
    row count, measure its byte size, and write manifest.json into the same
    directory. gs:// destinations record rows/bytes as null until GCS object
    reads are wired.

    Returns the output paths in date order.
    """
    if start_date > end_date:
        raise ValueError(
            f"start_date {start_date.isoformat()} is after end_date {end_date.isoformat()}"
        )

    paths: list[str] = []
    day = start_date
    while day <= end_date:
        out_path = os.path.join(dest_dir, f"{day.isoformat()}.arrow")
        paths.append(
            export_day_partition(
                day,
                out_path,
                client=client,
                compression=compress,
            )
        )
        day += timedelta(days=1)

    if write_manifest_flag:
        entries = []
        for day_path, day in zip(paths, _iter_days(start_date, end_date)):
            rows, nbytes = _rows_and_bytes(day_path)
            entries.append(
                {
                    "path": os.path.basename(day_path),
                    "game_date": day.isoformat(),
                    "rows": rows,
                    "bytes": nbytes,
                }
            )
        write_manifest(dest_dir, entries, clock=clock)
    return paths


def _iter_days(start_date: date, end_date: date):
    day = start_date
    while day <= end_date:
        yield day
        day += timedelta(days=1)


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
    scope = ap.add_mutually_exclusive_group(required=True)
    scope.add_argument("--date", help="single game_date to export (YYYY-MM-DD)")
    scope.add_argument(
        "--date-range",
        nargs=2,
        metavar=("START", "END"),
        help="inclusive date range to export (YYYY-MM-DD YYYY-MM-DD); "
        "one YYYY-MM-DD.arrow file per day under --out directory",
    )
    ap.add_argument(
        "--out",
        required=True,
        help="local file path or gs://bucket[/prefix] destination "
        "(with --date-range, a directory)",
    )
    ap.add_argument(
        "--compression",
        choices=["zstd", "lz4", "none"],
        default="zstd",
        help="IPC compression codec (default zstd)",
    )
    args = ap.parse_args(argv)
    compression = None if args.compression == "none" else args.compression

    if args.date_range:
        start, end = (date.fromisoformat(d) for d in args.date_range)
        for dest in export_day_range(start, end, args.out, compress=compression):
            print(f"exported {os.path.splitext(os.path.basename(dest))[0]} -> {dest}")
        return 0

    dest = export_day_partition(
        date.fromisoformat(args.date),
        args.out,
        compression=compression,
    )
    print(f"exported {args.date} -> {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
