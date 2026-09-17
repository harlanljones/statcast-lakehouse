# Architecture

Mirrors TDD §2. Data flow end to end:

```
MLB Stats API (baseballsavant statcast endpoint)
  -> ingestion/mlb_client.py (CSV stream, COLUMN_MAP normalization,
     RetryPolicy: exponential backoff, Retry-After on 429, 5xx + 429
     retryable, FetchRetriesExhausted)
  -> ingestion/worker.py (5k-row protobuf chunks; --live --backfill START END
     for per-day failure-isolated multi-day backfill)
  -> BigQuery Storage Write API, COMMITTED stream (free-tier write path)
  -> bronze_pitches (raw, partitioned by ingestion_time, raw JSON staging
     column)
  -> warehouse/ddl/03_curate_day.sql MERGE -> fct_pitches
       (partitioned game_date, clustered pitcher/batter/pitch_type,
        ST_GEOGPOINT plate_location, require_partition_filter)
  -> BQML model_pitch_whiff (BOOSTED_TREE_CLASSIFIER, swings only)
  -> serving/app.py (FastAPI: one game_date partition -> Arrow IPC file,
     sha256 ETag + If-None-Match 304 with Cache-Control; /pitches/dates JSON
     partition index, 30-day window; /pitches/cold serves exported Arrow
     batches via manifest.json under STATCAST_BATCH_DIR (path-contained);
     /pitches/sample byte-stable, capped)
  -> web/src/lib/arrow-loader.ts (apache-arrow JS, zero-copy columns)
  -> web/src/lib/kinematics.ts (9-parameter solver -> 60-pt path, Float32Array)
  -> Deck.gl (GPU trajectory rendering; DataFilterExtension uniform filters)
```

Side path (warehouse -> batch consumers):

```
BigQuery (fct_pitches, partition-filtered scans)
  -> ingestion/export_batch.py export_day_range --date-range START END
     (inclusive, one YYYY-MM-DD.arrow per day, zstd/lz4/none IPC codec)
     -> GCS or local dir (optional --manifest writes manifest.json locally;
        requires --date-range and rejects GCS destinations before exporting)
```

## Key decisions (and why)

- **Storage Write over legacy insertAll** — legacy streaming is billed;
  Storage Write has a 2 TB/mo free allowance, keeping the project at $0.
- **In-warehouse ML (BQML)** — no model-hosting tier to pay for; inference
  cost is query-scan cost, already bounded by partitioning.
- **Arrow IPC serving, no JSON** — typed arrays go straight into deck.gl
  buffers; parsing a game day stays in the low-tens-of-ms.
- **Client-side trajectory recomputation** — shipping 60 precomputed points
  triples payload size vs 9 floats; recomputation is a closed-form quadratic
  per pitch, done once at load.
- **GPU-side filtering** — sliders write filter uniform ranges; no CPU
  array pass per interaction, which is what keeps scrubbing at frame rate.
- **require_partition_filter everywhere** — every documented query scans
  single-day partitions; the 1 TB/mo free scan budget then covers a full
  season of queries many times over.
- **Deterministic sample + strong ETag** — `/pitches/sample` uses a fixed
  seed and fixed ingestion_time, so its body is byte-stable and the sha256
  ETag makes If-None-Match 304s actually hit; `/pitches/dates` keeps date
  discovery as cheap JSON metadata instead of Arrow scans.
- **Per-day export batches with a manifest** — multi-day exports write one
  Arrow file per game_date plus manifest.json (path/game_date/rows/bytes,
  sorted by game_date) so batch consumers can process days independently
  and skip already-ingested files.

## Diagram

Interactive dark-theme diagram: `docs/architecture-diagram.html`
(open in a browser).
