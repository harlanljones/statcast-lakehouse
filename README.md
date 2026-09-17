# Statcast Lakehouse

MLB Statcast lakehouse + real-time 3D pitch-trajectory visualizer. Ingests
Statcast telemetry into BigQuery, trains an xWhiff model in-warehouse (BQML),
serves Apache Arrow over HTTP, and renders GPU-filtered 3D trajectories
client-side (SolidJS + Deck.gl). Targets <$5/mo GCP spend; see `TDD.md`.

Status: the full offline pipeline is implemented and tested — ingestion
(dry-run synthesis, live + multi-day backfill with retry hardening), batch
export with a manifest, BigQuery DDL/BQML with cost- and schema-parity guards,
Arrow IPC serving (ETag/304 caching, date index, manifest-driven cold batches),
and the full 3D web visualizer (GPU filtering, legend, tooltips). 170 pytest
and 57 vitest suites pass with no GCP credentials. GCP-bound remaining work is
ROADMAP items 1–2 only: `terraform apply`/DDL bring-up and training
`model_pitch_whiff` against live data (`--live` needs GCP creds).

## Quick start

```sh
# Synthetic sample day -> local Arrow file (offline)
python3 -m ingestion.worker --dry-run --pitches 300 --out data/sample.arrow

# Full test suite: 170 passed (includes warehouse cost-guard + schema-parity)
python3 -m pytest -q

# Web visualizer tests: 57 passed; then build
cd web && npm install && npm test && npm run build

# Batch export from BigQuery partitions (needs GCP creds; tests inject a client)
python3 -m ingestion.export_batch --date 2026-09-14 --out data/2026-09-14.arrow
python3 -m ingestion.export_batch --date-range 2026-09-12 2026-09-14 \
    --out data/batches --compression zstd --manifest

# Live multi-day backfill (MLB API -> BigQuery Storage Write; needs GCP creds)
python3 -m ingestion.worker --live --backfill 2026-09-12 2026-09-14

# Serve Arrow over HTTP (ETag/304, /pitches/dates)
uvicorn serving.app:app
# /pitches/cold serves manifest-driven batches; point STATCAST_BATCH_DIR at a
# directory containing an exported manifest.json (defaults to data/batches)
STATCAST_BATCH_DIR=data/batches uvicorn serving.app:app
```

## Docs

- `TDD.md` — the technical design document (source of truth)
- `AGENTS.md` — agent operating manual (start here if you are an agent)
- `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`
