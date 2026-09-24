# AGENTS.md

## What this is

Statcast Lakehouse: ingest MLB Statcast pitch telemetry into BigQuery
(free-tier-bounded), transform/train in-warehouse (BQML xWhiff model), serve
Apache Arrow IPC over HTTP, and render 3D pitch trajectories client-side with
SolidJS + Deck.gl and GPU-side filtering. `TDD.md` is the source of truth —
do not contradict it.

## Environment

- Python 3.12 (stdlib + pyarrow for the dry-run path). GCP creds required
  only for `--live`, BigQuery, and BQML.
- Node 26 / npm for `web/` (SolidJS + Vite + deck.gl + apache-arrow).
- Terraform 1.16 for `infra/` (not applied as part of normal dev).
- No services or network needed for tests; everything runs offline.

## Commands (all verified)

```sh
python3 -m pytest -q                                                # 314 tests (ingestion + serving + export + infra)
python3 -m ingestion.worker --dry-run --pitches 300 --out data/sample.arrow
cd web && npm test                       # vitest, 205 tests
cd web && npm run build                  # vite build -> dist/
npx tsc -p web/tsconfig.json --noEmit    # typecheck (run from repo root)
```

`serving/app.py` needs `pip install -r ingestion/requirements.txt` plus
uvicorn; the live BigQuery load-job path needs GOOGLE_APPLICATION_CREDENTIALS.

## Layout

- `ingestion/` — worker (kinematics solver, dry-run writer over the
  checked-in real pitches, load-job write path), MLB Stats API client, tests. Add row-mapping changes to
  `mlb_client.COLUMN_MAP` and keep the schema in `worker.SCHEMA` in sync.
- `warehouse/ddl/` — BigQuery DDL in numeric order (bronze -> curated ->
  per-day MERGE). `warehouse/bqml/` — model training + batch inference SQL.
- `infra/main.tf` — dataset, budget guard, Cloud Run job, scheduler. Cloud
  Run lives in main.tf (not a separate cloud_run.tf).
- `serving/` — FastAPI Arrow endpoints (`/pitches?date=`, `/pitches/sample`).
- `data/scenarios/` — curated MLB Stats API pitch slices with story and game-feed provenance; `ingestion/scenario_data.py` refreshes them explicitly and `ingestion/scenarios.py` serves/exports the local Arrow assets, and its `real_pitches()` backs `/pitches/sample` and `worker --dry-run` (no generated pitches anywhere). `web/src/lib/scenarios.ts` holds the story cards and presets (keep ids in sync).
- `web/src/lib/` — kinematics solver (TS), Arrow loader, deck layer config.
  `web/src/components/` — Solid components. Tests live next to the code
  (`*.test.ts`).
- `docs/` — ARCHITECTURE, ROADMAP, research notes. `TDD.md` at root.

## Conventions

- Kinematics constants are shared physics: the Python solver
  (`ingestion/worker.py`) and the TS solver (`web/src/lib/kinematics.ts`)
  must stay numerically identical — change both or neither; both have
  mirrored tests pinning the same closed forms.
- The warehouse never ships precomputed trajectories; clients recompute the
  60-point path from the 9 kinematic parameters.
- Queries must always filter on `game_date` (require_partition_filter is
  TRUE; free-tier scan budget is the constraint).
- Ingestion writes with BigQuery batch load jobs only — never legacy `tabledata.insertAll` streaming.
- Web tests: vitest; Python tests: pytest under `ingestion/tests/`.

## Non-goals / invariants

- No paid-tier GCP usage; the $4/mo budget guard in infra must stay.
- No JSON serialization on the serving path — Arrow IPC only.
- No CPU-side per-frame filtering in the web app: slider interactions bind
  to Deck.gl DataFilterExtension uniforms.
- `fct_pitches` schema changes require updating `worker.SCHEMA`, the DDL,
  and `mlb_client.COLUMN_MAP` together.

## Depth

- Architecture and data flow: `docs/ARCHITECTURE.md`
- Next steps with acceptance criteria: `docs/ROADMAP.md`
- Market/literature research: `docs/research/`
