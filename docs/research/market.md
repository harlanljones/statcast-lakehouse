# Statcast 3D Pitch-Trajectory Visualization — Market & Competitor Decision Matrix

Snapshot date: 2026-09-15. Verified with web_search + `gh repo view` (stars/license/last push) the same day.

## Findings summary

**First-party check (critical):** MLB already ships 3D pitch visualization for free. Baseball Savant's "Statcast 3D Pitch Visualizations" (baseballsavant.mlb.com/visuals) renders per-pitcher 3D trajectories from official Hawk-Eye data; MLB.com GameDay layers animated pitch tracks on broadcasts. Anything that is *just* "view a pitch in 3D from Statcast data" is re-implementing a free first-party feature.

**Hardware vendors (closed ecosystems):**
- **TrackMan** — radar, the MLB standard; high five-figure cost, closed data, club-facing.
- **Rapsodo** — camera-based, ~$3–4K, trusted by all 30 MLB orgs per vendor; consumer/college prosumer tier. Owns its data + cloud; no public trajectory API.
- **Hawk-Eye** (Sony) — MLB's in-stadium optical system since 2020; powers Statcast itself. No direct product for outsiders; the data flows to MLB.
- **Diamond Kinetics** — bat-swing sensor + iOS app, ~$50 sensor + subscription; youth/dev consumer market. Different axis (swing, not pitch).

**Analysis-layer vendors (open data, paid product):**
- **6-4-3 Charts** — the closest commercial analogue: interactive web stats, pitch-tracking ingestion, scouting reports from public data; 900+ college programs (2026). Sells workflow/reports, not viz.
- **Driveline / TRACKED (+ TRAQ, Pulse)** — training-program management platform; data capture is a feature of coaching, not the product.

**Open source (cross-checked via gh, 2026-09):**
- jldbc/pybaseball — 1,723★, MIT, pushed 2026-01. The Statcast data-access substrate.
- chonyy/ML-auto-baseball-pitching-overlay — 314★, no license, pushed 2024-06. Auto pitch classification + matplotlib overlays; static 2D output.
- timothyf/baseball-data-lab — 18★, MIT, pushed 2026-07. Summary sheets, static plots.
- alex-rimerman/statcast-mcp — 35★, no license, pushed 2026-04. LLM/agent access to Statcast.
- tnestico/pitching_summary (27★, 2024-08), beanumber/statcastr (14★, 2019, stale), matteosox/statcast (14★, 2018, stale), airalcorn2/batter-pitcher-2vec (88★, MIT, 2023).

**The architectural fork that splits the field:** *where the data comes from and how far the user can push it.* Closed-hardware vendors own acquisition (and lock data inside their clouds). Everything built on public Statcast inherits MLB's data but stops at **static/batch**: matplotlib charts, CSV downloads, scheduled reports — including Savant itself, whose 3D viewer is pre-rendered per-pitcher pages you cannot filter, query, or combine. **Nobody in the field offers interactive, GPU-filtered 3D over the full pitch-level Statcast corpus with arbitrary slicing.** That gap is real but narrow — it's a UX/infra gap, not a data gap.

## Decision matrix

Scores 1–5. Pain = how much users hurt for it; Fit = fit for a SolidJS+Deck.gl lakehouse project; Coverage = how well incumbents + first-party already solve it; First-party risk = MLB absorbing the wedge (5 = fatal); Defensibility.

| Segment | Pain | Fit | Coverage | 1P risk | Defensib. | Verdict |
|---|---|---|---|---|---|---|
| Generic 3D pitch viewer (per-player) | 3 | 4 | 5 (Savant ships it, free) | 5 | 1 | **DROP** — literally free already |
| Static batch analytics / reports (6-4-3 territory) | 4 | 2 | 4 | 2 | 2 | **DROP** — crowded, needs workflow/sales |
| Hardware pitch/swing capture (Rapsodo/DK space) | 4 | 1 | 3 | 1 | 5 | **DROP** — capital, no fit |
| LLM/agent layer over Statcast (statcast-mcp space) | 3 | 3 | 2 | 2 | 3 | **WATCH** — adjacent, could integrate |
| Interactive GPU-filtered 3D viz over full Statcast corpus (exploratory slicing, real-time filter, lakehouse-backed) | 3 | 5 | 3 (Savant is pre-rendered, not queryable) | 4 | 3 | **BUILD** — the only unserved UX gap; moat is the combination (BigQuery scale + streaming + GPU filtering), not any single feature |
| Streaming/live game-time viz fed from Statcast feeds | 4 | 4 | 2 | 5 | 2 | **WATCH** — best demo value, but MLB ToS/control of live feeds is the cliff |

## Positioning

- **What to build:** the exploratory layer — a lakehouse (BigQuery) + Deck.gl/SolidJS front end that can slice the entire pitch-level Statcast history in real time (filter by pitch type, spin, movement, count, player, arbitrary cross-filters, GPU point-instantiation of every pitch). Frame it as "what Savant's 3D page would be if it were a query engine": portfolio/technical-demo positioning, not a product pivot into scouting reports.
- **What to sit on top of:** pybaseball / MLB Stats API + public Statcast CSV for ingestion; MLB's published movement conventions (inches, degrees) so visuals are comparable to Savant. Stay read-only on public data.
- **What not to compete with:** do not chase Savant on stat leaderboards, do not build scouting-report workflows against 6-4-3 Charts' paying college market, do not touch hardware (Rapsodo/TrackMan/DK), and do not sell "pitch design" — that's Driveline's coaching-driven business.
- **First-party doctrine:** treat Savant as a floor, not a ceiling — anything pre-rendered there, go interactive; anything interactive there, go corpus-scale. Never depend on a wedge MLB could ship in one sprint.

## Open risks

1. **MLB ToS / data terms** — Statcast data is public but MLB licenses it; a portfolio project is fine, any public monetization needs a terms review.
2. **First-party expansion** — MLB modernizes Savant continuously; the queryable-3D gap may close or partially close. Mitigate by staying corpus-scale (2015→present, billions of rows), which MLB's per-player pages won't.
3. **Live-feed access** — real-time gameday feeds are unofficial endpoints that break without notice; build batch-first, streaming as a bonus.
4. **GLTF/trajectory fidelity** — Hawk-Eye's full-resolution trajectory data is proprietary; public Statcast exposes sampled points, so 3D rendering involves interpolation choices that can look "wrong" vs Savant's official renders.
