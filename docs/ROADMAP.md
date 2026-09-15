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

## 5. Research integration (done — fold into build decisions)
- `docs/research/market.md` — competitor decision matrix. Headline: Savant
  ships free per-pitcher 3D; the build verdict is corpus-scale interactive
  GPU 3D ("Savant 3D as a query engine"), not a generic viewer. Honors the
  positioning rules in that doc when adding features.
- `docs/research/literature.md` — kinematics + whiff-model citations. Use
  the 9-parameter fit validation (Nathan 2012) and swing/whiff modeling
  refs (Powers & Yurko 2025; Yee & Deshpande 2023) when choosing xWhiff
  features (ROADMAP item 2).
