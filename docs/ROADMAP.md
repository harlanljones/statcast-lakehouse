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
  local destinations only). CLI supports `--date-range START END --manifest`
  to opt into manifest writing; `--manifest` rejects single-file mode and GCS
  destinations before any export starts. Library callers can use
  `export_day_range(write_manifest_flag=True)`.
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

## 13. Aerodynamic break vectors & ghost-trajectory visualization (Sprint 5 — Completed offline)
- Aerodynamic separation: `ghost_kinematics` and `ghostTrajectory` solve trajectory
  under gravity and drag without Magnus acceleration ($a_x = 0$, $a_z = -32.174$ ft/s²).
- Nathan 2012 break vectors: `compute_break_vector` / `computeBreakVector` calculate
  induced vertical break (IVB) and horizontal break (HB) in inches at plate arrival;
  `breakVectorSegment` connects ghost arrival point to actual pitch arrival.
- GPU visualization: `ghost-trajectories` PathLayer rendered at reduced opacity sharing
  DataFilterExtension uniforms; picked pitch renders emphasized ghost trajectory and gold
  break vector segment.
- Tooltip integration: `pitch-tooltip.ts` formats break displacement (e.g. `IVB +16.5"  HB -14.2"`),
  announced via `aria-live`.
- Acceptance: 91 vitest tests across 6 files; Python and TS kinematics mirrored and pinned.

## 14. 3D Release point clustering, release extension & spin-rate telemetry (Sprint 6 — Completed offline)
- Release geometry & physics: `PITCHING_RUBBER_Y_FT` (60.5 ft) and `release_extension` /
  `releaseExtension` ($60.5 - y_0$) defined in Python and TypeScript with mirrored tests.
- Arrow loader extraction: `web/src/lib/arrow-loader.ts` extracts `release_spin_rate`
  and derives `extension` from kinematics for each pitch.
- 3D Release clustering layer: `web/src/lib/deck-layers.ts` provides `release-points`
  `ScatterplotLayer` rendering release origins $(x_0, y_0, z_0)$ colored by pitch type,
  bound to GPU `DataFilterExtension` uniforms; picked pitches display a highlighted
  gold `picked-release-point` marker at the exact release coordinates.
- Telemetry & controls: `ControlPanel.tsx` gains a "Release Points" toggle; `Visualizer.tsx`
  and `pitch-tooltip.ts` display spin rate (RPM), release coordinates $(x_0, z_0)$, and
  extension alongside flight metrics, announced via `aria-live`.
- Acceptance: 192 pytest tests, 96 vitest tests passing, zero TypeScript errors, clean production build.

## 15. Batter-specific strike zones, plate crossings & batter viewpoint (Sprint 7 — Completed offline)
- Batter strike zone geometry: `web/src/lib/deck-layers.ts` updates `isInsideStrikeZone` to accept
  batter-specific `szTop` and `szBot` (defaulting to standard 1.5–3.5 ft bounds) and adds
  `batterStrikeZoneSegments` wireframe.
- Arrow loader extraction: `web/src/lib/arrow-loader.ts` extracts `sz_top` and `sz_bot` columns into
  `PitchDatum` without copying buffers.
- Plate crossings layer: `web/src/lib/deck-layers.ts` adds `plate-crossings` `ScatterplotLayer` rendering
  each pitch's exact crossing position $(plate\_x, 1.417, plate\_z)$ at the plate plane, bound to the
  same GPU `DataFilterExtension` uniform filters.
- Highlighted interactions: hovering/picking a pitch renders a gold `picked-plate-crossing` point and
  a cyan `picked-batter-strike-zone` wireframe box reflecting that batter's true physical strike zone.
- Batter POV & controls: `CAMERA_VIEWS` gains a `Batter` viewpoint preset (facing straight toward the
  mound from home plate); `ControlPanel.tsx` gains a "Plate Crossings" toggle; `pitch-tooltip.ts` formats
  batter zone bounds (e.g. `Zone [1.6, 3.8] ft`).
- Acceptance: 192 pytest tests, 103 vitest tests passing across 6 test files, zero TypeScript errors.

## 16. Pitch tunneling metrics, commitment plane points & 2D movement profile (Sprint 8 — Completed offline)
- Tunneling physics & kinematics: `COMMITMENT_PLANE_Y_FT = 23.8` ft (decision threshold ~150-175ms before
  plate arrival) defined in both Python (`ingestion/worker.py`) and TypeScript (`web/src/lib/kinematics.ts`);
  `solve_commitment_time` / `solveCommitmentTime`, `commitment_position` / `commitmentPosition`, and
  `tunneling_distance` / `tunnelingDistance` (Euclidean separation in inches at $y = 23.8$ ft) with mirrored tests.
- Arrow loader extraction: `web/src/lib/arrow-loader.ts` derives `commitmentPoint` directly from kinematics
  and stores it on `PitchDatum` without buffer copies.
- 3D Tunneling points & picked highlights: `web/src/lib/deck-layers.ts` adds `tunnel-points` `ScatterplotLayer`
  rendering commitment markers at $(x_{commit}, 23.8, z_{commit})$, filtered via `DataFilterExtension` uniforms;
  hovering a pitch renders a gold `picked-tunnel-point` marker at the commitment plane.
- Tooltip & accessibility: `pitch-tooltip.ts` formats tunneling coordinates (e.g. `Tunnel (+0.3, 3.2) ft`),
  announced to screen readers via `aria-live` and rendered in `Visualizer.tsx`.
- 2D Movement Profile (Arsenal Break Chart): `web/src/components/BreakChart.tsx` and `web/src/lib/break-chart-math.ts`
  render a pure SVG overlay plotting Induced Vertical Break (IVB) vs Horizontal Break (HB) in inches with quadrant
  axes centered on the ghost pitch $(0, 0)$, bidirectional picking synchronization with 3D trajectories, and
  a toggle in `ControlPanel.tsx`.
- Acceptance: 198 pytest tests, 119 vitest tests passing across 7 test files, zero TypeScript errors, clean build.

## 17. Arsenal clustering & pitch-pair tunneling ratio (Sprint 9 — Completed offline)
- Arsenal cluster centroids: calculate mean release point $(\bar{x}_0, \bar{y}_0, \bar{z}_0)$, mean break $(\overline{\text{IVB}}, \overline{\text{HB}})$,
  and mean commitment point $(\bar{x}_{commit}, 23.8, \bar{z}_{commit})$ per pitch type in an arsenal.
- Pitch-pair tunneling ratio: compute tunneling separation $\Delta_{\text{tunnel}}$ at $y = 23.8$ ft and plate divergence $\Delta_{\text{plate}}$
  at $y = 1.417$ ft between any two pitch types; calculate the Deception Tunnel Ratio $\mathcal{R} = \frac{\Delta_{\text{plate}}}{\Delta_{\text{tunnel}}}$.
- Visual sequencing: `web/src/components/PairComparisonPanel.tsx` interactive pair selector and metrics display;
  `paired-tunnel-envelope` and `paired-centroid-paths` Deck.gl PathLayers showing the 3D divergence from release to plate.
- Acceptance: 200 pytest tests, 123 vitest tests passing across 8 test files, zero TypeScript errors, clean production build.

## 18. Ball-bat collision & contact quality simulation (Sprint 10 — Completed offline)
- Collision physics (Cross & Nathan 2006, arXiv:physics/0605040): restitution factor ($q = 0.22$) and launch vector
  $(v_{exit}, \theta_{launch}, \phi_{spray})$ derived from pitch arrival velocity at plate, bat speed, and vertical attack angle;
  mirrored in Python (`ingestion/worker.py`) and TypeScript (`web/src/lib/collision.ts`).
- Contact quality classification: Statcast Barrel criteria (expanding cone from $26^\circ\text{--}30^\circ$ at 98 mph up to $8^\circ\text{--}50^\circ$
  at high exit speeds), Solid Contact, Flare/Burner, Under, Topped, Weak, and Whiff ($d > 2.5$ in).
- Batted trajectory ballistics: 3D flight path projection `project_batted_trajectory` / `projectBattedTrajectory` incorporating
  aerodynamic damping and parabolic gravity flight into the outfield.
- Visuals & 3D Deck.gl rendering: `simulated-batted-trajectory` PathLayer and `simulated-landing-spot` ScatterplotLayer
  color-coded by contact quality; "Contact Sim (Bat)" toggle and bat speed / attack angle controls in `ControlPanel.tsx`.
- Telemetry & Tooltip: `pitch-tooltip.ts` formats simulated exit speed, launch angle, contact quality, and projected landing distance
  (e.g. `Sim: 109.6 mph (Barrel) • 375.7 ft`), announced via `aria-live`.
- Acceptance: 205 pytest tests, 130 vitest tests passing across 9 test files, zero TypeScript errors, clean production build.

## 19. Release dispersion ellipsoids & pitcher fatigue degradation (Sprint 11 — Completed offline)
- Release repeatability: 3D spatial covariance matrix $\mathbf{\Sigma}_{release}$ and $1.5\sigma$ confidence wireframe
  ellipsoids (equator, 2 meridians, 2 latitude parallels); mirrored in Python (`ingestion/worker.py`) and TypeScript
  (`web/src/lib/dispersion.ts`).
- Inning & pitch-count degradation: `compute_fatigue_buckets` / `computeFatigueBuckets` partitions pitches into count buckets
  ($1\text{--}25, 26\text{--}50, \dots$) tracking velocity degradation $\Delta v$, arm slot drop $\Delta z_0$ (inches),
  extension change $\Delta \text{ext}$, and bucket whiff rates.
- 3D Wireframe rendering: `release-dispersion-ellipsoid` PathLayer at the mound depicting 3D spatial release consistency.
- UI HUD & Controls: `web/src/components/FatiguePanel.tsx` displays arm repeatability ($\sigma_x, \sigma_z$, volume)
  and degradation by pitch count; "Release Dispersion (1.5σ)" and "Fatigue Analysis" toggles in `ControlPanel.tsx`.
- Acceptance: 208 pytest tests, 135 vitest tests passing across 10 test files, zero TypeScript errors, clean production build.

## 20. Strike zone spatial density & BigQuery GIS heatmaps (Sprint 12 — Completed offline)
- BigQuery GIS strike zone polygon query: `warehouse/ddl/04_strike_zone_density.sql` uses `ST_CONTAINS` with
  `plate_location` (`ST_GEOGPOINT(plate_x, plate_z)`) and 3x3 strike zone polygons plus outer chase shadow zones,
  enforcing `require_partition_filter` cost guards (`f.game_date = @target_date`).
- Static SQL verification: `test_strike_zone_density_query_cost_guards` in `ingestion/tests/test_warehouse_sql.py`
  validates partition filter enforcement and GIS polygon containment.
- Client spatial density & colormaps: `web/src/lib/heatmap.ts` implements `computeStrikeZoneHeatmap` across an $N_X \times N_Z$
  grid at the plate plane ($y = 1.417$ ft) with Viridis-inspired density gradient and magenta/crimson whiff frequency gradient.
- Deck.gl GPU rendering: `strike-zone-heatmap` PolygonLayer at $y = 1.417$ ft rendering semi-transparent colored cell quads.
- Interactive controls: "Zone Heatmap" toggle and "Density" vs "Whiff %" mode selector in `ControlPanel.tsx`, wired through
  `App.tsx` and `Visualizer.tsx`.
- Acceptance: 209 pytest tests, 139 vitest tests passing across 11 test files, zero TypeScript errors, clean production build.

## 21. Production GCP cutover & live BQML training (Sprint 13 — Completed offline)
- Infrastructure: Terraform provider schema validation and configuration verified (`terraform validate`);
  `google_billing_budget.hard_ceiling` wired with `all_updates_rule` to `google_pubsub_topic.billing_alerts`
  maintaining the strict $4/mo budget ceiling; Cloud Run serving service revision scaling configured with
  scale-to-zero (`min_instance_count = 0`, `max_instance_count = 5`).
- Machine learning evaluation: `warehouse/bqml/evaluate_whiff_model.sql` evaluates model performance metrics
  (`roc_auc`, `accuracy`, `precision`, `recall`, `f1_score`, `log_loss`) with strict partition filter
  enforcement (`game_date = @target_date` and `is_swing = 1`) against the in-warehouse BOOSTED_TREE_CLASSIFIER.
- Cutover & preflight harness: `infra/cutover.py` provides automated verification across Terraform,
  BigQuery DDL sequence (01 bronze, 02 fct, 03 curate, 04 strike zone density), BQML cost-guards, and
  AUC evaluation threshold (AUC $\ge 0.70$).
- Acceptance: 224 pytest tests, 139 vitest tests passing across 11 test files, zero TypeScript errors, clean production build.

## 22. Scenario demo: six curated 500-pitch groups (Completed offline)
- `ingestion/scenarios.py`: seeded, physically consistent generators (Tunnel Vision, Fatigue Arc,
  Ghost Break, Chase Map, Contact Lab, Corpus Slice); exactly six groups, 500 pitches each, all seeded and byte-stable.
- `serving/app.py`: `GET /pitches/scenario/{id}` (Arrow IPC, ETag/304, 404 on unknown id).
- `web/src/lib/scenarios.ts`: client-side catalog + presets; `ScenarioRail`, `StoryCaption`, and
  `LensPanel` replace the always-open control footer, which becomes an "All controls" drawer.
- Contact sim hover tooltip now honors the Bat speed / Attack angle lens sliders (`pitchTooltip(pitch, batSpeed?, attackAngleDeg?)`), and the Whiff % heatmap renders as a graded hot cluster (`deck-layers.ts`).
- Chase-map and contact-lab presets do not enable the plate-crossings layer.
- Acceptance: `ingestion/tests/test_scenarios.py` pins each group's signal (tunnel ratio > 5,
  fatigue velo -2.5 mph, chase whiff 2.5x, ...); `?scenario=<id>` deep-links; 265 pytest / 147 vitest tests passing offline, zero TypeScript errors, clean production build.



