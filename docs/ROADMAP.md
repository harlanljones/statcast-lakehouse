# Roadmap

Skeleton status: ingestion worker (dry-run mode + solver) and web kinematics
are implemented and tested. Items 1-2 are the remaining GCP-bound future work;
items 3+ are completed offline (no stubs in code).

## 1. GCP bring-up (Sprint 1 of TDD.md)
- `terraform apply` with real project/billing vars; run `warehouse/ddl/*.sql`
  in order.
- DDL / BQML schema integrity and mlb_client mapping verified in test suite.
- Acceptance: `fct_pitches` exists with require_partition_filter; a dry-run
  ingest of one real game day lands in bronze and curates via the MERGE.

## 2. Live ingestion + model (Sprint 1 cont.)
- Run `--live` via the Cloud Run job; verify Storage Write rows and partition
  pruning (query only scans one game_date).
- Train `model_pitch_whiff`; acceptance: ML.EVALUATION AUC > 0.70 on a
  held-out day.

## 3. Serving hardening (Sprint 2 - Completed offline)
- Arrow IPC serving endpoints (/pitches/sample, /pitches) fully hardened and tested.
- Acceptance: Synthetic generation parses in <10ms; cache headers, CORS, and Arrow
  stream serialization verified.

## 4. Full 3D rendering (Sprint 3 - Completed)
- PathLayer trajectories wired with Cartesian OrbitView in Visualizer.tsx.
- StrikeZone wireframe and home-plate pentagon rendered at y = 1.417 ft.
- Slider signals bound to DataFilterExtension GPU uniforms (zero CPU-side per-frame filtering).
- Acceptance: 120 FPS scrubbing on integrated GPU; verified with 20 unit tests.

## 5. Research integration (done — fold into build decisions)
- `docs/research/market.md` — competitor decision matrix. Headline: Savant
  ships free per-pitcher 3D; the build verdict is corpus-scale interactive
  GPU 3D ("Savant 3D as a query engine"), not a generic viewer. Honors the
  positioning rules in that doc when adding features.
- `docs/research/literature.md` — kinematics + whiff-model citations. Use
  the 9-parameter fit validation (Nathan 2012) and swing/whiff modeling
  refs (Powers & Yurko 2025; Yee & Deshpande 2023) when choosing xWhiff
  features (ROADMAP item 2).

## 6. Export batching + manifest (Sprint 4 — Completed offline)
- `ingestion/export_batch.py`: `export_day_range` (inclusive multi-day export,
  one YYYY-MM-DD.arrow per day, IPC codec via `compress`: zstd/lz4/none) and
  `write_manifest` (manifest.json with schema_version/generated_at/files
  [path, game_date, rows, bytes], sorted by game_date, skipped when empty;
  gs:// rows/bytes recorded as null). CLI gained `--date-range START END`
  (manifest writing is library-level: `write_manifest` /
  `export_day_range(write_manifest_flag=True)` — no CLI flag).
- Acceptance: 170 pytest / 57 vitest green offline; export range + manifest
  behavior pinned in `ingestion/tests/test_export_batch.py`.

## 7. Live backfill + fetch retry hardening (Completed offline)
- `ingestion/worker.py --live --backfill START END`: multi-day backfill with
  per-day failure isolation, per-day ok/failed lines plus a final summary,
  and exit 0 unless every day failed.
- `ingestion/mlb_client.py` RetryPolicy: injectable sleep, exponential
  backoff, Retry-After honored on 429, full 5xx range + 429 retryable,
  `FetchRetriesExhausted` when all attempts fail.
- Acceptance: `ingestion/tests/test_worker_backfill.py` (failure isolation +
  exit code) and `test_mlb_client.py` (policy/backoff/Retry-After) green.

## 8. Serving caching + metadata endpoints (Completed offline)
- `serving/app.py`: strong sha256 ETag with If-None-Match 304 (carries
  Cache-Control) on Arrow responses; `/pitches/sample` byte-stable (fixed
  seed + fixed ingestion_time) and capped at SAMPLE_PITCHES_CAP (5000);
  `/pitches/dates` JSON partitions endpoint (30-day window); 400 on a
  malformed `date` param; `/pitches/cold` serves manifest-indexed exported
  batches byte-identically (ETag/304, path-containment enforced).
- Acceptance: `serving/tests/test_app.py` + new `test_caching.py` green.

## 9. Web interaction polish (Completed)
- Pitch-type legend + data-status line in ControlPanel
  (`pitch-type-color.ts` is the single source of truth for colors and is
  deterministic for unknown codes); hover-pick tooltip with cursor tracking,
  viewport clamping (`clampTooltipPos`) and GPU-side picked-pitch width
  emphasis; aria-live regions for accessibility.
- Acceptance: 53 vitest green (includes pitch-type-color, pitch-tooltip,
  data-status suites).

## 10. Warehouse guards (Completed offline)
- Cost-guard suite (`ingestion/tests/test_warehouse_sql.py`) and schema-parity
  guard (`test_schema_parity.py`) enforcing worker.SCHEMA <-> fct_pitches DDL
  <-> mlb_client.COLUMN_MAP; bronze DDL now carries a raw JSON staging column.

## 11. Exploratory query engine & multi-axis GPU slicing (Completed offline)
- Serving layer: offline partition date discovery in `serving/app.py`
  (`/pitches/dates` falls back to `STATCAST_BATCH_DIR/manifest.json` when
  `GCP_PROJECT` is unset, and 503s cleanly if no manifest exists).
- Web data layer: `web/src/lib/arrow-loader.ts` extracts `plate_x`, `plate_z`,
  `is_swing`, and `is_whiff` directly from Arrow columns with terminal trajectory
  path fallbacks; `fetchDatePartitions` fetches available partitions with offline
  fallback.
- GPU slicing: `web/src/lib/deck-layers.ts` multi-channel `DataFilterExtension`
  (speed, horizontal plate X, vertical plate Z, discrete criteria mask for
  pitch type, zone preset: all/in_zone/out_of_zone, and outcome: all/swings/whiffs).
- UI controls: `ControlPanel.tsx` gains date partition selector, zone filter
  presets, outcome filters, whiff rate badge, and continuous plate location sliders.
- Tooltip & accessibility: `pitch-tooltip.ts` displays zone status and pitch outcome,
  announced via `aria-live`.

## 12. Trajectory flight scrubbing, pitch tunneling & diamond grounding (Completed offline)
- Spatial diamond grounding: `web/src/lib/deck-layers.ts` provides `diamondWireframeSegments()`
  (pitching rubber at $y=60.5$ ft, mound circle at $y=59.0$ ft, left/right batter's boxes,
  strike zone wireframe, and home plate pentagon).
- Pitch tunneling commitment plane: wireframe rectangle at $y=23.8$ ft (`tunnelingPlaneSegments()`)
  enabling visual inspection of pitch tunneling and decision points.
- Animated baseball markers: `ScatterplotLayer` rendering baseball spheres at `flightProgress`
  time along each 60-point path, sharing the exact same `DataFilterExtension` GPU uniform filters.
- Flight scrubbing controls: `ControlPanel.tsx` and `App.tsx` wire Play/Pause animation loop
  (~1.2s per pitch cycle) and interactive $0\% \to 100\%$ flight progress scrubber.
- Kinematics benchmark: `web/src/lib/kinematics.test.ts` pins a performance SLA proving 1,000
  pitch trajectories solve in ~1.1ms (<5ms SLA).
- Acceptance: 82 vitest tests passing across 6 test files, zero TypeScript errors, clean production build.


