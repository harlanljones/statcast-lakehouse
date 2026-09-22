# Handoff

State of the project and the work that remains. Written 2026-09-22 against `main` at `ece3b3d`.
Read `AGENTS.md` first for the rules, then this file for where things stand.

## Snapshot

| Area | State |
|---|---|
| Live demo | https://statcast-lakehouse.pages.dev (static, six synthetic scenarios). Redeploys on every push to `main`. |
| CI | `python-tests`, `web-tests`, `terraform-lint`, `docker-build`; all green on `main`. |
| Tests | 277 pytest, 193 vitest, `tsc` clean. No cloud account needed. |
| Warehouse | 22 real game days (2024-06-02 to 06-23) in `fct_pitches`, about 84k pitches. |
| Model | `model_pitch_whiff` (trained on one day) and `model_pitch_whiff_v2` (trained on 06-02 to 06-15). |
| Ingestion | Live path verified against real BigQuery: 21 days loaded with load jobs, none failed. |

**What shipped:** six seeded 500-pitch scenarios and an API endpoint for them, the scenario-driven UI, a static Cloudflare Pages deploy, camera navigation (scroll zoom, drag rotate or pan, reset), a pitch and player card with MLB links, GCP bring-up fixes, and the load-job write path with three-year retention.

## How to work here

- **Commits are made by the human.** Commits are SSH-signed through 1Password and agents cannot sign. Stage with explicit paths, then ask for the commit and push commands. The commit-msg hook rejects subjects over 100 characters.
- **Do not `git add -A`.** Keep unrelated local files out of commits. `infra/terraform.tfvars` holds the real project and billing ids. It is gitignored and must stay local.
- **Flow that worked:** branch from `main`, build test-first, run the gates, push, `gh pr create`, wait for all four checks, then the human merges. Auto-delete on merge is on.
- **Isolating work:** `git worktree add` from `origin/main` keeps a dirty working tree from leaking into a commit.
- **GCP:** ADC credentials exist on the maintainer's machine. Their default project is not this one, so **always pass `--project <gcp-project>` explicitly.** The project id is in `infra/terraform.tfvars`.
- **Rules that changed:** ingestion now writes with BigQuery batch load jobs, not the Storage Write API (see `AGENTS.md`, `TDD.md` section 3.2). Partition expiration is 1095 days.

```sh
python3 -m pytest -q && (cd web && npm test) && npx tsc -p web/tsconfig.json --noEmit
uvicorn serving.app:app --port 8000        # API
cd web && npm run dev                      # http://localhost:5173, proxies /pitches
cd web && npm run build:static             # what Cloudflare serves (needs python3 + pyarrow)
```

One real day, end to end (read-only against the warehouse except the two writes):

```sh
python3 -m ingestion.worker --live --project <gcp-project> --date 2024-06-24   # bronze_pitches
# then run warehouse/ddl/03_curate_day.sql with @target_date = that day          # fct_pitches (idempotent)
# evaluate: warehouse/bqml/evaluate_whiff_model.sql with the same @target_date
```

## Remaining work

Ordered by value. Items 1 and 3 need a decision from the owner.

### 1. Real-data scenario in the public demo (needs a decision)

**Why:** the deployed demo is all synthetic, so the player card shows disabled links there. Real pitches make the card, and the MLB video links, worth using.

**Decisions:** (a) is real Statcast data acceptable in a public site? MLB licenses the data and `docs/research/market.md` flags a terms review for any public use; the links go out to MLB and no video is hosted. (b) Which 500 pitches? Suggested default: the first 500 of the 2024-06-16 slate, in game order.

**Approach, verified feasible:**
- MLB's public StatsAPI feed `https://statsapi.mlb.com/api/v1.1/game/{game_pk}/feed/live` gives a `playId` for every pitch (311 of 311 in the game checked). Our `pitch_id` is `{game_pk}_{at_bat_number}_{pitch_number}`, and `at_bat_number = atBatIndex + 1`, so the join is direct.
- Names: `https://statsapi.mlb.com/api/v1/people?personIds=…`.
- Video link: `https://baseballsavant.mlb.com/sporty-videos?playId=…` returned 200 and references an mp4. **Playback in a browser was not checked.**
- The public build has no GCP credentials. Export once locally (an `ingestion/export_real_scenario.py` reading BigQuery with ADC), and commit the result as static assets, about 130 KB: the Arrow file plus a sidecar JSON of names.
- Client: add a catalog entry with `synthetic: false`. The card already reads an optional `play_id` column and switches "Watch pitch" on when present; player names need a small lookup in the card.
- If `play_id` goes into the warehouse instead of a sidecar, `worker.SCHEMA`, the DDL and `mlb_client.COLUMN_MAP` must change together (`AGENTS.md`); `test_schema_parity.py` enforces it.

**Done when:** the live site shows a REAL DATA card with a working "Watch pitch" link on a pitch from the exported game.

### 2. Make the loaded 2024 data reachable in the UI

`/pitches/dates` lists only the last 30 days (`serving/app.py:265`, `INTERVAL 30 DAY`), so no 2024 partition appears in the date picker, and `fetchDatePartitions` then hides the picker. Widen the window (or read all partitions from `INFORMATION_SCHEMA.PARTITIONS`, which scans nothing) and update `serving/tests`. Do **not** reintroduce a hardcoded fallback partition.

### 3. Promote the better model (needs a decision)

| Held-out window | `model_pitch_whiff` (1 day of training) | `model_pitch_whiff_v2` (14 days) |
|---|---|---|
| 06-16 alone (2,128 swings) | AUC 0.702 | 0.732 |
| 06-16 to 06-23 (14,485 swings) | **0.691, below the 0.70 bar** | **0.732, passes** |

v2's accuracy is 0.799 against 0.783 for always predicting "no whiff", and recall is 0.219, so it is a real but modest model. The ROADMAP acceptance (AUC above 0.70 on held-out days) is met by v2 only.

**Options:** replace `model_pitch_whiff` with v2 (`CREATE OR REPLACE`; irreversible for the old model), or keep both and point serving and docs at v2. `warehouse/bqml/train_whiff_model.sql` now trains on `game_date >= '2024-01-01'`, which would include every loaded day and leave no held-out days. Add an explicit end date when retraining, then evaluate on days after it. Record the result in `docs/ROADMAP.md` item 2.

### 4. Warehouse hygiene

- **No re-run guard.** `--live` appends, so loading a day twice duplicates bronze rows. `bronze_pitches` holds 2024-06-15 twice (8,290 rows against 4,145). The curate MERGE dedups by `pitch_id`, so `fct_pitches` is correct, but bronze is not. Add a guard (skip a day whose bronze partition exists, or delete the partition before loading) with a test.
- **Retention drift.** The live tables report no partition expiration (checked through the BigQuery API), while the repo DDL says 1095 days. Either `ALTER TABLE … SET OPTIONS (partition_expiration_days = 1095)` or accept and note it.
- **Unused dependency.** `google-cloud-bigquery-storage` in `ingestion/requirements.txt` is no longer imported. Removing it touches the Docker builds, so check `docker-build`.
- **Unrelated data problem.** `--dry-run` and `/pitches/sample` use `synth_pitch`, whose `plate_x` and `plate_z` are drawn independently of the trajectory and whose `az` is positive. Those pitches are physically inconsistent. The scenario generators in `ingestion/scenarios.py` are consistent and could replace it.

### 5. Small items

- **Docs.** Confirm the three README Mermaid diagrams render on GitHub; they were never rendered locally.
- **Camera framing.** Tunnel Vision (Pitcher view) and Contact Lab (Batter view) frame their scenes small. This is tuning, best done with eyes on the result.
- **Hover debounce.** The 75 ms debounce in `Visualizer.tsx` drops a click if the mouse moves within 75 ms of it. Normal clicking is unaffected.
- **Local branches.** `feature/release-cluster-telemetry`, `feature/export-manifest-cli`, `feature/ghost-break-trajectories` and `feat/player-card` are fully merged (0 commits ahead of `main`) and can be deleted with `git branch -d`.

## Verified and not verified

**Verified in a real browser:** all six scenarios on the live site; scroll, drag, shift-drag, pan mode and reset; the card on synthetic data (all links disabled, badge, close paths) and on real 2024-06-16 pitches read from BigQuery (live Game feed and Savant links, "Watch pitch" disabled because there is no `play_id` yet).

**Verified against real BigQuery:** the load-job write path (21 days), the curate MERGE (idempotent: a rerun inserted 0 rows), and both models' evaluation.

**Not verified:**
- Touch gestures (one-finger rotate, pinch zoom); they are configured but untested.
- The zoom limit of 8 in a browser; it is covered by unit tests only.
- A "Watch pitch" link actually playing a video.
- What has actually been applied from `infra/` (Cloud Run job, scheduler, budget guard). The dataset, tables and models exist, but the Terraform state was not inspected, so ROADMAP item 1 status is unknown.

## Where things are

| Path | Notes |
|---|---|
| `ingestion/scenarios.py` | Six seeded generators; `python3 -m ingestion.scenarios --out <dir>` exports them as `.arrow`. |
| `serving/app.py` | `/pitches`, `/pitches/sample`, `/pitches/dates`, `/pitches/cold`, `/pitches/scenario/{id}`. |
| `web/src/lib/scenarios.ts` | Catalog, presets, the `synthetic` flag, deep links. |
| `web/src/lib/scenario-state.ts` | Applies a preset through a setter bag, so it is testable. |
| `web/src/lib/camera.ts` | Gesture options, zoom limits, target clamping. |
| `web/src/lib/player-card.ts` | Pitcher summary, MLB link rules, data provenance. |
| `web/src/components/` | `ScenarioRail`, `StoryCaption`, `LensPanel`, `PlayerCard`, `Visualizer`. |
| `.github/workflows/` | `ci.yml` and `deploy-pages.yml` (secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`). |
| `docs/superpowers/` | The design spec and implementation plan for the scenario demo. Historical. |
