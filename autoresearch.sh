#!/usr/bin/env bash
# Canonical autoresearch benchmark entrypoint for statcast-lakehouse.
#
# Measures the goal "expand data coverage and optimize data pipelines and web
# app performance" as one number:
#
#   pipeline_score = coverage_index * sqrt(py_throughput * ts_throughput)
#
#   coverage_index   log-scaled breadth of the checked-in real corpus (pitches,
#                    games, dates, pitch types, pitchers, batters, scenarios,
#                    fully populated columns) — see bench/run_pipeline.py.
#   py_throughput    corpus pitches per warehouse-pipeline unit of compute:
#                    rows / py_work_ms * py_calib_ms (ingest, derive, serve,
#                    per-day export over the whole corpus).
#   ts_throughput    corpus pitches per web-app unit of compute:
#                    ts_pitches / ts_work_ms * ts_calib_ms (zstd Arrow decode +
#                    per-pitch derivation, analysis panels, deck.gl layer build).
#
# Higher is better. Both throughputs are per pitch and normalized against a
# fixed calibration loop measured in the same process, so growing the corpus
# never costs score by itself and machine contention does not move the number.
# The geometric mean keeps the two halves of the goal — data pipelines and web
# app — equally weighted: a 2x speedup on either side doubles the score.
#
# Coverage never shrinks: every dimension has a floor (FLOORS below) and the
# run fails if one regresses. The physics/correctness gates (pytest, vitest,
# tsc, production build, per-pitch plate-crossing checks, cross-language
# trajectory parity) fail the run too, so the workload cannot be skipped.
# The harness files themselves (autoresearch.sh, bench/, web/bench/) define the
# workload and are not part of the search space.
#
# Offline and deterministic: no network, no GCP, fixed workload sizes, fixed
# manifest clock, minima over a fixed repetition count.
set -uo pipefail

cd "$(dirname "$0")"

OUT_DIR="${AUTORESEARCH_OUT_DIR:-/tmp/statcast-autoresearch}"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
METRICS="$OUT_DIR/metrics.txt"
: > "$METRICS"

STATUS=0
fail() {
  echo "FAIL $*" >&2
  STATUS=1
}

# --------------------------------------------------------------- correctness
echo "[harness] pytest" >&2
python3 -m pytest -q >"$OUT_DIR/pytest.log" 2>&1
pytest_ok=$?
[ "$pytest_ok" -eq 0 ] || { tail -30 "$OUT_DIR/pytest.log" >&2; fail "pytest failed"; }

echo "[harness] vitest" >&2
(cd web && npx vitest run) >"$OUT_DIR/vitest.log" 2>&1
vitest_ok=$?
[ "$vitest_ok" -eq 0 ] || { tail -30 "$OUT_DIR/vitest.log" >&2; fail "vitest failed"; }

echo "[harness] tsc" >&2
npx tsc -p web/tsconfig.json --noEmit >"$OUT_DIR/tsc.log" 2>&1
tsc_ok=$?
[ "$tsc_ok" -eq 0 ] || { tail -30 "$OUT_DIR/tsc.log" >&2; fail "tsc failed"; }

echo "[harness] production build" >&2
(cd web && npm run build) >"$OUT_DIR/build.log" 2>&1
build_ok=$?
[ "$build_ok" -eq 0 ] || { tail -30 "$OUT_DIR/build.log" >&2; fail "web build failed"; }

if [ "$STATUS" -ne 0 ]; then
  echo "METRIC gate_pytest=$pytest_ok"
  echo "METRIC gate_vitest=$vitest_ok"
  echo "METRIC gate_tsc=$tsc_ok"
  echo "METRIC gate_build=$build_ok"
  echo "gates failed; benchmark not run" >&2
  exit 1
fi

# --------------------------------------------------------------- python stage
echo "[harness] python pipeline stage" >&2
python3 bench/run_pipeline.py >"$OUT_DIR/py_metrics.txt" 2>"$OUT_DIR/py_err.txt"
py_ok=$?
[ "$py_ok" -eq 0 ] || { cat "$OUT_DIR/py_err.txt" >&2; fail "python pipeline stage failed"; }

# --------------------------------------------------------------- web stage
echo "[harness] web app stage" >&2
(cd web && npx vite build --ssr bench/web_pipeline.ts --outDir bench-dist --emptyOutDir --logLevel error) \
  >"$OUT_DIR/bench_build.log" 2>&1
bench_build_ok=$?
if [ "$bench_build_ok" -ne 0 ]; then
  tail -30 "$OUT_DIR/bench_build.log" >&2
  fail "web bench build failed"
else
  node web/bench-dist/web_pipeline.js \
    --arrow "$OUT_DIR/corpus.arrow" --parity "$OUT_DIR/py_paths.json" --out "$OUT_DIR" \
    >"$OUT_DIR/ts_metrics.txt" 2>"$OUT_DIR/ts_err.txt"
  ts_ok=$?
  [ "$ts_ok" -eq 0 ] || { cat "$OUT_DIR/ts_err.txt" >&2; fail "web app stage failed"; }
fi

# --------------------------------------------------------------- bundle size
python3 - <<'PY'
import gzip, pathlib

dist = pathlib.Path("web/dist")
total = 0
files = 0
for path in sorted(dist.rglob("*")):
    if path.suffix not in {".js", ".css"}:
        continue
    total += len(gzip.compress(path.read_bytes(), mtime=0))
    files += 1
print(f"METRIC bundle_kb={total / 1024:.1f}")
print(f"METRIC bundle_files={files}")
PY

# --------------------------------------------------------------- aggregate
cat "$OUT_DIR/py_metrics.txt" "$OUT_DIR/ts_metrics.txt" >"$METRICS"

python3 - "$METRICS" <<'PY'
import math
import sys

# Coverage floors: the baseline corpus breadth. The score already rewards
# breadth, and these floors make shrinking the corpus a hard failure.
FLOORS = {
    "coverage_pitches": 490,
    "coverage_games": 3,
    "coverage_dates": 3,
    "coverage_pitch_types": 10,
    "coverage_pitchers": 13,
    "coverage_batters": 34,
    "coverage_scenarios": 5,
    "coverage_columns_complete": 24,
}

metrics: dict[str, str] = {}
for line in open(sys.argv[1]):
    if line.startswith("METRIC "):
        key, _, value = line[len("METRIC ") :].strip().partition("=")
        metrics[key] = value

problems = []
for key, floor in FLOORS.items():
    if key not in metrics:
        problems.append(f"missing metric {key}")
    elif float(metrics[key]) < floor:
        problems.append(f"{key}={metrics[key]} is below the floor {floor}")

required = ("coverage_index", "corpus_rows", "py_work_ms", "py_calib_ms", "ts_pitches", "ts_work_ms", "ts_calib_ms")
for key in required:
    if key not in metrics:
        problems.append(f"missing metric {key}")

if not problems:
    coverage_index = float(metrics["coverage_index"])
    # Pitches per calibration unit: bigger is better and corpus size cancels out
    # of the cost term, so expanding coverage is never self-defeating.
    py_throughput = float(metrics["corpus_rows"]) / float(metrics["py_work_ms"]) * float(metrics["py_calib_ms"])
    ts_throughput = float(metrics["ts_pitches"]) / float(metrics["ts_work_ms"]) * float(metrics["ts_calib_ms"])
    metrics["py_throughput"] = f"{py_throughput:.3f}"
    metrics["ts_throughput"] = f"{ts_throughput:.3f}"
    if not (py_throughput > 0 and ts_throughput > 0 and math.isfinite(py_throughput * ts_throughput)):
        problems.append("non-positive stage throughput")
    else:
        metrics["pipeline_score"] = f"{coverage_index * math.sqrt(py_throughput * ts_throughput):.3f}"

for key, value in metrics.items():
    print(f"METRIC {key}={value}")

for problem in problems:
    print(f"FAIL {problem}", file=sys.stderr)

sys.exit(1 if problems else 0)
PY
aggregate_ok=$?
[ "$aggregate_ok" -eq 0 ] || fail "aggregate checks failed"

exit "$STATUS"
