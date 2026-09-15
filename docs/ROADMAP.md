# Roadmap

Skeleton status: ingestion worker (dry-run mode + solver) and web kinematics
are implemented and tested. Everything below is future work — no stubs in code.

## 1. GCP bring-up (Sprint 1 of TDD.md)
- `terraform apply` with real project/billing vars; run `warehouse/ddl/*.sql`
  in order.
- Acceptance: `fct_pitches` exists with require_partition_filter; a dry-run
  ingest of one real game day lands in bronze and curates via the MERGE.

## 2. Live ingestion + model (Sprint 1 cont.)
- Run `--live` via the Cloud Run job; verify Storage Write rows and partition
  pruning (query only scans one game_date).
- Train `model_pitch_whiff`; acceptance: ML.EVALUATION AUC > 0.70 on a
  held-out day.

## 3. Serving hardening (Sprint 2)
- Replace the sample endpoint's synthetic data with the real `/pitches`
  path behind Cloud Run; measure client parse time.
- Acceptance: `fetchPitches()` on a game day parses in < 10 ms in the
  browser (performance.mark spans).

## 4. Full 3D rendering (Sprint 3)
- Wire TripsLayer paths from `trajectoryFlat()` into `Visualizer.tsx` (the
  layers array is currently empty by design — see docs rule on stubs),
  add StrikeZone WireframeLayer + OrbitView controls, bind ControlPanel
  signals to DataFilterExtension `filterRange`.
- Acceptance: 120 FPS scrubbing on integrated GPU; no per-frame JS filtering.

## 5. Research integration
- Fold `docs/research/` citations into README and the model card
  (feature choices for the whiff model: which kinematics matter per the
  literature).
