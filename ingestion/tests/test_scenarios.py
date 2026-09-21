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
        assert m["plate_divergence_inches"] > 12.0
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
        if not sw:
            return 0, 0.0
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


@pytest.mark.parametrize("sid", EXPECTED_IDS)
def test_every_pitch_inside_default_filters(sid, rows):
    for r in rows[sid]:
        assert -2.5 <= r["plate_x"] <= 2.5
        assert 0 <= r["plate_z"] <= 5
        assert 70 <= r["release_speed"] <= 105
