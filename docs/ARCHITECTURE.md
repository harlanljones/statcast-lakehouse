# Architecture

Mirrors TDD §2. Data flow end to end:

```
MLB Stats API (baseballsavant statcast endpoint)
  -> ingestion/mlb_client.py (CSV stream, COLUMN_MAP normalization)
  -> ingestion/worker.py (5k-row protobuf chunks)
  -> BigQuery Storage Write API, COMMITTED stream (free-tier write path)
  -> bronze_pitches (raw, partitioned by ingestion_time)
  -> warehouse/ddl/03_curate_day.sql MERGE -> fct_pitches
       (partitioned game_date, clustered pitcher/batter/pitch_type,
        ST_GEOGPOINT plate_location, require_partition_filter)
  -> BQML model_pitch_whiff (BOOSTED_TREE_CLASSIFIER, swings only)
  -> serving/app.py (FastAPI: one game_date partition -> Arrow IPC file)
  -> web/src/lib/arrow-loader.ts (apache-arrow JS, zero-copy columns)
  -> web/src/lib/kinematics.ts (9-parameter solver -> 60-pt path, Float32Array)
  -> Deck.gl (GPU trajectory rendering; DataFilterExtension uniform filters)
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

## Diagram

Interactive dark-theme diagram: `docs/architecture-diagram.html`
(open in a browser).
