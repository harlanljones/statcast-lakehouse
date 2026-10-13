# Optimizations — specified, with the evidence that justifies each

Written 2026-10-13 from the autoresearch session's own measurements. Every item names the measured fact it rests
on, the change, the expected effect **with its basis**, an acceptance check that can be run, and its risk.
Anything already tried and refuted is listed at the end so it does not get re-specified.

**Method rules that this session earned** (they apply to every item below):
- Measure first. Four separate readings in this session were misread before being measured.
- For anything timing-related, take a **contemporaneous control pair** (worktree at a known commit; compare
  `ts_calib_ms`, but trust the control's own score, not the calibration) and require two consistent readings.
- For anything outside the measured workload, **byte-identical `ts_checksum`/`py_checksum` is the proof of
  neutrality**. Where a change *is* in the workload, the checksum is still the proof it changed nothing else.
- Never edit `autoresearch.sh`, `bench/` or `web/bench/` to make a number move.

---

## O1 — Render-loop frame cost: MEASURED AND REFUTED at current scene sizes

**Measured 2026-10-13 in the browser**, during flight playback (the only time deck.gl re-renders per frame),
sampling `requestAnimationFrame` deltas for 3 s on the largest slice (`short-centre-fields`):

| visible pitches | frames | p50 | p95 | worst | fps |
|---|---|---|---|---|---|
| 3,687 (the whole slice) | 179 | **17 ms** | 18 ms | 18 ms | 58.8 |
| 388 (inning 1) | 178 | **17 ms** | 18 ms | 20 ms | 58.8 |

A **9.5× reduction in visible rows changes nothing**: both states sit at the display's vsync ceiling (58.8 fps
≈ 60 Hz), so the GPU is nowhere near the draw cost at the sizes this app actually renders. The scaling law from
deck.gl [RFC #10781](https://github.com/visgl/deck.gl/issues/10781) (a discard mask costs *total* rows, 6.17 ms
→ 1.80 ms with compaction at 4 M rows) is real, but it applies to the **full 62,741-pitch corpus — which the app
never loads into one scene**: it loads one slice of at most ~3.7 k paths (222 k vertices), which is what the
table above measures.

**Action now: none.** Revisit only if a single scene ever holds the whole corpus (e.g. a "load everything" mode);
the candidates stay as recorded — `filterShaderPlugin` (GLSL+WGSL, WebGL2 today, low risk) before any experimental
WebGPU compaction — and the idempotent check remains the same before/after frame table at two filter
selectivities.

---

## O2 — Retire per-pitch object allocation (GC is 12.4% of self-time)

**Evidence.** A CPU profile puts **GC at 12.4%** of all self-time; the loader builds 4 objects per pitch
(`PitchKinematics`, `BreakVector`, `commitmentPoint`, the `PitchDatum` row) across 62,741 rows, and the parse
stage scales **2.67–2.74× per 1.99× rows** with identical code, which is the GC cost growing with the heap.
Isolated sizing bounds the whole app-side per-pitch headroom at **≈110 ms per parse** — the Arrow decode is 55%
of the loader and is not ours to optimize.

**Change.** Extend the pattern that already worked (run 91: one `Float32Array` for all paths plus per-pitch views,
**byte-identical checksums**, stages −2.4…−4.9%) to the remaining per-pitch objects: a structure-of-arrays for the
kinematic columns, and either inline the two derived objects as flat numbers or compute them lazily at their
(three) consumers. `breakVector` and `commitmentPoint` are each read by the break-chart/tunnel/parity paths, so
their removal has to be a shape change with those consumers updated in the same commit.

**Expected effect.** Bounded: **≤ +4–5% on the score at absolute best**, since the decode dominates. Do this for
the app's load latency, not for the metric.

**Acceptance.** `ts_checksum` and `py_checksum` byte-identical and parity 62,741/62,741 (the change must be
behaviour-preserving by construction); stage timings taken as a control pair; `node --cpu-prof` showing GC's share
fall.

**Risk.** A broad shape change touching every consumer; do it in two commits (SoA first, derived objects second)
so the checksum isolates each.

---

## O3 — Accuracy: model the break as two components (Magnus + seam-shifted wake)

**Evidence.** This session measured that "the induced break sits a fixed angle from `spinDirection`" holds on one
game (306 pitches, ≈180°) and **fails across eight** (median −99.8°, only 34.6% within 10° of 180°). The physics
explains it: movement = Magnus lift (along ω̂×v̂) **plus a non-Magnus side force from the seam-shifted wake** — a
sinker's movement shifts ~34° from Magnus, a four-seamer's ~5°, growing as spin efficiency drops
([Nathan, Hawkeye spin II](https://baseball.physics.illinois.edu/HawkeyeSpinAnalysis-MLB-Part%20II-v2-public.pdf),
[III](https://baseball.physics.illinois.edu/hawkeye-4s-2s.pdf); [Smith & Smith 2021](https://journals.sagepub.com/doi/10.1177/1754337120961609)).

**Change.** Reconstruct transverse spin, gyrospin and spin efficiency from the fields we already store
([Nathan's recipe + addendum](https://baseball.physics.illinois.edu/trackman/SpinAxis.pdf)), then present the break
as **lift + side** instead of one angle; use C_L = A[1−exp(−BS)] with A = 0.336, B = 6.041 for the lift term.
Do **not** add a spin-decay term — [measured negligible](https://baseball.physics.illinois.edu/spindown-rev1.pdf)
(1/e ≈ 20–25 s over a 0.4 s flight).

**Expected effect.** The scatter we measured should collapse into the side term; the UI gains a second, honest
number rather than an angle we cannot interpret.

**Acceptance (falsifiable).** For a held-out set of games, the per-pitch residual between the observed induced
break and (lift + side) must be materially smaller than the single-angle model's — reported per pitch type, with
the two-component model *not* fitted per game.

**Risk.** The SSW side force depends on seam orientation, which is only partially observable; state the residual
rather than claiming a prediction.

---

## O4 — Accuracy: make the tunnel point time-based

**Evidence.** Our commitment point is a fixed distance (y = 23.8 ft). Baseball Prospectus used the same
fixed-distance convention (23.4 ft) and [abandoned it](https://www.baseballprospectus.com/news/article/37436/prospectus-feature-updating-pitch-tunnels/)
because flight time varies by pitch, moving to a **time-based frame 150 ms before the plate**.

**Change.** Compute the commitment point at a fixed *time* before plate arrival (using the existing
`solve_flight_time`), keeping the current geometry but making the plane pitch-dependent; optionally expose release
distance and a pre-tunnel maximum like BP's revision.

**Expected effect.** Tunnelling comparisons across pitch types become meaningful instead of systematically biased
by velocity.

**Acceptance.** The commitment y-coordinate becomes a function of flight time (assert two pitches with different
speeds commit at different y); the tunnel ratio's existing tests are re-derived, not re-pinned.

**Risk.** Small, contained, and it invalidates a documented product behaviour — so it needs an explicit note in
the card copy that the frame is now time-based.

---

## Already measured and closed — do not re-specify

| idea | why it is closed |
|---|---|
| Serve one Arrow record batch so `getChild().toArray()` becomes a view | **Checked 2026-10-13 and refuted**: served payloads are single-chunk already (max 1 chunk across all 42/44 columns for `/pitches/sample` and `/pitches/scenario/blowouts`), because scenario tables are built in one batch and `export_batch.py` calls `combine_chunks()`. |
| Decode fewer of the ~30 columns | `getChild().toArray()` costs **0.0 ms** — it returns a view, not a copy, on single-chunk data. |
| Faster zstd (WASM vs JS) | Already done: the loader registers pure-JS `fzstd` only as a fallback and `ensureZstdDecoder()` swaps in WASM `zstddec`, warmed while the fetch is in flight. |
| Server-side decode shortcut | The decode is `apache-arrow`'s own work (55% of the loader, 19.3% of the profile); upstream's decode-perf items ([arrow-js #58](https://github.com/apache/arrow-js) "use transfer instead of memcpy") are unmerged. Nothing to adopt by upgrading. |
| Add spin decay to the trajectory | Measured negligible over a pitch's flight (see O3). |
| Re-tune `passesFilters` | 6.8 ms for **4 filter states × 62,741 pitches** (≈27 ns/pitch) — it is already at the floor, and it is a bench-side loop, not an app bottleneck. |
| Add a cache keyed on the corpus | Forbidden by this project's rules; the ETag cache in the loader is URL-keyed conditional revalidation (the server's own 304), which never touches the measured path. |
