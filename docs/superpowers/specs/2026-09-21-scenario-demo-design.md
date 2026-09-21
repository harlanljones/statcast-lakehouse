# Scenario Demo: 500-Pitch Groups + UI Rehaul

Date: 2026-09-21 · Status: approved design, pre-implementation

## Goal

The demo currently shows one undifferentiated random synthetic day. Replace it
with six curated groups of 500 pitches, each built to showcase one use case
from `docs/ROADMAP.md` / `docs/research/market.md`, and rehaul the UI around
picking a group and reading its story.

## Constraints (from AGENTS.md / TDD.md)

- Arrow IPC only on the serving path; no JSON there.
- `worker.SCHEMA`, `mlb_client.COLUMN_MAP`, and DDL are unchanged.
- Kinematics constants are unchanged (Python/TS mirror stays intact).
- No CPU-side per-frame filtering; sliders bind to `DataFilterExtension` uniforms.
- Offline: no GCP, no network needed for tests or the demo.

## Groups

Each is exactly 500 pitches, seeded and deterministic.

| id | Title | Built-in signal | Preset lens |
|---|---|---|---|
| `tunnel-vision` | Tunnel Vision (S8-9) | FF vs SL/CH from one arm slot: commitment points within ~1 in, plate divergence > 20 in | tunneling plane, pair comparison, Pitcher view |
| `fatigue-arc` | Fatigue Arc (S11) | One starter: velo -3 mph, arm slot z0 -3 in, release scatter widening across pitch order | dispersion ellipsoid, fatigue panel, Side view |
| `ghost-break` | Ghost Break (S5, S8) | Movement-heavy arsenal, wide IVB/HB spread | ghost trajectories, break chart |
| `chase-map` | Chase Map (S12) | Whiffs concentrated in low-away chase zone | whiff-% heatmap, out-of-zone filter, Catcher view |
| `contact-lab` | Contact Lab (S10) | Mistake pitches (barrels) mixed with well-located (weak contact) | contact sim + bat speed / attack angle, Batter view |
| `corpus-slice` | Corpus Slice (market.md) | Multi-pitcher mixed day, varied release points | GPU sliders/filters only, no preset layers |

## Data and serving

- New `ingestion/scenarios.py`: registry `SCENARIOS: dict[str, Callable[[], pa.Table]]`
  of seeded generators built on the `synth_pitch` conventions. Output uses
  `worker.SCHEMA` and a fixed `ingestion_time` for byte stability.
- `serving/app.py`: `GET /pitches/scenario/{id}` returns Arrow IPC with sha256
  ETag / 304 via the existing `_arrow_response`; unknown id -> 404. Bodies cached
  per id like `_sample_body`.
- The catalog (title, blurb, "what to look for", "try this", preset) lives in
  `web/src/lib/scenarios.ts`, not on the server, so serving stays JSON-free. The
  catalog shape doubles as the manifest for future real-slice (BigQuery) groups.

## UI

- **Scenario rail**: six cards (title, one-line hook, glyph). Default on load:
  `tunnel-vision`; `?scenario=<id>` deep-links.
- **Preset application**: selecting a card sets layers, camera, filters, heatmap
  mode, and pair selection in one batch, then resets flight progress.
- **Story caption**: what to look for + a "try this" nudge.
- **Lens panel**: only controls relevant to the active group (progressive
  disclosure). All existing toggles remain reachable in an "All controls" drawer.
- **Live data**: existing date-partition picker moves under a "Live data" entry.
- `App.tsx` signal sprawl moves behind a preset-applier (`applyPreset`) so a
  scenario is data, not code. `ControlPanel.tsx` is split into Lens and drawer.
- Visual pass via the frontend-design skill during implementation.

## Testing

- pytest (`ingestion/tests/test_scenarios.py`): 500 rows each; determinism;
  schema equality with `worker.SCHEMA`; fatigue velo slope < 0 and z0 slope < 0;
  tunnel-vision commitment distance << plate divergence; chase-map whiff
  concentration in chase zone; contact-lab spans barrel and weak classes.
- pytest (`serving/tests`): endpoint returns 500-row Arrow, ETag/304, 404 on
  unknown id.
- vitest: catalog completeness (every server id has a preset and copy),
  `applyPreset` output per group, deep-link parsing.
- Gates: `python3 -m pytest -q`, `cd web && npm test`, `npm run build`,
  `npx tsc -p web/tsconfig.json --noEmit`; then a browser check of each group.

## Out of scope

Real BigQuery slices (manifest leaves room), warehouse/infra changes, new physics.
