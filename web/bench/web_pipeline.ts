/**
 * Autoresearch benchmark, web-app stage (offline, deterministic).
 *
 * Consumes the exact Arrow IPC bytes the serving endpoint sends (written by
 * bench/run_pipeline.py) and runs the client work that a filter change or a
 * render costs:
 *
 *   1. load   — loadPitchTable(): IPC decode (zstd) plus the per-pitch
 *               trajectory, ghost, break-vector, release and commitment
 *               derivation that feeds the GPU buffers.
 *   2. panels — the analysis panels the UI recomputes when filters move:
 *               strike-zone heatmap (density + whiff rate), arsenal centroids,
 *               tunneling pairs, release dispersion, fatigue buckets, player
 *               card, and the CPU mirror of the GPU filter count.
 *   3. layers — buildLayers(): deck.gl layer construction for a render.
 *   4. parity — every pitch's closed-form path, break and commitment point must
 *               match the Python pipeline (mirrored physics), and the workload
 *               must checksum identically across two runs.
 *
 * Emits `METRIC name=value` lines and exits non-zero when a gate fails.
 *
 * Usage: vite-node bench/web_pipeline.ts --arrow <path> --parity <path> [--out <dir>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadPitchTable, type PitchDatum } from "../src/lib/arrow-loader";
import { computeStrikeZoneHeatmap } from "../src/lib/heatmap";
import { computeArsenalCentroids, computePitchPairMetrics, type ArsenalCentroid } from "../src/lib/arsenal";
import {
  computeFatigueBuckets,
  computeReleaseDispersion,
  fatiguePitcher,
  type ReleaseDispersion,
} from "../src/lib/dispersion";
import { buildLayers, passesFilters, type FilterOpts } from "../src/lib/deck-layers";
import { summarizePitcher } from "../src/lib/player-card";

// Fixed workload size: every run measures the same amount of work per pitch.
const PARSE_BATCHES = 3; // full IPC decode + per-pitch derivation
const PANEL_BATCHES = 40; // every analysis panel over the parsed corpus
const LAYER_BATCHES = 100; // deck.gl layer construction for a render
const CALIB_ITERATIONS = 20_000_000; // ~20 ms of arithmetic
const REPS = 25; // repetitions; the cleanest (min) one is reported

// Tolerances against the Python pipeline. TS paths are Float32Array, so a
// 60 ft coordinate carries ~4e-6 ft of rounding; the bounds below are far
// above that and far below any real divergence.
const TERMINAL_TOL_FT = 2e-3;
const MID_TOL_FT = 2e-3;
const SUM_TOL = 1.0;
const BREAK_TOL_IN = 1e-3;
const COMMIT_TOL_FT = 2e-3;
const MAX_MISSING_FRACTION = 0.02;

interface ParityPitch {
  pitch_id: string;
  plate_x: number;
  plate_z: number;
  terminal: [number, number, number];
  mid: [number, number, number];
  path_sum: number;
  v_break_inches: number;
  commitment: [number, number, number];
}

const FILTER_STATES: FilterOpts[] = [
  { speedRange: [40, 105] },
  { speedRange: [40, 105], plateXRange: [-1, 1], plateZRange: [1, 4] },
  {
    speedRange: [40, 105],
    zoneFilter: "in_zone",
    outcomeFilter: "swings",
    // Set, not Record: FilterOpts.selectedTypes is a ReadonlySet the GPU mask
    // membership-tests per datum.
    selectedTypes: new Set(["FF", "SL", "CH"]),
  },
];

const failures: string[] = [];
function check(ok: boolean, msg: string): boolean {
  if (!ok) failures.push(msg);
  return ok;
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

/** Fixed arithmetic workload: proxy for CPU speed under contention. */
function calibrate(iterations = CALIB_ITERATIONS): number {
  let x = 1.000001;
  let acc = 0;
  for (let i = 0; i < iterations; i++) {
    x = x * 1.0000001 + 1e-7;
    acc += x * 1.0000001;
  }
  return acc + x;
}

function best(values: number[]): number {
  return Math.min(...values);
}

/**
 * Time every stage of one workload batch, interleaved with the calibration
 * loop. The minimum over repetitions is reported for every quantity — the
 * least contended measurement — and the ratio is min(work) / min(calibration),
 * so a rep that happened to catch a slow calibration cannot flatter the ratio.
 * Minima are far more stable than means under external load.
 */
function measureStages(stages: Record<string, () => void>, reps = REPS) {
  for (const fn of Object.values(stages)) fn();
  calibrate();

  const samples: Record<string, number[]> = {};
  for (const name of Object.keys(stages)) samples[name] = [];
  const totals: number[] = [];
  const calibs: number[] = [];

  for (let i = 0; i < reps; i++) {
    let total = 0;
    for (const [name, fn] of Object.entries(stages)) {
      const t0 = performance.now();
      fn();
      const elapsed = performance.now() - t0;
      samples[name].push(elapsed);
      total += elapsed;
    }
    const t0 = performance.now();
    calibrate();
    const calib = performance.now() - t0;
    totals.push(total);
    calibs.push(calib);
  }

  const medians: Record<string, number> = {};
  for (const [name, values] of Object.entries(samples)) medians[name] = best(values);
  const work = best(totals);
  const calib = best(calibs);
  return { medians, work, calib, ratio: work / calib };
}

interface Panels {
  checksum: number;
  densityCells: number;
  whiffCells: number;
  centroids: Map<string, ArsenalCentroid>;
  dispersion: ReleaseDispersion;
  filterCounts: number[];
}

/** Every analysis panel the UI recomputes on a filter change. */
function runPanels(pitches: PitchDatum[]): Panels {
  let checksum = 0;
  const density = computeStrikeZoneHeatmap(pitches, "density");
  const whiff = computeStrikeZoneHeatmap(pitches, "whiff_rate");
  for (const c of density) checksum += c.pitchCount + c.value;
  for (const c of whiff) checksum += c.value;

  const centroids = computeArsenalCentroids(pitches);
  const types = [...centroids.keys()].sort();
  for (let i = 0; i < types.length; i++) {
    for (let j = i + 1; j < types.length; j++) {
      checksum += computePitchPairMetrics(centroids.get(types[i])!, centroids.get(types[j])!).tunnelRatio;
    }
  }

  const dispersion = computeReleaseDispersion(pitches, 1.5);
  checksum += dispersion.volumeCuFt + dispersion.wireframeSegments.length;

  for (const bucket of computeFatigueBuckets(pitches)) {
    checksum += bucket.deltaVelocityMph + bucket.whiffPct;
  }

  const pitcher = fatiguePitcher(pitches);
  const card = pitcher === undefined ? null : summarizePitcher(pitches, pitcher);
  checksum += card ? card.avgSpeed + card.mix.length + card.count : 0;

  const filterCounts: number[] = [];
  for (const state of FILTER_STATES) {
    let n = 0;
    for (const p of pitches) if (passesFilters(p, state)) n++;
    filterCounts.push(n);
    checksum += n;
  }

  return { checksum, densityCells: density.length, whiffCells: whiff.length, centroids, dispersion, filterCounts };
}

/** deck.gl layer construction for one render (the per-interaction cost). */
function buildRenderLayers(pitches: PitchDatum[], panels: Panels): number {
  const base = buildLayers({ pitches, speedRange: [40, 105] });
  const full = buildLayers({
    pitches,
    speedRange: [40, 105],
    plateXRange: [-1.5, 1.5],
    plateZRange: [1, 4.5],
    showGhostBreak: true,
    showTunneling: true,
    showReleasePoints: true,
    showPlateCrossings: true,
    showDispersion: true,
    releaseDispersion: panels.dispersion,
    showHeatmap: true,
    heatmapCells: computeStrikeZoneHeatmap(pitches, "density"),
    arsenalCentroids: panels.centroids,
    pairedTypes: ["FF", "SL"],
    flightProgress: 0.5,
  });
  return base.length + full.length;
}

function main(): number {
  const outDir = arg("out", process.env.AUTORESEARCH_OUT_DIR ?? "/tmp/statcast-autoresearch");
  const arrowPath = arg("arrow", join(outDir, "corpus.arrow"));
  const parityPath = arg("parity", join(outDir, "py_paths.json"));

  const bytes = readFileSync(arrowPath);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  // ---- load: IPC decode + per-pitch derivation
  const parsed = loadPitchTable(buffer);
  const pitches = parsed.pitches;

  // ---- panels + layers
  const panels = runPanels(pitches);
  const layerCount = buildRenderLayers(pitches, panels);
  const checksum = panels.checksum + layerCount;

  // Determinism gate: the workload must reproduce itself exactly.
  const again = runPanels(pitches);
  check(
    again.checksum === panels.checksum && again.filterCounts.join(",") === panels.filterCounts.join(","),
    "panel workload is not deterministic"
  );

  // ---- validity gates
  check(pitches.length > 0, "loader produced no pitches");
  check(
    pitches.every((p) => Number.isFinite(p.releaseSpeed) && p.path.length % 3 === 0 && p.path.length >= 180),
    "a loaded pitch has a bad speed or path"
  );
  check(panels.densityCells > 0 && panels.whiffCells > 0, "heatmap produced no cells");
  check(
    panels.centroids.size >= 5 && [...panels.centroids.values()].every((c) => Number.isFinite(c.releaseSpeed)),
    "arsenal centroids are missing or non-finite"
  );
  check(
    panels.dispersion.count === pitches.length && panels.dispersion.volumeCuFt >= 0,
    "release dispersion does not cover the corpus"
  );
  check(
    panels.filterCounts.length === FILTER_STATES.length &&
      panels.filterCounts.every((n) => n > 0 && n <= pitches.length),
    "filter counts are outside the corpus"
  );
  check(panels.filterCounts[0] >= panels.filterCounts[2], "zone+swing filter is not a subset of the open filter");
  check(layerCount > 0, "buildLayers produced no layers");

  // ---- parity against the Python pipeline (mirrored physics)
  const fixture = JSON.parse(readFileSync(parityPath, "utf8")) as { pitches: ParityPitch[] };
  const byId = new Map<string, PitchDatum>();
  for (const p of pitches) if (p.pitchId) byId.set(p.pitchId, p);

  let matched = 0;
  let missing = 0;
  let mismatched = 0;
  for (const expected of fixture.pitches) {
    const datum = byId.get(expected.pitch_id);
    if (!datum) {
      missing++;
      continue;
    }
    matched++;
    const path = datum.path;
    const n = path.length;
    const terminal: [number, number, number] = [path[n - 3], path[n - 2], path[n - 1]];
    const mid: [number, number, number] = [path[90], path[91], path[92]];
    let sum = 0;
    for (let i = 0; i < n; i++) sum += path[i];
    const deltas: Array<[string, number, number]> = [
      ["terminal.x", terminal[0], expected.terminal[0]],
      ["terminal.z", terminal[2], expected.terminal[2]],
      ["mid.x", mid[0], expected.mid[0]],
      ["mid.z", mid[2], expected.mid[2]],
      ["path_sum", sum, expected.path_sum],
      ["v_break_inches", datum.breakVector?.vBreakInches ?? 0, expected.v_break_inches],
      ["commitment.z", datum.commitmentPoint?.[2] ?? 0, expected.commitment[2]],
    ];
    const limits: Record<string, number> = {
      "terminal.x": TERMINAL_TOL_FT,
      "terminal.z": TERMINAL_TOL_FT,
      "mid.x": MID_TOL_FT,
      "mid.z": MID_TOL_FT,
      path_sum: SUM_TOL,
      v_break_inches: BREAK_TOL_IN,
      "commitment.z": COMMIT_TOL_FT,
    };
    const bad = deltas.filter(([field, got, want]) => Math.abs(got - want) > limits[field]);
    if (bad.length > 0) {
      mismatched++;
      if (mismatched <= 3) {
        const detail = bad.map(([field, got, want]) => `${field} ${got.toFixed(6)} vs ${want.toFixed(6)}`).join("; ");
        failures.push(`parity mismatch on ${expected.pitch_id}: ${detail}`);
      }
    }
  }
  check(matched > 0, "no pitch matched between the Python and TypeScript pipelines");
  check(mismatched === 0, `${mismatched} pitches diverge from the Python pipeline`);
  check(
    missing <= Math.ceil(fixture.pitches.length * MAX_MISSING_FRACTION),
    `loader dropped ${missing}/${fixture.pitches.length} corpus pitches`
  );

  // ---- timings (medians; normalized against the calibration loop)
  const timing = measureStages({
    parse: () => {
      for (let i = 0; i < PARSE_BATCHES; i++) loadPitchTable(buffer);
    },
    panels: () => {
      for (let i = 0; i < PANEL_BATCHES; i++) runPanels(pitches);
    },
    layers: () => {
      for (let i = 0; i < LAYER_BATCHES; i++) buildRenderLayers(pitches, panels);
    },
  });
  const ts_parse_ms = timing.medians.parse;
  const ts_panels_ms = timing.medians.panels;
  const ts_layers_ms = timing.medians.layers;
  const ts_work_ms = timing.work;
  const ts_calib_ms = timing.calib;
  const ts_ratio = timing.ratio;

  writeFileSync(
    join(outDir, "ts_meta.json"),
    JSON.stringify(
      {
        pitches: pitches.length,
        checksum,
        filterCounts: panels.filterCounts,
        parity: { matched, missing, mismatched, expected: fixture.pitches.length },
        timings_ms: { parse: ts_parse_ms, panels: ts_panels_ms, layers: ts_layers_ms, calib: ts_calib_ms, work: ts_work_ms },
      },
      null,
      2
    )
  );

  console.log(`METRIC ts_work_ms=${ts_work_ms.toFixed(3)}`);
  console.log(`METRIC ts_calib_ms=${ts_calib_ms.toFixed(3)}`);
  console.log(`METRIC ts_parse_ms=${ts_parse_ms.toFixed(3)}`);
  console.log(`METRIC ts_panels_ms=${ts_panels_ms.toFixed(3)}`);
  console.log(`METRIC ts_layers_ms=${ts_layers_ms.toFixed(3)}`);
  console.log(`METRIC ts_pitches=${pitches.length}`);
  console.log(`METRIC ts_filtered=${panels.filterCounts[0]}`);
  console.log(`METRIC parity_matched=${matched}`);
  console.log(`METRIC parity_missing=${missing}`);
  console.log(`METRIC ts_checksum=${checksum.toFixed(6)}`);

  if (failures.length > 0) {
    for (const msg of failures) console.error(`FAIL ${msg}`);
    console.error(`FAILURES ${failures.length}`);
    return 1;
  }
  return 0;
}

process.exit(main());
