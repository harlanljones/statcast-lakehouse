# Applicable work — papers and open source worth adopting

Surveyed 2026-10-13 against primary sources (the papers, official docs, the repos themselves) by four parallel
research passes. Companion to `literature.md`, which covers the kinematics/whiff-model citations already in
TDD.md; this file is about work that would **change something here**, plus one verified defect and one project
risk. Every item names what it would alter; claims that could not be verified are marked as such.

## 1. The spin axis ↔ break relation is solved — and it corrects two app features

Our own measurement refuted "the induced break sits a fixed angle from MLB's `spinDirection`" (held on one game's
306 pitches, failed across eight: median −99.8°, only 34.6% within 10° of 180°). The literature says **why**: the
real break is **Magnus lift + a seam-shifted-wake (SSW) side force**, and only the lift is aligned with the spin
axis.

- **What Is The Hawkeye Spin Data Teaching Us? II: Lift and Side Forces** (A. Nathan, 2021, rev. 2) —
  <https://baseball.physics.illinois.edu/HawkeyeSpinAnalysis-MLB-Part%20II-v2-public.pdf> — splits movement into
  "lift" (along ω̂×v̂) and "side" (entirely non-Magnus) using *exactly* our 9-parameter constant-acceleration fit.
  The action here is a **break readout with two components**, not one angle.
- **…III: Searching For The Seam-Shifted Wake** (A. Nathan, 2023) — <https://baseball.physics.illinois.edu/hawkeye-4s-2s.pdf> —
  quantifies it: a sinker's movement shifts ~34° from the Magnus direction, a four-seamer ~5°, and the shift grows
  as spin efficiency drops. This is the mechanism behind our scatter.
- **Using baseball seams to alter a pitch direction: the seam shifted wake** (A. W. Smith & B. L. Smith, *Proc.
  IMechE Part P*, 2021, DOI 10.1177/1754337120961609) — <https://journals.sagepub.com/doi/10.1177/1754337120961609>
  (record: <https://digitalcommons.usu.edu/etd/7903>) — the peer-reviewed experimental proof; the citation of
  record for "not one fixed angle".
- **Determining the 3D Spin Axis from Statcast Data** (+ addendum) (A. Nathan, 2020) —
  <https://baseball.physics.illinois.edu/trackman/SpinAxis.pdf>,
  <https://baseball.physics.illinois.edu/trackman/SpinAxisAddendum.pdf> — recovers transverse spin, gyrospin and
  spin efficiency from the fields we already store; gives the lift parametrisation C_L = A[1−exp(−BS)] with
  A = 0.336, B = 6.041. The addendum documents an intrinsic spin↔movement ambiguity when spin efficiency < 1.
- **Reverse Engineering: Obtaining Average Spin Components from Statcast Data** (A. Nathan, 2024) —
  <https://baseball.physics.illinois.edu/HawkeyeAveSpinComponents.pdf> — exact formulas for ⟨ωx⟩,⟨ωy⟩,⟨ωz⟩ per
  pitcher/type; would replace our `spin_direction` inference with reconstructed 3D spin.
- **The dependence of baseball lift and drag on spin** (Lyu, Smith, Elliott, Kensrud, *Proc. IMechE Part P*, 2022) —
  <https://baseball.physics.illinois.edu/LyuDragLiftSpin.pdf> — C_D is non-monotonic in spin and low-spin
  two-seamers show a periodic **reverse Magnus** effect, so a fixed-coefficient constant-acceleration fit is
  systematically off for those pitches. Bounds the accuracy of the current solver.
- **The Spin Decay of a Baseball** (A. Nathan, 2026, unpublished) —
  <https://baseball.physics.illinois.edu/spindown-rev1.pdf> — 1/e decay ≈ 20–25 s over a ~0.4 s flight. A useful
  **negative** result: do not add a spin-decay term to the trajectory.

**Feature correction — the tunnel point.** *Updating Pitch Tunnels* (Baseball Prospectus, 2018) —
<https://www.baseballprospectus.com/news/article/37436/prospectus-feature-updating-pitch-tunnels/> — concedes that a
*fixed-distance* tunnel point (they used 23.4 ft, numerically our 23.8 ft) is wrong because flight time varies by
pitch, and moved to a **time-based frame 150 ms before the plate** plus release distance and a pre-tunnel maximum.
Our commitment point is the fixed-distance form this article argues against.

## 2. A verified defect in our own serving path (Arrow record batches)

apache-arrow's `Vector.toArray()` is **zero-copy only for a single Data chunk** — with more than one chunk it
allocates a new typed array and copies every chunk into it (doc comment and code:
<https://github.com/apache/arrow-js/blob/main/src/vector.ts>, ~L266–278). Our measurement that `toArray()` costs
0.0 ms was taken on the harness's single-batch corpus; the *serving* path is different:
`ingestion/export_batch.py` calls `combine_chunks()` before writing, but **`serving/app.py:_serialize` does not** —
it writes the table as-is, and pyarrow emits one record batch per chunk. Any served file with N > 1 batches
therefore makes each of ~30 `getChild().toArray()` calls in `web/src/lib/arrow-loader.ts` allocate and copy a whole
column (~30 × 62,741 elements) — a plausible source of the GC spike measured at 12.4% of self-time.
**Check:** count `pa.ipc.open_file(body).num_record_batches` on the real served bytes; if > 1, serve one batch and
every `toArray()` becomes a view. *(The batching claim is verified in code; the effect on our served bytes is not
yet measured.)*

Related, also worth an A/B: compressed IPC cannot slice the input, so the loader's JS `fzstd` path allocates a
fresh buffer per column (<https://github.com/apache/arrow-js/blob/main/src/ipc/reader.ts>, `_decompressBuffers`).
A WASM zstd (`zstddec`, `@bokuweb/zstd-wasm`) or uncompressed-body + HTTP compression are the alternatives; no
benchmark exists for this corpus.

## 3. New per-pitch data available today

- **Statcast bat tracking is now per-pitch in the Savant search CSV** (fields verified live:
  `bat_speed`, `swing_length`, `miss_distance`, `attack_angle`, `attack_direction`, `swing_path_tilt`,
  `intercept_ball_minus_batter_pos_{x,y}_inches`) — <https://baseballsavant.mlb.com/csv-docs> — one row per pitch,
  so it drops into the existing search → load-job → Arrow path unchanged, and replaces the app's **simulated**
  bat-speed and attack-angle values with real 2023H2+ measurements.
- **ABS per-pitch data exists in the statsapi game feed** (verified on 2026 gamePks 823570/823571/824500):
  `gameData.absChallenges` plus per-play `playEvents[].reviewDetails` (`isOverturned`, `reviewType`, team, player),
  with reasons from `/api/v1/reviewReasons`. Fully per-pitch ingestible. *(MLB publishes no official legend for
  the code; the `reviewType: "MJ"` → ABS correlation is empirical, so treat the mapping as unverified.)*
- **Not available:** raw Hawk-Eye poses/biomechanics are internal to MLB; the ABS and bat-tracking *leaderboards*
  are per-player aggregates only (<https://baseballsavant.mlb.com/leaderboard/bat-tracking?year=2026&csv=true>,
  <https://baseballsavant.mlb.com/leaderboard/abs-challenges>).
- Wrappers, if we want them: `pybaseball` (active repo, but newest release 2.2.7 from 2023 — bat tracking lives on
  master only), `MLB-StatsAPI` v1.9.0, `sportsdataverse` mlb_statcast leaderboard wrappers.

## 4. GPU filtering: what our invariant costs, and what could replace it

- **deck.gl v9.4.0** (2026-09-05) — <https://deck.gl/docs/developer-guide/webgpu> — the layer catalog is now
  WebGPU-capable, but the extension matrix still lists **`DataFilterExtension` as WebGL-only**, and deck.gl states
  WebGPU "is not production ready". The "no CPU-side per-frame filtering" invariant is precisely what pins the app
  to WebGL2.
- **deck.gl RFC #10781** (open, 2026-10-01) — <https://github.com/visgl/deck.gl/issues/10781> — names the scaling
  law: a discard mask *still draws every instance*, so frame cost scales with total rows, not visible rows
  (4 M rows at 5% survivors: mask 6.17 ms/tick vs compacted ids + `drawIndirect` 1.80 ms). Our scene is 62,741
  paths × 60 points = 3.76 M vertices the shader visits every frame. *(The RFC's author infers this explains our
  super-linear throughput loss; our own numbers say otherwise — `ts_layers_ms` measures layer **construction**
  (~103 ms), not the render loop — so treat that as a live-app scaling concern, not the measured regression.)*
- **`@luma.gl/gpgpu` + `/gpu-dataframe` + `/gpu-crossfilter`** (9.4.2) —
  <https://luma.gl/docs/api-reference/experimental/gpu-dataframe> — ships the compaction primitives the RFC asks
  for (`GPUCompaction`, `GPUMask`, `DrawCommandBuffer`, …). A caveat that hits us: **batch topology dominates** —
  feeding 2048-row chunks "costs 90 ms per filter at 4 M rows instead of 1.6 ms", i.e. Arrow IPC batches should be
  repacked into one buffer first (which is the same remedy as item 2). Experimental: no semver promise.
- **`filterShaderPlugin`** (`@luma.gl/shadertools` 9.4.2) — <https://github.com/visgl/luma.gl/tree/master/examples/arrow/arrow-filtering> —
  one filter module with both GLSL and WGSL sources, so on-GPU visibility can be done on WebGL2 today and stay
  WebGPU-ready, without waiting for DataFilterExtension. It is a shader plugin for custom layers, not a drop-in
  extension swap; soft-range/fade parity is not verified.

## 5. Project risk: data licensing

MLBAM's own terms (echoed in every statsapi `copyright` field;
<https://www.mlb.com/official-information/terms-of-use>, rev. 2025-03-11) say: *"Only individual, non-commercial,
non-bulk use of the Materials is permitted … prohibited from using the Materials in any commercial manner other
than as expressly authorized by MLBAM."* The repo's attribution is correct, but bulk-loading the corpus into
BigQuery and re-serving it over a public HTTP endpoint is **outside those terms** absent an MLBAM license. This
warrants an explicit note in the README before the Arrow endpoint is public.
