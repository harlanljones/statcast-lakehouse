# Scenario Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single random-day demo with six curated 500-pitch scenario groups (one per docs use case) and rehaul the UI around picking a group and reading its story.

**Architecture:** Seeded, physically consistent scenario generators in `ingestion/scenarios.py` are served as Arrow IPC at `GET /pitches/scenario/{id}`. The group catalog and per-group UI presets live client-side in `web/src/lib/scenarios.ts` (keeps the serving path JSON-free). `App.tsx` applies a preset atomically; new `ScenarioRail`, `StoryCaption`, and `LensPanel` components replace the always-open control footer, which becomes an "All controls" drawer.

**Tech Stack:** Python 3.12 + pyarrow + FastAPI (pytest); SolidJS + Vite + deck.gl + apache-arrow (vitest).

**Spec:** `docs/superpowers/specs/2026-09-21-scenario-demo-design.md`

## Global Constraints

- Arrow IPC only on the serving path; no JSON there.
- `worker.SCHEMA`, `mlb_client.COLUMN_MAP`, and `warehouse/ddl/*` are NOT modified.
- Kinematics constants and solvers (`ingestion/worker.py`, `web/src/lib/kinematics.ts`) are NOT modified.
- No CPU-side per-frame filtering: sliders keep binding to `DataFilterExtension` uniforms via existing signals.
- Everything runs offline; no GCP.
- Every scenario is exactly 500 pitches, seeded, byte-stable.
- The working tree already contains unrelated uncommitted changes. Commit steps stage ONLY the files listed in that task, and should be run only if the user wants commits.
- Verified physics convention: `az = -GRAVITY_FT_S2 + lift` (lift > 0 is induced vertical break); `ay = 0`; `y0 = 55.0`.

## File Structure

| File | Responsibility |
|---|---|
| `ingestion/scenarios.py` (create) | Six seeded generators + `SCENARIOS` registry + `in_chase_box` |
| `ingestion/tests/test_scenarios.py` (create) | Shape, determinism, per-group signal |
| `serving/app.py` (modify) | `GET /pitches/scenario/{id}` |
| `serving/tests/test_scenario_endpoint.py` (create) | Endpoint contract |
| `web/src/lib/scenarios.ts` (create) | Catalog, presets, URL helpers |
| `web/src/lib/scenarios.test.ts` (create) | Catalog invariants |
| `web/src/components/ui.tsx` (create) | Theme tokens + `Segmented` + `RangeField` primitives |
| `web/src/components/ScenarioRail.tsx` (create) | Left rail of scenario cards + Live data entry |
| `web/src/components/StoryCaption.tsx` (create) | Title, look-for, try-this |
| `web/src/components/LensPanel.tsx` (create) | Per-scenario relevant controls only |
| `web/src/App.tsx` (modify) | Layout, `applyPreset`, `selectScenario`, deep link, drawer |
| `docs/ROADMAP.md`, `AGENTS.md` (modify) | Item 22 + layout line |

---

### Task 1: Scenario generators (Python)

**Files:**
- Create: `ingestion/scenarios.py`
- Test: `ingestion/tests/test_scenarios.py`

**Interfaces:**
- Produces: `SCENARIOS: dict[str, Callable[[], pa.Table]]` with keys `tunnel-vision, fatigue-arc, ghost-break, chase-map, contact-lab, corpus-slice` (in that order); `N_PITCHES = 500`; `in_chase_box(x: float, z: float) -> bool`. Each callable returns a 500-row `pa.Table` with `worker.SCHEMA`.
- Consumes: `ingestion.worker` (`SCHEMA`, `GRAVITY_FT_S2`, `position_at`, `solve_flight_time`, `solve_commitment_time`).

- [ ] **Step 1: Write the failing test** — create `ingestion/tests/test_scenarios.py` with exactly:

```python
"""Scenario generators: shape, determinism, and the signal each group exists to show."""
from __future__ import annotations

import statistics

import pytest

from ingestion import scenarios
from ingestion.worker import (
    SCHEMA,
    compute_arsenal_centroids,
    compute_break_vector,
    compute_collision,
    compute_fatigue_buckets,
    compute_pitch_pair_metrics,
    trajectory,
)

EXPECTED_IDS = [
    "tunnel-vision", "fatigue-arc", "ghost-break", "chase-map", "contact-lab", "corpus-slice",
]


@pytest.fixture(scope="module")
def rows():
    return {k: f().to_pylist() for k, f in scenarios.SCENARIOS.items()}


def test_registry_has_the_six_groups():
    assert list(scenarios.SCENARIOS) == EXPECTED_IDS


@pytest.mark.parametrize("sid", EXPECTED_IDS)
def test_each_group_is_500_schema_valid_unique_rows(sid):
    table = scenarios.SCENARIOS[sid]()
    assert table.num_rows == 500
    assert table.schema.equals(SCHEMA)
    ids = table.column("pitch_id").to_pylist()
    assert len(set(ids)) == 500


@pytest.mark.parametrize("sid", EXPECTED_IDS)
def test_each_group_is_deterministic(sid):
    assert scenarios.SCENARIOS[sid]().equals(scenarios.SCENARIOS[sid]())


@pytest.mark.parametrize("sid", EXPECTED_IDS)
def test_whiffs_only_on_swings_and_paths_end_at_plate_columns(sid, rows):
    for r in rows[sid]:
        assert not (r["is_whiff"] and not r["is_swing"])
    for r in rows[sid][::25]:  # every 25th pitch: the 9 params really land at plate_x/z
        end = trajectory(r)[-1]
        assert end[0] == pytest.approx(r["plate_x"], abs=1e-6)
        assert end[2] == pytest.approx(r["plate_z"], abs=1e-6)


def test_tunnel_vision_tunnels_then_diverges(rows):
    c = compute_arsenal_centroids(rows["tunnel-vision"])
    for other in ("SL", "CH"):
        m = compute_pitch_pair_metrics(c["FF"], c[other])
        assert m["tunneling_separation_inches"] < 3.0
        assert m["plate_divergence_inches"] > 8.0
        assert m["tunnel_ratio"] > 5.0


def test_fatigue_arc_sags_and_scatters(rows):
    buckets = compute_fatigue_buckets(rows["fatigue-arc"], 100)
    first, last = buckets[0], buckets[-1]
    assert last["delta_velocity_mph"] < -2.5
    assert last["delta_release_z_inches"] < -1.5
    assert last["whiff_pct"] < first["whiff_pct"]
    x0 = [r["x0"] for r in rows["fatigue-arc"]]
    assert statistics.pstdev(x0[-100:]) > 2 * statistics.pstdev(x0[:100])


def test_ghost_break_has_wide_movement_spread(rows):
    by: dict[str, list[dict]] = {}
    for r in rows["ghost-break"]:
        by.setdefault(r["pitch_type"], []).append(compute_break_vector(r))
    ivb = {k: statistics.mean(b["v_break_inches"] for b in v) for k, v in by.items()}
    hb = {k: statistics.mean(b["h_break_inches"] for b in v) for k, v in by.items()}
    assert ivb["FF"] - ivb["CU"] > 30.0
    assert max(hb.values()) - min(hb.values()) > 35.0


def test_chase_map_whiffs_cluster_low_and_away(rows):
    def whiff_rate(inside: bool) -> tuple[int, float]:
        sw = [
            r for r in rows["chase-map"]
            if r["is_swing"] and scenarios.in_chase_box(r["plate_x"], r["plate_z"]) == inside
        ]
        return len(sw), sum(r["is_whiff"] for r in sw) / len(sw)

    n_in, rate_in = whiff_rate(True)
    _, rate_out = whiff_rate(False)
    assert n_in >= 50
    assert rate_in > 2.5 * rate_out


def test_contact_lab_splits_barrels_by_pitch_speed(rows):
    barrels, others = [], []
    for r in rows["contact-lab"]:
        q = compute_collision(r, 72.0, 18.0)["contact_quality"]
        (barrels if q == "Barrel" else others).append(r["release_speed"])
    assert len(barrels) >= 100 and len(others) >= 100
    assert statistics.mean(barrels) > statistics.mean(others) + 4.0


def test_corpus_slice_mixes_pitchers_and_release_points(rows):
    r = rows["corpus-slice"]
    assert len({x["pitcher_id"] for x in r}) == 10
    x0 = [x["x0"] for x in r]
    assert max(x0) - min(x0) > 4.0
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 -m pytest ingestion/tests/test_scenarios.py -q`
Expected: FAIL/ERROR — `ImportError: cannot import name 'scenarios' from 'ingestion'`.

- [ ] **Step 3: Implement** — create `ingestion/scenarios.py` with exactly (this file was prototyped and all 25 tests above pass against it):

```python
"""Curated 500-pitch demo scenarios (docs/superpowers/specs/2026-09-21-scenario-demo-design.md).

Each generator is seeded and deterministic, emits worker.SCHEMA rows in pitch
order, and is physically consistent: the 9 kinematic parameters are solved so
the ball really crosses the plate at (plate_x, plate_z). Sign convention follows
Statcast / worker.compute_break_vector: az = -GRAVITY + lift, so lift > 0 is
induced vertical break and ax is horizontal break acceleration.
"""
from __future__ import annotations

import random
from datetime import date, datetime, timezone
from typing import Callable

import pyarrow as pa

from ingestion.worker import (
    GRAVITY_FT_S2,
    SCHEMA,
    position_at,
    solve_commitment_time,
    solve_flight_time,
)

N_PITCHES = 500
SCENARIO_DAY = date(2026, 9, 14)
_INGESTION_TIME = datetime(2026, 9, 14, 12, 0, 0, tzinfo=timezone.utc)
_MPH_TO_FPS = 1.467

ZONE_X = 0.83  # half plate width, feet
ZONE_BOT, ZONE_TOP = 1.5, 3.5


def _row(
    rng: random.Random,
    idx: int,
    *,
    game_id: int,
    pitcher_id: int,
    pitch_type: str,
    speed: float,
    x0: float,
    y0: float = 55.0,
    z0: float,
    spin: float,
    ax: float,
    lift: float,
    plate_x: float | None = None,
    plate_z: float | None = None,
    commit_xz: tuple[float, float] | None = None,
    swing_p: float = 0.47,
    whiff_p: float = 0.25,
) -> dict:
    """One physically consistent pitch.

    Exactly one of (plate_x, plate_z) or commit_xz pins the trajectory: the
    former solves vx0/vz0 to land at the plate point, the latter to pass through
    a point on the commitment plane (plate_x/plate_z are then derived).
    """
    vy0 = -speed * _MPH_TO_FPS * 0.93
    ay = 0.0
    az = -GRAVITY_FT_S2 + lift
    if commit_xz is not None:
        tc = solve_commitment_time(y0, vy0, ay)
        vx0 = (commit_xz[0] - x0 - 0.5 * ax * tc * tc) / tc
        vz0 = (commit_xz[1] - z0 - 0.5 * az * tc * tc) / tc
    else:
        assert plate_x is not None and plate_z is not None
        t = solve_flight_time(y0, vy0, ay)
        vx0 = (plate_x - x0 - 0.5 * ax * t * t) / t
        vz0 = (plate_z - z0 - 0.5 * az * t * t) / t
    pitch = {
        "x0": x0, "y0": y0, "z0": z0, "vx0": vx0, "vy0": vy0, "vz0": vz0,
        "ax": ax, "ay": ay, "az": az,
    }
    t_end = solve_flight_time(y0, vy0, ay)
    px, _, pz = position_at(pitch, t_end)
    is_swing = int(rng.random() < swing_p)
    is_whiff = int(is_swing and rng.random() < whiff_p)
    return {
        "pitch_id": f"{game_id}-{idx:04d}",
        "game_id": game_id,
        "game_date": SCENARIO_DAY,
        "pitcher_id": pitcher_id,
        "batter_id": 500000 + (idx % 9),
        "pitch_type": pitch_type,
        "release_speed": speed,
        "release_spin_rate": spin,
        **pitch,
        "plate_x": px,
        "plate_z": pz,
        "sz_top": ZONE_TOP,
        "sz_bot": ZONE_BOT,
        "is_swing": is_swing,
        "is_whiff": is_whiff,
        "ingestion_time": _INGESTION_TIME,
    }


def _table(rows: list[dict]) -> pa.Table:
    assert len(rows) == N_PITCHES
    return pa.Table.from_pylist(rows, schema=SCHEMA)


def _pick(rng: random.Random, weighted: list[tuple[str, float]]) -> str:
    return rng.choices([w[0] for w in weighted], weights=[w[1] for w in weighted])[0]


# (speed mph, ax ft/s^2, lift ft/s^2, spin rpm)
_ARSENAL = {
    "FF": (95.0, 8.0, 17.0, 2350.0),
    "SI": (93.0, 20.0, 6.0, 2100.0),
    "SL": (86.0, -18.0, 2.0, 2450.0),
    "CU": (79.0, -9.0, -20.0, 2650.0),
    "CH": (86.0, 16.0, -4.0, 1750.0),
    "FC": (90.0, -6.0, 12.0, 2400.0),
}


def _reference_commit() -> tuple[float, float]:
    """Commitment-plane point of a nominal four-seam that lands mid-zone."""
    spd, ax, lift, _ = _ARSENAL["FF"]
    vy0 = -spd * _MPH_TO_FPS * 0.93
    az = -GRAVITY_FT_S2 + lift
    t = solve_flight_time(55.0, vy0, 0.0)
    pitch = {
        "x0": -1.7, "y0": 55.0, "z0": 5.9, "vy0": vy0, "ay": 0.0, "ax": ax, "az": az,
        "vx0": (0.0 - -1.7 - 0.5 * ax * t * t) / t,
        "vz0": (2.8 - 5.9 - 0.5 * az * t * t) / t,
    }
    x, _, z = position_at(pitch, solve_commitment_time(55.0, vy0, 0.0))
    return x, z


# Per-type offset (ft) at the commitment plane: real tunnels are close, not identical.
_TUNNEL_OFFSET = {"FF": (0.0, 0.0), "SL": (0.10, -0.06), "CH": (-0.08, -0.10)}


def tunnel_vision(seed: int = 801) -> pa.Table:
    """One arm slot, three pitches that share a commitment point then diverge."""
    rng = random.Random(seed)
    gid = 2026091401
    cx, cz = _reference_commit()
    mix = [("FF", 0.45), ("SL", 0.35), ("CH", 0.20)]
    rows = []
    for i in range(N_PITCHES):
        pt = _pick(rng, mix)
        spd, ax, lift, spin = _ARSENAL[pt]
        ox, oz = _TUNNEL_OFFSET[pt]
        rows.append(_row(
            rng, i, game_id=gid, pitcher_id=605151, pitch_type=pt,
            speed=spd + rng.gauss(0, 0.8), x0=-1.7 + rng.gauss(0, 0.04),
            z0=5.9 + rng.gauss(0, 0.04), spin=spin + rng.gauss(0, 60),
            ax=ax + rng.gauss(0, 0.8), lift=lift + rng.gauss(0, 1.0),
            commit_xz=(cx + ox + rng.gauss(0, 0.03), cz + oz + rng.gauss(0, 0.03)),
            whiff_p={"FF": 0.12, "SL": 0.38, "CH": 0.32}[pt],
        ))
    return _table(rows)


def fatigue_arc(seed: int = 802) -> pa.Table:
    """One starter over 500 pitches: velocity and arm slot sag, release scatter grows."""
    rng = random.Random(seed)
    gid = 2026091402
    mix = [("FF", 0.6), ("SL", 0.25), ("CH", 0.15)]
    rows = []
    for i in range(N_PITCHES):
        p = i / (N_PITCHES - 1)
        pt = _pick(rng, mix)
        spd, ax, lift, spin = _ARSENAL[pt]
        rows.append(_row(
            rng, i, game_id=gid, pitcher_id=543037, pitch_type=pt,
            speed=spd - 3.0 * p + rng.gauss(0, 0.6),
            x0=1.6 + rng.gauss(0, 0.04 + 0.12 * p),
            y0=55.0 + 0.3 * p,
            z0=5.9 - 0.25 * p + rng.gauss(0, 0.04 + 0.10 * p),
            spin=spin - 120 * p + rng.gauss(0, 60),
            ax=ax + rng.gauss(0, 0.8), lift=lift + rng.gauss(0, 1.0),
            plate_x=rng.gauss(0, 0.45 + 0.45 * p),
            plate_z=2.5 + rng.gauss(0, 0.5 + 0.4 * p),
            whiff_p=0.30 - 0.14 * p,
        ))
    return _table(rows)


def ghost_break(seed: int = 803) -> pa.Table:
    """Six-pitch arsenal with maximal movement spread against the no-Magnus ghost."""
    rng = random.Random(seed)
    gid = 2026091403
    mix = [("FF", 0.25), ("SI", 0.15), ("SL", 0.2), ("CU", 0.15), ("CH", 0.15), ("FC", 0.10)]
    rows = []
    for i in range(N_PITCHES):
        pt = _pick(rng, mix)
        spd, ax, lift, spin = _ARSENAL[pt]
        rows.append(_row(
            rng, i, game_id=gid, pitcher_id=592789, pitch_type=pt,
            speed=spd + rng.gauss(0, 1.0), x0=1.4 + rng.gauss(0, 0.06),
            z0=6.0 + rng.gauss(0, 0.06), spin=spin + rng.gauss(0, 80),
            ax=ax + rng.gauss(0, 1.2), lift=lift + rng.gauss(0, 1.5),
            plate_x=rng.uniform(-1.3, 1.3), plate_z=rng.uniform(1.0, 4.0),
        ))
    return _table(rows)


CHASE_BOX = (0.4, 2.0, 0.3, 1.5)  # x_min, x_max, z_min, z_max (low-and-away)


def in_chase_box(x: float, z: float) -> bool:
    return CHASE_BOX[0] <= x <= CHASE_BOX[1] and CHASE_BOX[2] <= z <= CHASE_BOX[3]


def chase_map(seed: int = 804) -> pa.Table:
    """Swings and misses cluster low-and-away, far from the zone."""
    rng = random.Random(seed)
    gid = 2026091404
    mix = [("FF", 0.3), ("SL", 0.35), ("CH", 0.2), ("CU", 0.15)]
    rows = []
    for i in range(N_PITCHES):
        pt = _pick(rng, mix)
        spd, ax, lift, spin = _ARSENAL[pt]
        roll = rng.random()
        if roll < 0.40:  # in the zone
            px = rng.uniform(-ZONE_X, ZONE_X)
            pz = rng.uniform(ZONE_BOT, ZONE_TOP)
            swing_p, whiff_p = 0.65, 0.12
        elif roll < 0.75:  # chase box, low and away
            px = rng.uniform(CHASE_BOX[0], CHASE_BOX[1])
            pz = rng.uniform(CHASE_BOX[2], CHASE_BOX[3])
            swing_p, whiff_p = 0.45, 0.60
        else:  # other misses off the plate
            px = rng.choice([-1, 1]) * rng.uniform(1.0, 1.8)
            pz = rng.uniform(2.0, 4.0)
            swing_p, whiff_p = 0.20, 0.20
        rows.append(_row(
            rng, i, game_id=gid, pitcher_id=656605, pitch_type=pt,
            speed=spd + rng.gauss(0, 1.0), x0=1.5 + rng.gauss(0, 0.05),
            z0=5.9 + rng.gauss(0, 0.05), spin=spin + rng.gauss(0, 80),
            ax=ax + rng.gauss(0, 1.0), lift=lift + rng.gauss(0, 1.0),
            plate_x=px, plate_z=pz, swing_p=swing_p, whiff_p=whiff_p,
        ))
    return _table(rows)


def contact_lab(seed: int = 805) -> pa.Table:
    """Arrival speeds from 70 to 100 mph so bat speed / attack angle reshape contact."""
    rng = random.Random(seed)
    gid = 2026091405
    mix = [("FF", 0.35), ("SI", 0.15), ("FC", 0.15), ("SL", 0.15), ("CH", 0.10), ("CU", 0.10)]
    rows = []
    for i in range(N_PITCHES):
        pt = _pick(rng, mix)
        spd, ax, lift, spin = _ARSENAL[pt]
        rows.append(_row(
            rng, i, game_id=gid, pitcher_id=621244, pitch_type=pt,
            speed=spd + rng.gauss(0, 2.0), x0=-1.5 + rng.gauss(0, 0.05),
            z0=5.8 + rng.gauss(0, 0.05), spin=spin + rng.gauss(0, 80),
            ax=ax + rng.gauss(0, 1.2), lift=lift + rng.gauss(0, 1.5),
            plate_x=rng.uniform(-0.7, 0.7), plate_z=rng.uniform(1.7, 3.3),
            swing_p=0.9, whiff_p=0.08,
        ))
    return _table(rows)


_CORPUS_PITCHERS = [  # (pitcher_id, x0, z0, arsenal)
    (100001, -2.1, 5.2, ("FF", "SL")), (100002, -1.8, 5.9, ("SI", "CH")),
    (100003, -1.2, 6.3, ("FF", "CU")), (100004, -0.6, 5.5, ("FC", "SL", "CH")),
    (100005, 0.0, 6.1, ("FF", "CH")), (100006, 0.7, 5.0, ("SI", "SL")),
    (100007, 1.3, 5.7, ("FF", "CU", "CH")), (100008, 1.9, 6.4, ("FC", "CU")),
    (100009, 2.2, 5.3, ("FF", "SL", "CH")), (100010, -1.5, 6.6, ("SI", "CU")),
]


def corpus_slice(seed: int = 806) -> pa.Table:
    """Ten pitchers, varied release points and arsenals: a mixed slice to filter."""
    rng = random.Random(seed)
    gid = 2026091406
    per = N_PITCHES // len(_CORPUS_PITCHERS)
    rows = []
    for pi, (pid, x0, z0, arsenal) in enumerate(_CORPUS_PITCHERS):
        for j in range(per):
            i = pi * per + j
            pt = arsenal[j % len(arsenal)]
            spd, ax, lift, spin = _ARSENAL[pt]
            rows.append(_row(
                rng, i, game_id=gid, pitcher_id=pid, pitch_type=pt,
                speed=spd + rng.gauss(0, 2.5), x0=x0 + rng.gauss(0, 0.06),
                z0=z0 + rng.gauss(0, 0.06), spin=spin + rng.gauss(0, 120),
                ax=ax + rng.gauss(0, 2.0), lift=lift + rng.gauss(0, 2.0),
                plate_x=rng.uniform(-1.6, 1.6), plate_z=rng.uniform(0.8, 4.2),
            ))
    return _table(rows)


SCENARIOS: dict[str, Callable[[], pa.Table]] = {
    "tunnel-vision": tunnel_vision,
    "fatigue-arc": fatigue_arc,
    "ghost-break": ghost_break,
    "chase-map": chase_map,
    "contact-lab": contact_lab,
    "corpus-slice": corpus_slice,
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `python3 -m pytest ingestion/tests/test_scenarios.py -q`
Expected: `25 passed`. Then `python3 -m pytest -q` to confirm nothing else regressed.

- [ ] **Step 5: Commit**

```bash
git add ingestion/scenarios.py ingestion/tests/test_scenarios.py
git commit -m "feat(ingestion): six seeded 500-pitch demo scenarios"
```

---

### Task 2: Serving endpoint `/pitches/scenario/{id}`

**Files:**
- Modify: `serving/app.py` (add import near line 24; add route after `sample`, ~line 120)
- Test: `serving/tests/test_scenario_endpoint.py`

**Interfaces:**
- Consumes: `ingestion.scenarios.SCENARIOS`; `_serialize`, `_respond` already in `serving/app.py`.
- Produces: `GET /pitches/scenario/{scenario_id}` -> Arrow IPC file (`application/vnd.apache.arrow.file`), strong ETag, 304 on match, 404 on unknown id.

- [ ] **Step 1: Write the failing test** — `serving/tests/test_scenario_endpoint.py`:

```python
"""GET /pitches/scenario/{id}: Arrow-only, byte-stable, cacheable, 404 on unknown."""
from __future__ import annotations

import io

import pyarrow as pa
import pytest
from fastapi.testclient import TestClient

import serving.app as app_module
from ingestion.scenarios import SCENARIOS
from ingestion.worker import SCHEMA

MEDIA_ARROW = "application/vnd.apache.arrow.file"


@pytest.fixture()
def client():
    return TestClient(app_module.app)


def _table(body: bytes) -> pa.Table:
    with pa.ipc.open_file(io.BytesIO(body)) as reader:
        return reader.read_all()


@pytest.mark.parametrize("sid", list(SCENARIOS))
def test_scenario_returns_500_row_arrow(client, sid):
    r = client.get(f"/pitches/scenario/{sid}")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(MEDIA_ARROW)
    t = _table(r.content)
    assert t.num_rows == 500
    assert t.schema.equals(SCHEMA)


def test_scenario_is_byte_stable_with_etag_and_304(client):
    a = client.get("/pitches/scenario/tunnel-vision")
    b = client.get("/pitches/scenario/tunnel-vision")
    assert a.content == b.content
    etag = a.headers["etag"]
    assert etag.startswith('"') and "max-age" in a.headers["cache-control"]
    r304 = client.get("/pitches/scenario/tunnel-vision", headers={"If-None-Match": etag})
    assert r304.status_code == 304
    assert r304.content == b""


def test_scenarios_have_distinct_bodies(client):
    etags = {sid: client.get(f"/pitches/scenario/{sid}").headers["etag"] for sid in SCENARIOS}
    assert len(set(etags.values())) == len(SCENARIOS)


def test_unknown_scenario_is_404(client):
    assert client.get("/pitches/scenario/nope").status_code == 404
```

- [ ] **Step 2: Run to verify it fails**

Run: `python3 -m pytest serving/tests/test_scenario_endpoint.py -q`
Expected: FAIL — status 404/405 on the valid ids (route missing).

- [ ] **Step 3: Implement** — in `serving/app.py`, change the import line `from ingestion.worker import synth_day` to:

```python
from ingestion.scenarios import SCENARIOS
from ingestion.worker import synth_day
```

and add directly after the `sample` route:

```python
# Scenario bodies are fully deterministic (fixed seeds + fixed ingestion_time),
# so serialize each once. maxsize == number of scenarios: nothing is evicted.
@functools.lru_cache(maxsize=len(SCENARIOS))
def _scenario_body(scenario_id: str) -> tuple[bytes, str]:
    return _serialize(SCENARIOS[scenario_id]())


@app.get("/pitches/scenario/{scenario_id}")
def scenario(request: Request, scenario_id: str) -> Response:
    if scenario_id not in SCENARIOS:
        raise HTTPException(404, f"unknown scenario {scenario_id!r}")
    body, etag = _scenario_body(scenario_id)
    return _respond(body, etag, request.headers.get("if-none-match"))
```

Also add `  GET /pitches/scenario/{id}  -> curated 500-pitch demo group (Arrow)` to the module docstring.

- [ ] **Step 4: Run to verify it passes**

Run: `python3 -m pytest serving -q`
Expected: all serving tests pass (new file adds 9).

- [ ] **Step 5: Commit**

```bash
git add serving/app.py serving/tests/test_scenario_endpoint.py
git commit -m "feat(serving): /pitches/scenario/{id} Arrow endpoint"
```

---

### Task 3: Client scenario catalog and presets

**Files:**
- Create: `web/src/lib/scenarios.ts`
- Test: `web/src/lib/scenarios.test.ts`

**Interfaces:**
- Consumes: `CameraViewName`, `ZoneFilter`, `OutcomeFilter` from `./deck-layers`; `HeatmapMode` from `./heatmap`.
- Produces (used by Tasks 4-6):
  - `type ScenarioId = "tunnel-vision" | "fatigue-arc" | "ghost-break" | "chase-map" | "contact-lab" | "corpus-slice"`
  - `type LayerKey = "tunneling" | "ghostBreak" | "releasePoints" | "plateCrossings" | "breakChart" | "pairComparison" | "contactSim" | "dispersion" | "fatigue" | "heatmap"`
  - `type LensId = "camera" | "flight" | "types" | "speed" | "plate" | "zone" | "outcome" | "heatmapMode" | "contact"`
  - `interface ScenarioPreset { view; speedRange: [number, number]; plateXRange: [number, number]; plateZRange: [number, number]; zoneFilter; outcomeFilter; selectedTypes: string[]; layers: Record<LayerKey, boolean>; heatmapMode; batSpeed: number; attackAngleDeg: number; pairedTypes: [string, string] | null }`
  - `interface Scenario { id: ScenarioId; title: string; sprint: string; hook: string; lookFor: string; tryThis: string; lens: LensId[]; preset: ScenarioPreset }`
  - `SCENARIOS: readonly Scenario[]`, `DEFAULT_SCENARIO_ID: ScenarioId`, `scenarioById(id: string): Scenario | undefined`, `scenarioUrl(id: ScenarioId): string`, `scenarioSearch(id: ScenarioId): string`, `parseScenarioParam(search: string): ScenarioId | null`.

- [ ] **Step 1: Write the failing test** — `web/src/lib/scenarios.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CAMERA_VIEWS } from "./deck-layers";
import {
  DEFAULT_SCENARIO_ID,
  SCENARIOS,
  parseScenarioParam,
  scenarioById,
  scenarioSearch,
  scenarioUrl,
} from "./scenarios";

const SERVER_IDS = [
  "tunnel-vision", "fatigue-arc", "ghost-break", "chase-map", "contact-lab", "corpus-slice",
];

describe("scenario catalog", () => {
  it("matches the server registry ids, in order", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(SERVER_IDS);
  });

  it("gives every scenario copy, a real camera, and at least one lens control", () => {
    for (const s of SCENARIOS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.hook.length).toBeGreaterThan(0);
      expect(s.lookFor.length).toBeGreaterThan(0);
      expect(s.tryThis.length).toBeGreaterThan(0);
      expect(s.sprint).toMatch(/^S\d|market/);
      expect(Object.keys(CAMERA_VIEWS)).toContain(s.preset.view);
      expect(s.lens.length).toBeGreaterThan(0);
    }
  });

  it("defaults to a scenario that exists", () => {
    expect(scenarioById(DEFAULT_SCENARIO_ID)).toBeDefined();
    expect(scenarioById("nope")).toBeUndefined();
  });

  it("turns on the layers each story is about", () => {
    const L = (id: string) => scenarioById(id)!.preset.layers;
    expect(L("tunnel-vision")).toMatchObject({ tunneling: true, pairComparison: true });
    expect(L("fatigue-arc")).toMatchObject({ dispersion: true, fatigue: true });
    expect(L("ghost-break")).toMatchObject({ ghostBreak: true, breakChart: true });
    expect(L("chase-map")).toMatchObject({ heatmap: true });
    expect(L("contact-lab")).toMatchObject({ contactSim: true });
    expect(Object.values(L("corpus-slice")).every((v) => v === false)).toBe(true);
  });

  it("carries scenario-specific settings", () => {
    const P = (id: string) => scenarioById(id)!.preset;
    expect(P("tunnel-vision").pairedTypes).toEqual(["FF", "SL"]);
    expect(P("chase-map").heatmapMode).toBe("whiff_rate");
    expect(P("contact-lab").batSpeed).toBe(72);
    expect(P("contact-lab").attackAngleDeg).toBe(18);
    for (const s of SCENARIOS.filter((x) => x.id !== "tunnel-vision")) {
      expect(s.preset.pairedTypes).toBeNull();
    }
  });
});

describe("scenario urls", () => {
  it("builds the serving url and the deep-link query", () => {
    expect(scenarioUrl("fatigue-arc")).toBe("/pitches/scenario/fatigue-arc");
    expect(scenarioSearch("fatigue-arc")).toBe("?scenario=fatigue-arc");
  });

  it("parses a known deep link and rejects unknown or missing ones", () => {
    expect(parseScenarioParam("?scenario=chase-map")).toBe("chase-map");
    expect(parseScenarioParam("?a=1&scenario=contact-lab")).toBe("contact-lab");
    expect(parseScenarioParam("?scenario=nope")).toBeNull();
    expect(parseScenarioParam("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/lib/scenarios.test.ts`
Expected: FAIL — cannot resolve `./scenarios`.

- [ ] **Step 3: Implement** — `web/src/lib/scenarios.ts`:

```ts
/**
 * Demo scenario catalog. Data for each id is generated server-side
 * (ingestion/scenarios.py, GET /pitches/scenario/{id}); everything a viewer
 * sees around it (story copy, which layers/filters/camera to apply, which
 * controls matter) is declared here so the serving path stays Arrow-only.
 */
import type { CameraViewName, OutcomeFilter, ZoneFilter } from "./deck-layers";
import type { HeatmapMode } from "./heatmap";

export type ScenarioId =
  | "tunnel-vision"
  | "fatigue-arc"
  | "ghost-break"
  | "chase-map"
  | "contact-lab"
  | "corpus-slice";

export type LayerKey =
  | "tunneling"
  | "ghostBreak"
  | "releasePoints"
  | "plateCrossings"
  | "breakChart"
  | "pairComparison"
  | "contactSim"
  | "dispersion"
  | "fatigue"
  | "heatmap";

export type LensId =
  | "camera"
  | "flight"
  | "types"
  | "speed"
  | "plate"
  | "zone"
  | "outcome"
  | "heatmapMode"
  | "contact";

export interface ScenarioPreset {
  view: CameraViewName;
  speedRange: [number, number];
  plateXRange: [number, number];
  plateZRange: [number, number];
  zoneFilter: ZoneFilter;
  outcomeFilter: OutcomeFilter;
  selectedTypes: string[];
  layers: Record<LayerKey, boolean>;
  heatmapMode: HeatmapMode;
  batSpeed: number;
  attackAngleDeg: number;
  pairedTypes: [string, string] | null;
}

export interface Scenario {
  id: ScenarioId;
  title: string;
  /** ROADMAP sprint the use case comes from, or "market" for positioning. */
  sprint: string;
  hook: string;
  lookFor: string;
  tryThis: string;
  lens: LensId[];
  preset: ScenarioPreset;
}

const NO_LAYERS: Record<LayerKey, boolean> = {
  tunneling: false,
  ghostBreak: false,
  releasePoints: false,
  plateCrossings: false,
  breakChart: false,
  pairComparison: false,
  contactSim: false,
  dispersion: false,
  fatigue: false,
  heatmap: false,
};

const BASE: ScenarioPreset = {
  view: "Catcher",
  speedRange: [70, 105],
  plateXRange: [-2.5, 2.5],
  plateZRange: [0, 5],
  zoneFilter: "all",
  outcomeFilter: "all",
  selectedTypes: [],
  layers: NO_LAYERS,
  heatmapMode: "density",
  batSpeed: 75,
  attackAngleDeg: 10,
  pairedTypes: null,
};

const preset = (over: Partial<ScenarioPreset> & { layers?: Partial<Record<LayerKey, boolean>> }): ScenarioPreset => ({
  ...BASE,
  ...over,
  layers: { ...NO_LAYERS, ...over.layers },
});

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "tunnel-vision",
    title: "Tunnel Vision",
    sprint: "S8-9",
    hook: "Fastball, slider, changeup: identical until it's too late.",
    lookFor:
      "Three pitch types leave one arm slot and pass through nearly the same spot at the commitment plane, then split by more than a foot at the plate. The pair panel shows the Deception Tunnel Ratio.",
    tryThis: "Switch the pair to FF vs CH, then scrub flight progress to watch the paths separate.",
    lens: ["camera", "flight", "types"],
    preset: preset({
      view: "Pitcher",
      layers: { tunneling: true, pairComparison: true },
      pairedTypes: ["FF", "SL"],
    }),
  },
  {
    id: "fatigue-arc",
    title: "Fatigue Arc",
    sprint: "S11",
    hook: "One starter, 500 pitches, and the arm slowly gives way.",
    lookFor:
      "Velocity falls about 3 mph, the arm slot sinks about 3 inches, and the release cloud widens as the count climbs. The panel buckets it every 25 pitches.",
    tryThis: "Raise the minimum speed to 90 mph: the late-game pitches vanish first.",
    lens: ["camera", "speed", "types"],
    preset: preset({
      view: "Side",
      layers: { dispersion: true, fatigue: true, releasePoints: true },
    }),
  },
  {
    id: "ghost-break",
    title: "Ghost Break",
    sprint: "S5, S8",
    hook: "How far did each pitch really move?",
    lookFor:
      "A six-pitch arsenal from a sinker that runs arm-side to a curve that falls off the table. Each ghost path is the same pitch with no spin; the gold gap is the induced break.",
    tryThis: "Toggle types on the chart legend to isolate the curveball's vertical drop.",
    lens: ["camera", "flight", "types"],
    preset: preset({ view: "Catcher", layers: { ghostBreak: true, breakChart: true } }),
  },
  {
    id: "chase-map",
    title: "Chase Map",
    sprint: "S12",
    hook: "Where do swings turn into misses?",
    lookFor:
      "Whiffs pile up low and away, outside the zone, where batters chase. In-zone swings rarely miss. The heatmap is in Whiff % mode.",
    tryThis: "Set the zone filter to Chase and outcome to Whiffs: the cluster is almost the whole set.",
    lens: ["camera", "zone", "outcome", "heatmapMode"],
    preset: preset({
      view: "Catcher",
      layers: { heatmap: true, plateCrossings: true },
      heatmapMode: "whiff_rate",
    }),
  },
  {
    id: "contact-lab",
    title: "Contact Lab",
    sprint: "S10",
    hook: "Same swing, different pitch, different result.",
    lookFor:
      "Pitch speeds from 70 to 100 mph meet a fixed bat. Hover a pitch to see the simulated exit velocity, launch angle, and contact quality. At 72 mph bat speed and 18 degrees, the harder pitches barrel first.",
    tryThis: "Nudge attack angle from 16 to 20 degrees and watch barrels appear across the set.",
    lens: ["camera", "contact", "types"],
    preset: preset({
      view: "Batter",
      layers: { contactSim: true, plateCrossings: true },
      batSpeed: 72,
      attackAngleDeg: 18,
    }),
  },
  {
    id: "corpus-slice",
    title: "Corpus Slice",
    sprint: "market",
    hook: "Savant 3D, but it's a query engine.",
    lookFor:
      "Ten pitchers with different release points and arsenals in one view. Every slider and chip filters on the GPU with no re-query: this is the corpus-scale exploration Savant's pre-rendered pages can't do.",
    tryThis: "Combine an outcome of Whiffs with a speed floor of 93 mph and a plate-height band.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "outcome"],
    preset: preset({ view: "Catcher" }),
  },
];

export const DEFAULT_SCENARIO_ID: ScenarioId = "tunnel-vision";

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export const scenarioUrl = (id: ScenarioId): string => `/pitches/scenario/${id}`;
export const scenarioSearch = (id: ScenarioId): string => `?scenario=${id}`;

export function parseScenarioParam(search: string): ScenarioId | null {
  const raw = new URLSearchParams(search).get("scenario");
  return raw && scenarioById(raw) ? (raw as ScenarioId) : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx vitest run src/lib/scenarios.test.ts && npx tsc -p tsconfig.json --noEmit`
Expected: 7 tests pass; tsc clean (no errors introduced by this file).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/scenarios.ts web/src/lib/scenarios.test.ts
git commit -m "feat(web): scenario catalog, presets and deep-link helpers"
```

---

### Task 4: UI primitives and the three new components

**Files:**
- Create: `web/src/components/ui.tsx`, `web/src/components/ScenarioRail.tsx`, `web/src/components/StoryCaption.tsx`, `web/src/components/LensPanel.tsx`

**Interfaces:**
- Consumes: Task 3 exports; `CAMERA_VIEWS`, `CameraViewName`, `ZoneFilter`, `OutcomeFilter`, `pitchColor` from `../lib/deck-layers`; `HeatmapMode` from `../lib/heatmap`.
- Produces:
  - `ui.tsx`: `THEME` (color tokens), `Segmented<T extends string>(props: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void })`, `RangeField(props: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void })`.
  - `ScenarioRail(props: { scenarios: readonly Scenario[]; activeId: ScenarioId | null; onSelect: (id: ScenarioId) => void; liveActive: boolean; onLive: () => void })`
  - `StoryCaption(props: { scenario: Scenario | null; activeCount: number; totalCount: number })`
  - `LensPanel(props: LensPanelProps)` where `LensPanelProps` is defined in Step 4 below.

These are presentational Solid components (no unit tests; the repo has none for components). They are verified by `tsc` here and by the browser pass in Task 6.

- [ ] **Step 1: Write `web/src/components/ui.tsx`**

```tsx
import { For, type JSX } from "solid-js";

export const THEME = {
  bg: "#020617",
  panel: "rgba(10, 15, 30, 0.95)",
  border: "rgba(255, 255, 255, 0.12)",
  text: "#e2e8f0",
  muted: "#94a3b8",
  accent: "#60a5fa",
  gold: "#fbbf24",
} as const;

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}

export function Segmented<T extends string>(props: SegmentedProps<T>): JSX.Element {
  return (
    <div role="group" aria-label={props.label} style={{ display: "flex", "align-items": "center", gap: "6px" }}>
      <span style={{ color: THEME.muted, "font-size": "11px", "text-transform": "uppercase", "letter-spacing": "0.06em" }}>
        {props.label}
      </span>
      <div style={{ display: "flex", gap: "2px" }}>
        <For each={props.options}>
          {(o) => (
            <button
              aria-pressed={props.value === o.value}
              onClick={() => props.onChange(o.value)}
              style={{
                padding: "3px 9px",
                "font-size": "12px",
                color: props.value === o.value ? "#0b1220" : THEME.text,
                background: props.value === o.value ? THEME.accent : "transparent",
                border: `1px solid ${props.value === o.value ? THEME.accent : THEME.border}`,
                cursor: "pointer",
              }}
            >
              {o.label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}

export interface RangeFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}

export function RangeField(props: RangeFieldProps): JSX.Element {
  return (
    <label style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "12px" }}>
      <span style={{ color: THEME.muted, "min-width": "72px" }}>{props.label}</span>
      <input
        type="range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onInput={(e) => props.onChange(Number(e.currentTarget.value))}
      />
      <span style={{ "font-variant-numeric": "tabular-nums", "min-width": "52px" }}>
        {props.value}
        {props.unit ?? ""}
      </span>
    </label>
  );
}
```

- [ ] **Step 2: Write `web/src/components/ScenarioRail.tsx`**

```tsx
import { For, type JSX } from "solid-js";
import type { Scenario, ScenarioId } from "../lib/scenarios";
import { THEME } from "./ui";

export interface ScenarioRailProps {
  scenarios: readonly Scenario[];
  activeId: ScenarioId | null;
  onSelect: (id: ScenarioId) => void;
  liveActive: boolean;
  onLive: () => void;
}

const card = (active: boolean): JSX.CSSProperties => ({
  display: "block",
  width: "100%",
  "text-align": "left",
  padding: "10px 12px",
  color: THEME.text,
  background: active ? "rgba(96, 165, 250, 0.14)" : "transparent",
  border: `1px solid ${active ? THEME.accent : THEME.border}`,
  "border-left-width": "3px",
  cursor: "pointer",
});

export default function ScenarioRail(props: ScenarioRailProps): JSX.Element {
  return (
    <nav
      aria-label="demo scenarios"
      style={{
        width: "248px",
        "flex-shrink": "0",
        display: "flex",
        "flex-direction": "column",
        gap: "8px",
        padding: "12px",
        background: THEME.panel,
        "border-right": `1px solid ${THEME.border}`,
        "overflow-y": "auto",
      }}
    >
      <For each={props.scenarios}>
        {(s) => (
          <button aria-pressed={props.activeId === s.id} onClick={() => props.onSelect(s.id)} style={card(props.activeId === s.id)}>
            <div style={{ display: "flex", "justify-content": "space-between", "align-items": "baseline" }}>
              <strong style={{ "font-size": "14px" }}>{s.title}</strong>
              <span style={{ color: THEME.muted, "font-size": "11px" }}>{s.sprint}</span>
            </div>
            <div style={{ color: THEME.muted, "font-size": "12px", "margin-top": "4px", "line-height": "1.35" }}>{s.hook}</div>
          </button>
        )}
      </For>
      <button aria-pressed={props.liveActive} onClick={props.onLive} style={{ ...card(props.liveActive), "margin-top": "auto" }}>
        <strong style={{ "font-size": "13px" }}>Live data</strong>
        <div style={{ color: THEME.muted, "font-size": "12px", "margin-top": "4px" }}>Browse real date partitions</div>
      </button>
    </nav>
  );
}
```

- [ ] **Step 3: Write `web/src/components/StoryCaption.tsx`**

```tsx
import { Show, type JSX } from "solid-js";
import type { Scenario } from "../lib/scenarios";
import { THEME } from "./ui";

export interface StoryCaptionProps {
  scenario: Scenario | null;
  activeCount: number;
  totalCount: number;
}

export default function StoryCaption(props: StoryCaptionProps): JSX.Element {
  return (
    <section
      aria-label="scenario story"
      style={{
        padding: "10px 16px",
        background: THEME.panel,
        "border-bottom": `1px solid ${THEME.border}`,
        display: "flex",
        gap: "24px",
        "align-items": "flex-start",
      }}
    >
      <div style={{ flex: "1", "min-width": "0" }}>
        <Show
          when={props.scenario}
          fallback={<div style={{ "font-size": "13px", color: THEME.muted }}>Live data: explore any date partition with the controls below.</div>}
        >
          {(s) => (
            <>
              <h2 style={{ margin: "0 0 4px", "font-size": "16px" }}>{s().title}</h2>
              <p style={{ margin: "0 0 4px", "font-size": "13px", "line-height": "1.45" }}>{s().lookFor}</p>
              <p style={{ margin: "0", "font-size": "12px", color: THEME.gold }}>Try this: {s().tryThis}</p>
            </>
          )}
        </Show>
      </div>
      <div aria-live="polite" style={{ "font-variant-numeric": "tabular-nums", "text-align": "right", "white-space": "nowrap" }}>
        <div style={{ "font-size": "22px", "font-weight": "600" }}>{props.activeCount}</div>
        <div style={{ "font-size": "11px", color: THEME.muted }}>of {props.totalCount} pitches shown</div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Write `web/src/components/LensPanel.tsx`**

```tsx
import { For, Show, type JSX } from "solid-js";
import { CAMERA_VIEWS, pitchColor, type CameraViewName, type OutcomeFilter, type ZoneFilter } from "../lib/deck-layers";
import type { HeatmapMode } from "../lib/heatmap";
import type { LensId } from "../lib/scenarios";
import { RangeField, Segmented, THEME } from "./ui";

export interface LensPanelProps {
  lens: readonly LensId[];
  view: CameraViewName;
  onView: (v: CameraViewName) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  flightProgress: number;
  onFlightProgress: (v: number) => void;
  availableTypes: string[];
  selectedTypes: ReadonlySet<string>;
  onToggleType: (code: string) => void;
  speed: [number, number];
  onSpeed: (v: [number, number]) => void;
  plateX: [number, number];
  onPlateX: (v: [number, number]) => void;
  plateZ: [number, number];
  onPlateZ: (v: [number, number]) => void;
  zoneFilter: ZoneFilter;
  onZoneFilter: (v: ZoneFilter) => void;
  outcomeFilter: OutcomeFilter;
  onOutcomeFilter: (v: OutcomeFilter) => void;
  heatmapMode: HeatmapMode;
  onHeatmapMode: (m: HeatmapMode) => void;
  batSpeed: number;
  onBatSpeed: (v: number) => void;
  attackAngleDeg: number;
  onAttackAngleDeg: (v: number) => void;
}

const VIEWS = (Object.keys(CAMERA_VIEWS) as CameraViewName[]).map((v) => ({ value: v, label: v }));

export default function LensPanel(props: LensPanelProps): JSX.Element {
  const has = (id: LensId) => props.lens.includes(id);
  return (
    <div
      role="region"
      aria-label="scenario controls"
      style={{
        display: "flex",
        "flex-wrap": "wrap",
        "align-items": "center",
        gap: "10px 24px",
        padding: "10px 16px",
        background: THEME.panel,
        "border-top": `1px solid ${THEME.border}`,
      }}
    >
      <Show when={has("camera")}>
        <Segmented label="View" value={props.view} options={VIEWS} onChange={props.onView} />
      </Show>

      <Show when={has("flight")}>
        <div style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "12px" }}>
          <button onClick={props.onTogglePlay} aria-pressed={props.isPlaying}>
            {props.isPlaying ? "Pause" : "Play"}
          </button>
          <RangeField
            label="Flight"
            value={Math.round(props.flightProgress * 100)}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => props.onFlightProgress(v / 100)}
          />
        </div>
      </Show>

      <Show when={has("types") && props.availableTypes.length > 0}>
        <div role="group" aria-label="pitch types" style={{ display: "flex", gap: "4px", "align-items": "center" }}>
          <For each={props.availableTypes}>
            {(code) => {
              const [r, g, b] = pitchColor(code);
              const on = () => props.selectedTypes.size === 0 || props.selectedTypes.has(code);
              return (
                <button
                  aria-pressed={props.selectedTypes.has(code)}
                  onClick={() => props.onToggleType(code)}
                  style={{
                    padding: "3px 9px",
                    "font-size": "12px",
                    color: THEME.text,
                    opacity: on() ? "1" : "0.4",
                    background: `rgba(${r}, ${g}, ${b}, 0.18)`,
                    border: `1px solid rgb(${r}, ${g}, ${b})`,
                    cursor: "pointer",
                  }}
                >
                  {code}
                </button>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={has("speed")}>
        <RangeField
          label="Min speed"
          value={props.speed[0]}
          min={60}
          max={105}
          step={1}
          unit=" mph"
          onChange={(v) => props.onSpeed([Math.min(v, props.speed[1]), props.speed[1]])}
        />
      </Show>

      <Show when={has("plate")}>
        <RangeField
          label="Plate height min"
          value={props.plateZ[0]}
          min={0}
          max={5}
          step={0.1}
          unit=" ft"
          onChange={(v) => props.onPlateZ([Math.min(v, props.plateZ[1]), props.plateZ[1]])}
        />
        <RangeField
          label="Plate width max"
          value={props.plateX[1]}
          min={-2.5}
          max={2.5}
          step={0.1}
          unit=" ft"
          onChange={(v) => props.onPlateX([props.plateX[0], Math.max(v, props.plateX[0])])}
        />
      </Show>

      <Show when={has("zone")}>
        <Segmented
          label="Zone"
          value={props.zoneFilter}
          options={[
            { value: "all", label: "All" },
            { value: "in_zone", label: "In zone" },
            { value: "out_of_zone", label: "Chase" },
          ]}
          onChange={props.onZoneFilter}
        />
      </Show>

      <Show when={has("outcome")}>
        <Segmented
          label="Outcome"
          value={props.outcomeFilter}
          options={[
            { value: "all", label: "All" },
            { value: "swings", label: "Swings" },
            { value: "whiffs", label: "Whiffs" },
          ]}
          onChange={props.onOutcomeFilter}
        />
      </Show>

      <Show when={has("heatmapMode")}>
        <Segmented
          label="Heatmap"
          value={props.heatmapMode}
          options={[
            { value: "density", label: "Density" },
            { value: "whiff_rate", label: "Whiff %" },
          ]}
          onChange={props.onHeatmapMode}
        />
      </Show>

      <Show when={has("contact")}>
        <RangeField label="Bat speed" value={props.batSpeed} min={55} max={85} step={1} unit=" mph" onChange={props.onBatSpeed} />
        <RangeField label="Attack angle" value={props.attackAngleDeg} min={0} max={30} step={1} unit="°" onChange={props.onAttackAngleDeg} />
      </Show>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run (repo root): `npx tsc -p web/tsconfig.json --noEmit`
Expected: no errors. If `deck-layers.ts` does not export `ZoneFilter`/`OutcomeFilter`/`pitchColor`/`CAMERA_VIEWS` under those names, stop and check `web/src/lib/deck-layers.ts` (they are exported today, lines 111-145 and 272-273).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ui.tsx web/src/components/ScenarioRail.tsx web/src/components/StoryCaption.tsx web/src/components/LensPanel.tsx
git commit -m "feat(web): scenario rail, story caption and lens panel components"
```

---

### Task 5: Wire the App (layout, presets, deep link, drawer)

**Files:**
- Modify: `web/src/App.tsx` (imports lines 1-21; signals ~lines 23-51; handlers ~109-171; JSX 195-313)

**Interfaces:**
- Consumes: everything from Tasks 3-4; existing `fetchPitches`, `fetchDatePartitions`, signals.
- Produces: `selectScenario(id: ScenarioId)` and `applyPreset(p: ScenarioPreset)` (module-internal to `App`); URL `?scenario=<id>` kept in sync via `history.replaceState`.

- [ ] **Step 1: Add imports.** In `web/src/App.tsx` change the solid import to include `batch`, and add:

```tsx
import { batch, createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import ScenarioRail from "./components/ScenarioRail";
import StoryCaption from "./components/StoryCaption";
import LensPanel from "./components/LensPanel";
import {
  DEFAULT_SCENARIO_ID,
  SCENARIOS,
  parseScenarioParam,
  scenarioById,
  scenarioSearch,
  scenarioUrl,
  type ScenarioId,
  type ScenarioPreset,
} from "./lib/scenarios";
```

- [ ] **Step 2: Add state.** Below the existing signals add:

```tsx
  const [activeScenarioId, setActiveScenarioId] = createSignal<ScenarioId | null>(null);
  const [showAllControls, setShowAllControls] = createSignal<boolean>(false);
  const activeScenario = createMemo(() => {
    const id = activeScenarioId();
    return id ? scenarioById(id) ?? null : null;
  });
```

- [ ] **Step 3: Add `applyPreset` and `selectScenario`** after `handleLoadSample`:

```tsx
  const applyPreset = (p: ScenarioPreset) => {
    setView(p.view);
    setSpeedRange(p.speedRange);
    setPlateXRange(p.plateXRange);
    setPlateZRange(p.plateZRange);
    setZoneFilter(p.zoneFilter);
    setOutcomeFilter(p.outcomeFilter);
    setSelectedTypes(new Set(p.selectedTypes));
    setShowTunneling(p.layers.tunneling);
    setShowGhostBreak(p.layers.ghostBreak);
    setShowReleasePoints(p.layers.releasePoints);
    setShowPlateCrossings(p.layers.plateCrossings);
    setShowBreakChart(p.layers.breakChart);
    setShowPairComparison(p.layers.pairComparison);
    setShowContactSim(p.layers.contactSim);
    setShowDispersion(p.layers.dispersion);
    setShowFatigue(p.layers.fatigue);
    setShowHeatmap(p.layers.heatmap);
    setHeatmapMode(p.heatmapMode);
    setBatSpeed(p.batSpeed);
    setAttackAngleDeg(p.attackAngleDeg);
    setPairedTypes(p.pairedTypes);
  };

  const selectScenario = (id: ScenarioId) => {
    const sc = scenarioById(id);
    if (!sc) return;
    batch(() => {
      setActiveScenarioId(id);
      applyPreset(sc.preset);
      setIsPlaying(false);
      setFlightProgress(1.0);
      setSelectedDate("");
      setErrorMessage(null);
      setIsLoading(true);
    });
    try {
      history.replaceState(null, "", scenarioSearch(id));
    } catch {
      /* non-browser test env */
    }
    fetchPitches(scenarioUrl(id))
      .then((data) => {
        if (activeScenarioId() === id) setPitchData(data);
      })
      .catch((err) => {
        console.error("Failed to load scenario:", err);
        if (activeScenarioId() === id) setErrorMessage(`Failed to load ${sc.title}: ${err.message}`);
      })
      .finally(() => {
        if (activeScenarioId() === id) setIsLoading(false);
      });
  };

  const selectLive = () => {
    batch(() => {
      setActiveScenarioId(null);
      setShowAllControls(true);
    });
    try {
      history.replaceState(null, "", location.pathname);
    } catch {
      /* non-browser test env */
    }
    handleLoadSample();
  };
```

- [ ] **Step 4: Replace `onMount`** with:

```tsx
  onMount(() => {
    // Date partitions only feed the Live data drawer; failure is non-fatal.
    fetchDatePartitions().then(setDatePartitions).catch(() => {});
    selectScenario(parseScenarioParam(location.search) ?? DEFAULT_SCENARIO_ID);
  });
```

- [ ] **Step 5: Replace the returned JSX** (from `return (` to the closing `);` of `App`) with the layout below. Keep the `<Visualizer ...>` props block and the `<ControlPanel ...>` props block exactly as they are today; only the wrappers around them change.

```tsx
  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", "flex-direction": "column", overflow: "hidden" }}>
      <header
        style={{
          position: "relative",
          "z-index": "20",
          background: "rgba(10, 15, 30, 0.95)",
          "border-bottom": "1px solid rgba(255, 255, 255, 0.12)",
          padding: "8px 16px",
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
        }}
      >
        <div style={{ display: "flex", "align-items": "baseline", gap: "12px" }}>
          <strong style={{ "font-size": "15px" }}>Statcast Lakehouse</strong>
          <span style={{ "font-size": "12px", color: "#94a3b8" }}>GPU-filtered 3D pitch exploration</span>
          <Show when={isLoading()}>
            <span role="status" style={{ color: "#60a5fa", "font-size": "12px" }}>Loading…</span>
          </Show>
          <Show when={errorMessage()}>
            <span role="alert" style={{ color: "#f87171", "font-size": "12px" }}>{errorMessage()}</span>
          </Show>
        </div>
        <button aria-pressed={showAllControls()} onClick={() => setShowAllControls((v) => !v)}>
          {showAllControls() ? "Hide all controls" : "All controls"}
        </button>
      </header>

      <div style={{ flex: "1", display: "flex", "min-height": "0" }}>
        <ScenarioRail
          scenarios={SCENARIOS}
          activeId={activeScenarioId()}
          onSelect={selectScenario}
          liveActive={activeScenarioId() === null}
          onLive={selectLive}
        />
        <main style={{ flex: "1", display: "flex", "flex-direction": "column", "min-width": "0" }}>
          <StoryCaption
            scenario={activeScenario()}
            activeCount={activeCount()}
            totalCount={pitchData()?.pitches.length ?? 0}
          />
          {/* <Visualizer ... /> — unchanged props block from the current file */}
          <Show when={activeScenario()}>
            {(s) => (
              <LensPanel
                lens={s().lens}
                view={view()}
                onView={setView}
                isPlaying={isPlaying()}
                onTogglePlay={togglePlay}
                flightProgress={flightProgress()}
                onFlightProgress={setFlightProgress}
                availableTypes={availableTypes()}
                selectedTypes={selectedTypes()}
                onToggleType={toggleType}
                speed={speedRange()}
                onSpeed={setSpeedRange}
                plateX={plateXRange()}
                onPlateX={setPlateXRange}
                plateZ={plateZRange()}
                onPlateZ={setPlateZRange}
                zoneFilter={zoneFilter()}
                onZoneFilter={setZoneFilter}
                outcomeFilter={outcomeFilter()}
                onOutcomeFilter={setOutcomeFilter}
                heatmapMode={heatmapMode()}
                onHeatmapMode={setHeatmapMode}
                batSpeed={batSpeed()}
                onBatSpeed={setBatSpeed}
                attackAngleDeg={attackAngleDeg()}
                onAttackAngleDeg={setAttackAngleDeg}
              />
            )}
          </Show>
        </main>
      </div>

      <Show when={showAllControls()}>
        <div style={{ "max-height": "45vh", "overflow-y": "auto" }}>
          {/* <ControlPanel ... /> — unchanged props block from the current file */}
        </div>
      </Show>
    </div>
  );
```

Replace the two `{/* ... unchanged props block ... */}` comments by pasting the existing `<Visualizer .../>` and `<ControlPanel .../>` JSX verbatim (no props changes). Note `main` is a flex column and `Visualizer`'s root already has `flex: "1"`, so it fills the space between caption and lens.

- [ ] **Step 6: Verify**

Run: `npx tsc -p web/tsconfig.json --noEmit && cd web && npm test && npm run build`
Expected: tsc clean; all vitest tests pass (existing 139 + 7 new); build succeeds.

- [ ] **Step 7: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(web): scenario-driven app shell with preset application and deep links"
```

---

### Task 6: Browser verification and visual pass

**Files:** touches only `web/src/components/*.tsx`, `web/src/App.tsx`, `web/index.html` styling as needed.

- [ ] **Step 1: Start the stack.** Terminal A: `pip install -r ingestion/requirements.txt uvicorn` (if needed) then `uvicorn serving.app:app --port 8000`. Terminal B: `cd web && npm run dev`. Open `http://localhost:5173/`.

- [ ] **Step 2: Walk every scenario** (rail card or `?scenario=<id>`) at 1440x900 and 1024x768. For each, confirm and screenshot:
  - Header count reads `500` (shown/total in the caption); no console errors.
  - `tunnel-vision`: tunneling plane + pair panel visible, camera behind the mound.
  - `fatigue-arc`: dispersion ellipsoid + fatigue panel + release points; buckets show velocity falling ~3 mph.
  - `ghost-break`: ghost paths + break chart.
  - `chase-map`: heatmap in Whiff % mode, hot cluster low-and-away.
  - `contact-lab`: hover a pitch, tooltip shows `Sim: ... (Barrel)`; bat speed 72 / attack angle 18 shown in the lens; moving attack angle 16 -> 20 flips more pitches to Barrel.
  - `corpus-slice`: no overlays; sliders/chips/zone/outcome all filter with no lag.
  - Switching scenarios resets layers (nothing from the prior scenario leaks) and stops flight playback.
  - "All controls" opens the full legacy panel; "Live data" opens it and loads the sample day.
  - Reload with `?scenario=chase-map` opens directly on Chase Map.

- [ ] **Step 3: Visual pass.** Invoke the `frontend-design:frontend-design` skill and apply it to `ScenarioRail`, `StoryCaption`, `LensPanel`, the header, and `ui.tsx` `THEME`: a deliberate type scale, spacing rhythm, an accent tied to the scene, card hover/focus states, and no default-browser buttons (`Play`, `All controls`). Acceptance: no horizontal overflow at 1024 px, keyboard focus visible on every control, `aria-pressed` states legible, the story caption never covers more than ~25% of the viewport height at 1024x768.

- [ ] **Step 4: Regression gates**

Run: `python3 -m pytest -q && cd web && npm test && npm run build && cd .. && npx tsc -p web/tsconfig.json --noEmit`
Expected: everything green.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "style(web): scenario rail, caption and lens visual pass"
```

---

### Task 7: Docs

**Files:**
- Modify: `docs/ROADMAP.md` (append after item 21), `AGENTS.md` (Layout section)

- [ ] **Step 1: Append to `docs/ROADMAP.md`:**

```markdown
## 22. Scenario demo: six curated 500-pitch groups (Completed offline)
- `ingestion/scenarios.py`: seeded, physically consistent generators (Tunnel Vision, Fatigue Arc,
  Ghost Break, Chase Map, Contact Lab, Corpus Slice); each is exactly 500 rows in `worker.SCHEMA`.
- `serving/app.py`: `GET /pitches/scenario/{id}` (Arrow IPC, ETag/304, 404 on unknown id).
- `web/src/lib/scenarios.ts`: client-side catalog + presets; `ScenarioRail`, `StoryCaption`, and
  `LensPanel` replace the always-open control footer, which becomes an "All controls" drawer.
- Acceptance: `ingestion/tests/test_scenarios.py` pins each group's signal (tunnel ratio > 5,
  fatigue velo -2.5 mph, chase whiff 2.5x, ...); `?scenario=<id>` deep-links.
```

- [ ] **Step 2: In `AGENTS.md` Layout**, add under `serving/`: ``- `ingestion/scenarios.py` — seeded 500-pitch demo groups; `web/src/lib/scenarios.ts` holds their UI presets (keep ids in sync; a vitest guard checks).``

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md AGENTS.md
git commit -m "docs: roadmap item 22 and layout note for scenario demo"
```

---

## Self-Review

- **Spec coverage:** six groups + signals (Task 1); Arrow endpoint, ETag/304/404, no JSON (Task 2); client catalog/manifest, presets, deep link (Task 3); scenario rail, story caption, lens panel, all-controls drawer, Live data entry, default `tunnel-vision`, atomic preset apply (Tasks 4-5); tests per spec (Tasks 1-3, gates in 6); frontend-design pass (Task 6); out-of-scope items untouched.
- **Placeholders:** the only "paste verbatim" instruction is Task 5 Step 5's Visualizer/ControlPanel prop blocks, which are unchanged existing code the executor keeps; no TBDs.
- **Type consistency:** `ScenarioId`, `LayerKey`, `LensId`, `ScenarioPreset` fields (`speedRange`, `plateXRange`, `plateZRange`, `selectedTypes: string[]`, `layers`, `pairedTypes`) are used identically in Tasks 3-5; `SCENARIOS` is the client array in `scenarios.ts` and the dict in `scenarios.py` (distinct languages, same ids, guarded by the vitest id-order test).
- **Known risk:** LensPanel "Plate width max" only trims the right edge of plate X (a one-slider simplification); the full X/Z band stays in the All controls drawer.
