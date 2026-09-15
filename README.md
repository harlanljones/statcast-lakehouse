# Statcast Lakehouse

MLB Statcast lakehouse + real-time 3D pitch-trajectory visualizer. Ingests
Statcast telemetry into BigQuery, trains an xWhiff model in-warehouse (BQML),
serves Apache Arrow over HTTP, and renders GPU-filtered 3D trajectories
client-side (SolidJS + Deck.gl). Targets <$5/mo GCP spend; see `TDD.md`.

Status: skeleton — ingestion and kinematics are implemented and tested;
BigQuery/BQML/Cloud Run paths are written but only runnable against GCP.

## Quick start

```sh
python3 -m ingestion.worker --dry-run --pitches 300 --out data/sample.arrow
python3 -m pytest ingestion/tests -q
cd web && npm install && npm test && npm run build
```

## Docs

- `TDD.md` — the technical design document (source of truth)
- `AGENTS.md` — agent operating manual (start here if you are an agent)
- `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`
