"""Statcast ingestion worker.

Two modes:
  * live     — poll the MLB Stats API and write to BigQuery via
               batch load jobs (WRITE_APPEND, 5,000 rows per job).
  * dry-run  — generate a synthetic day of pitches and write an Apache Arrow
               IPC file locally. No GCP credentials, no network. This is the
               mode used by tests and local development.

Usage:
  python -m ingestion.worker --dry-run --out data/sample.arrow --pitches 200
  python -m ingestion.worker --live --date 2026-09-14   # requires GCP creds
  python -m ingestion.worker --live --backfill 2026-09-10 2026-09-12
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

import pyarrow as pa

# Physical constants for the plate plane (Statcast convention, feet).
PLATE_Y_FT = 1.417
GRAVITY_FT_S2 = 32.174
PITCHING_RUBBER_Y_FT = 60.5
COMMITMENT_PLANE_Y_FT = 23.8

SCHEMA = pa.schema(
    [
        ("pitch_id", pa.string()),
        ("game_id", pa.int64()),
        ("game_date", pa.date32()),
        ("pitcher_id", pa.int64()),
        ("batter_id", pa.int64()),
        ("pitch_type", pa.string()),
        ("release_speed", pa.float64()),
        ("release_spin_rate", pa.float64()),
        ("x0", pa.float64()),
        ("y0", pa.float64()),
        ("z0", pa.float64()),
        ("vx0", pa.float64()),
        ("vy0", pa.float64()),
        ("vz0", pa.float64()),
        ("ax", pa.float64()),
        ("ay", pa.float64()),
        ("az", pa.float64()),
        ("plate_x", pa.float64()),
        ("plate_z", pa.float64()),
        ("sz_top", pa.float64()),
        ("sz_bot", pa.float64()),
        ("is_swing", pa.int64()),
        ("is_whiff", pa.int64()),
        ("ingestion_time", pa.timestamp("us", tz="UTC")),
    ]
)

PITCH_TYPES = ("FF", "SL", "CH", "CU", "SI", "FC", "KC", "FS")


def solve_flight_time(y0: float, vy0: float, ay: float, y_end: float = PLATE_Y_FT) -> float:
    """Solve a y(t) = y0 + vy0*t + 0.5*ay*t^2 for the crossing of y_end.

    The ball travels from y0 (~55 ft, release) toward the plate with negative
    vy0, so the larger quadratic root is the physically meaningful one.
    Raises ValueError when the discriminant is negative (ball never reaches
    the plate) or both roots are non-positive.
    """
    a = 0.5 * ay
    b = vy0
    c = y0 - y_end
    disc = b * b - 4.0 * a * c
    if disc < 0:
        raise ValueError("pitch never reaches the plate plane (negative discriminant)")
    if abs(a) < 1e-12:  # degenerate: constant-velocity fit
        if b == 0:
            raise ValueError("degenerate pitch: y is constant")
        t = -c / b
        if t <= 0 or b > 0:
            raise ValueError("pitch plane crossing is not in the future")
        return t
    roots = sorted(
        t for t in ((-b - math.sqrt(disc)) / (2.0 * a), (-b + math.sqrt(disc)) / (2.0 * a))
        if t > 0 and b + 2.0 * a * t < 0
    )
    if not roots:
        raise ValueError("pitch plane crossing is not in the future")
    return roots[0]


def position_at(pitch: dict[str, float], t: float) -> tuple[float, float, float]:
    """Constant-acceleration (9-parameter) position at time t, in feet."""
    return (
        pitch["x0"] + pitch["vx0"] * t + 0.5 * pitch["ax"] * t * t,
        pitch["y0"] + pitch["vy0"] * t + 0.5 * pitch["ay"] * t * t,
        pitch["z0"] + pitch["vz0"] * t + 0.5 * pitch["az"] * t * t,
    )


def trajectory(pitch: dict[str, float], n: int = 60) -> list[tuple[float, float, float]]:
    """n points from release to the plate plane (Statcast's 60-point path)."""
    t_end = solve_flight_time(pitch["y0"], pitch["vy0"], pitch["ay"])
    return [position_at(pitch, t_end * i / (n - 1)) for i in range(n)]


def ghost_kinematics(pitch: dict[str, float]) -> dict[str, float]:
    """Kinematic parameters without Magnus aerodynamic force (gravity + drag only)."""
    ghost = dict(pitch)
    ghost["ax"] = 0.0
    ghost["ay"] = pitch["ay"]
    ghost["az"] = -GRAVITY_FT_S2
    return ghost


def ghost_trajectory(
    pitch: dict[str, float], n: int = 60
) -> list[tuple[float, float, float]]:
    """n points along the trajectory under pure gravity and drag."""
    return trajectory(ghost_kinematics(pitch), n=n)


def compute_break_vector(pitch: dict[str, float]) -> dict[str, float]:
    """Aerodynamic break in inches at plate arrival (Nathan 2012 definition)."""
    t_end = solve_flight_time(pitch["y0"], pitch["vy0"], pitch["ay"])
    dx_ft = 0.5 * pitch["ax"] * t_end * t_end
    dz_ft = 0.5 * (pitch["az"] - (-GRAVITY_FT_S2)) * t_end * t_end
    h_break = dx_ft * 12.0
    v_break = dz_ft * 12.0
    return {
        "h_break_inches": h_break,
        "v_break_inches": v_break,
        "total_break_inches": math.hypot(h_break, v_break),
    }


def break_vector_segment(
    pitch: dict[str, float],
) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    """Line segment connecting ghost arrival point to actual arrival point at the plate."""
    t_end = solve_flight_time(pitch["y0"], pitch["vy0"], pitch["ay"])
    actual = position_at(pitch, t_end)
    ghost = position_at(ghost_kinematics(pitch), t_end)
    return (ghost, actual)


def release_extension(y0: float) -> float:
    """Extension in feet from the pitching rubber (60.5 ft) to release point."""
    return PITCHING_RUBBER_Y_FT - y0


def solve_commitment_time(y0: float, vy0: float, ay: float) -> float:
    """Solve for the time t when the pitch crosses the commitment plane (y = 23.8 ft)."""
    return solve_flight_time(y0, vy0, ay, y_end=COMMITMENT_PLANE_Y_FT)


def commitment_position(pitch: dict[str, float]) -> tuple[float, float, float]:
    """Position (x, y, z) in feet at the commitment plane (y = 23.8 ft)."""
    t = solve_commitment_time(pitch["y0"], pitch["vy0"], pitch["ay"])
    return position_at(pitch, t)


def tunneling_distance(p1: dict[str, float], p2: dict[str, float]) -> float:
    """Tunneling separation distance in inches at the commitment plane (y = 23.8 ft)."""
    c1 = commitment_position(p1)
    c2 = commitment_position(p2)
    return math.hypot(c1[0] - c2[0], c1[2] - c2[2]) * 12.0


def compute_arsenal_centroids(pitches: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Compute mean kinematic centroids and break characteristics per pitch_type."""
    by_type: dict[str, list[dict[str, Any]]] = {}
    for p in pitches:
        pt = p.get("pitch_type", "")
        if pt:
            by_type.setdefault(pt, []).append(p)

    centroids: dict[str, dict[str, Any]] = {}
    for pt, pts in by_type.items():
        n = len(pts)
        mean_speed = sum(p.get("release_speed", 0.0) for p in pts) / n
        mean_spin = sum(p.get("release_spin_rate", 0.0) for p in pts) / n
        mean_x0 = sum(p["x0"] for p in pts) / n
        mean_y0 = sum(p["y0"] for p in pts) / n
        mean_z0 = sum(p["z0"] for p in pts) / n
        mean_vx0 = sum(p["vx0"] for p in pts) / n
        mean_vy0 = sum(p["vy0"] for p in pts) / n
        mean_vz0 = sum(p["vz0"] for p in pts) / n
        mean_ax = sum(p["ax"] for p in pts) / n
        mean_ay = sum(p["ay"] for p in pts) / n
        mean_az = sum(p["az"] for p in pts) / n
        mean_px = sum(p.get("plate_x", 0.0) for p in pts) / n
        mean_pz = sum(p.get("plate_z", 0.0) for p in pts) / n

        k_mean = {
            "x0": mean_x0, "y0": mean_y0, "z0": mean_z0,
            "vx0": mean_vx0, "vy0": mean_vy0, "vz0": mean_vz0,
            "ax": mean_ax, "ay": mean_ay, "az": mean_az,
        }
        bv = compute_break_vector(k_mean)
        commit_pos = commitment_position(k_mean)

        centroids[pt] = {
            "pitch_type": pt,
            "count": n,
            "release_speed": mean_speed,
            "release_spin_rate": mean_spin,
            "kinematics": k_mean,
            "plate_x": mean_px,
            "plate_z": mean_pz,
            "h_break_inches": bv["h_break_inches"],
            "v_break_inches": bv["v_break_inches"],
            "commitment_point": commit_pos,
        }
    return centroids


def compute_pitch_pair_metrics(c1: dict[str, Any], c2: dict[str, Any]) -> dict[str, float]:
    """Compute pairwise tunneling and deception divergence metrics between two pitch centroids."""
    k1 = c1["kinematics"]
    k2 = c2["kinematics"]

    # Release separation in inches
    rel_sep = math.hypot(k1["x0"] - k2["x0"], k1["z0"] - k2["z0"]) * 12.0

    # Tunneling separation in inches at commitment plane (y = 23.8 ft)
    cp1 = c1["commitment_point"]
    cp2 = c2["commitment_point"]
    tunnel_sep = math.hypot(cp1[0] - cp2[0], cp1[2] - cp2[2]) * 12.0

    # Plate divergence in inches at plate plane (y = 1.417 ft)
    t_end1 = solve_flight_time(k1["y0"], k1["vy0"], k1["ay"])
    t_end2 = solve_flight_time(k2["y0"], k2["vy0"], k2["ay"])
    pos1 = position_at(k1, t_end1)
    pos2 = position_at(k2, t_end2)
    plate_sep = math.hypot(pos1[0] - pos2[0], pos1[2] - pos2[2]) * 12.0

    # Break divergence in inches
    break_sep = math.hypot(c1["h_break_inches"] - c2["h_break_inches"], c1["v_break_inches"] - c2["v_break_inches"])

    # Velocity delta in mph
    delta_speed = abs(c1["release_speed"] - c2["release_speed"])

    # Tunnel ratio (Deception index): divergence at plate over separation at commitment plane
    tunnel_ratio = plate_sep / max(tunnel_sep, 0.01)

    return {
        "release_separation_inches": rel_sep,
        "tunneling_separation_inches": tunnel_sep,
        "plate_divergence_inches": plate_sep,
        "break_divergence_inches": break_sep,
        "velocity_delta_mph": delta_speed,
        "tunnel_ratio": tunnel_ratio,
    }


def classify_contact_quality(exit_speed_mph: float, launch_angle_deg: float) -> str:
    """Classify contact quality according to Statcast Barrel and batted ball zones."""
    if exit_speed_mph <= 0.0:
        return "Whiff"

    if exit_speed_mph >= 98.0:
        min_angle = max(8.0, 26.0 - (exit_speed_mph - 98.0) * 1.0)
        max_angle = min(50.0, 30.0 + (exit_speed_mph - 98.0) * 1.1)
        if min_angle <= launch_angle_deg <= max_angle:
            return "Barrel"

    if exit_speed_mph >= 90.0 and 10.0 <= launch_angle_deg <= 38.0:
        return "Solid Contact"

    if exit_speed_mph >= 80.0 and 0.0 <= launch_angle_deg <= 25.0:
        return "Flare/Burner"

    if launch_angle_deg > 38.0:
        return "Under"

    if launch_angle_deg < 0.0:
        return "Topped"

    return "Weak"


def compute_collision(
    pitch: dict[str, float],
    bat_speed: float = 75.0,
    attack_angle_deg: float = 10.0,
    offset_z_in: float = 0.0,
    offset_x_in: float = 0.0,
) -> dict[str, Any]:
    """Simulate ball-bat collision (Cross & Nathan 2006, arXiv:physics/0605040)."""
    t_end = solve_flight_time(pitch["y0"], pitch["vy0"], pitch["ay"])
    vx_end = pitch["vx0"] + pitch["ax"] * t_end
    vy_end = pitch["vy0"] + pitch["ay"] * t_end
    vz_end = pitch["vz0"] + pitch["az"] * t_end
    arrival_speed_fps = math.sqrt(vx_end * vx_end + vy_end * vy_end + vz_end * vz_end)
    arrival_speed_mph = arrival_speed_fps / 1.467

    r_eff = 2.5
    d = math.hypot(offset_x_in, offset_z_in)

    if d > r_eff:
        return {
            "exit_speed_mph": 0.0,
            "launch_angle_deg": 0.0,
            "spray_angle_deg": 0.0,
            "contact_quality": "Whiff",
            "distance_ft": 0.0,
            "hang_time_s": 0.0,
        }

    q = 0.22
    flush_exit = q * arrival_speed_mph + (1.0 + q) * bat_speed

    f_offset = math.sqrt(max(0.0, 1.0 - (d / r_eff) ** 2))
    exit_speed = flush_exit * f_offset

    angle_offset = math.asin(offset_z_in / r_eff) * (180.0 / math.pi) * 0.6
    launch_angle = attack_angle_deg - angle_offset

    spray_angle = math.asin(offset_x_in / r_eff) * (180.0 / math.pi) * 0.6

    quality = classify_contact_quality(exit_speed, launch_angle)

    v0_fps = exit_speed * 1.467
    theta_rad = math.radians(launch_angle)
    vz0 = v0_fps * math.sin(theta_rad)
    vy0 = v0_fps * math.cos(theta_rad) * math.cos(math.radians(spray_angle))
    pos_end = position_at(pitch, t_end)
    z_plate = max(0.5, pos_end[2])

    disc = vz0 * vz0 + 2.0 * GRAVITY_FT_S2 * z_plate
    t_hang = (vz0 + math.sqrt(max(0.0, disc))) / GRAVITY_FT_S2 if disc >= 0 else 0.0
    t_hang = max(0.0, min(t_hang, 7.5))

    distance_ft = vy0 * t_hang * math.exp(-0.12 * t_hang) if t_hang > 0 else 0.0

    return {
        "exit_speed_mph": exit_speed,
        "launch_angle_deg": launch_angle,
        "spray_angle_deg": spray_angle,
        "contact_quality": quality,
        "distance_ft": max(0.0, distance_ft),
        "hang_time_s": t_hang,
    }


def project_batted_trajectory(
    origin: tuple[float, float, float],
    exit_speed_mph: float,
    launch_angle_deg: float,
    spray_angle_deg: float = 0.0,
    hang_time_s: float = 4.0,
    n: int = 40,
) -> list[tuple[float, float, float]]:
    """Project n-point 3D flight path of a batted ball into field coordinates."""
    v0 = exit_speed_mph * 1.467
    theta = math.radians(launch_angle_deg)
    phi = math.radians(spray_angle_deg)
    vx0 = v0 * math.sin(phi) * math.cos(theta)
    vy0 = v0 * math.cos(phi) * math.cos(theta)
    vz0 = v0 * math.sin(theta)

    points: list[tuple[float, float, float]] = []
    x0, y0, z0 = origin
    t_total = max(0.1, hang_time_s)

    for i in range(n):
        t = t_total * i / (n - 1)
        damping = math.exp(-0.12 * t)
        x = x0 + vx0 * t * damping
        y = y0 + vy0 * t * damping
        z = max(0.0, z0 + vz0 * t - 0.5 * GRAVITY_FT_S2 * t * t)
        points.append((x, y, z))

    return points


def generate_ellipsoid_wireframe(
    center: tuple[float, float, float],
    radii: tuple[float, float, float],
    n_segments: int = 24,
) -> list[list[tuple[float, float, float]]]:
    """Generate wireframe segments for a 3D dispersion ellipsoid."""
    cx, cy, cz = center
    rx, ry, rz = radii
    segments: list[list[tuple[float, float, float]]] = []

    if rx <= 0 or ry <= 0 or rz <= 0:
        return segments

    # 1. Equator in XY plane at z = cz
    xy_loop = []
    for i in range(n_segments + 1):
        angle = 2.0 * math.pi * i / n_segments
        xy_loop.append((cx + rx * math.cos(angle), cy + ry * math.sin(angle), cz))
    segments.append(xy_loop)

    # 2. Meridian in XZ plane at y = cy
    xz_loop = []
    for i in range(n_segments + 1):
        angle = 2.0 * math.pi * i / n_segments
        xz_loop.append((cx + rx * math.cos(angle), cy, cz + rz * math.sin(angle)))
    segments.append(xz_loop)

    # 3. Meridian in YZ plane at x = cx
    yz_loop = []
    for i in range(n_segments + 1):
        angle = 2.0 * math.pi * i / n_segments
        yz_loop.append((cx, cy + ry * math.cos(angle), cz + rz * math.sin(angle)))
    segments.append(yz_loop)

    # 4. Upper and lower parallel latitude rings at z = cz +/- 0.5 * rz
    for sign in (-0.5, 0.5):
        lat_z = cz + sign * rz
        scale = math.sqrt(max(0.0, 1.0 - sign * sign))
        lat_loop = []
        for i in range(n_segments + 1):
            angle = 2.0 * math.pi * i / n_segments
            lat_loop.append((cx + rx * scale * math.cos(angle), cy + ry * scale * math.sin(angle), lat_z))
        segments.append(lat_loop)

    return segments


def compute_release_dispersion(
    pitches: list[dict[str, Any]],
    k_sigma: float = 1.0,
) -> dict[str, Any]:
    """Compute 3D release point covariance, standard deviations, and dispersion ellipsoid."""
    n = len(pitches)
    if n < 2:
        return {
            "count": n,
            "mean_x": 0.0,
            "mean_y": 0.0,
            "mean_z": 0.0,
            "std_x": 0.0,
            "std_y": 0.0,
            "std_z": 0.0,
            "cov_xy": 0.0,
            "cov_xz": 0.0,
            "cov_yz": 0.0,
            "volume_cu_ft": 0.0,
            "wireframe_segments": [],
        }

    sum_x = sum(p["x0"] for p in pitches)
    sum_y = sum(p["y0"] for p in pitches)
    sum_z = sum(p["z0"] for p in pitches)
    mx = sum_x / n
    my = sum_y / n
    mz = sum_z / n

    var_x = sum((p["x0"] - mx) ** 2 for p in pitches) / (n - 1)
    var_y = sum((p["y0"] - my) ** 2 for p in pitches) / (n - 1)
    var_z = sum((p["z0"] - mz) ** 2 for p in pitches) / (n - 1)
    std_x = math.sqrt(var_x)
    std_y = math.sqrt(var_y)
    std_z = math.sqrt(var_z)

    cov_xy = sum((p["x0"] - mx) * (p["y0"] - my) for p in pitches) / (n - 1)
    cov_xz = sum((p["x0"] - mx) * (p["z0"] - mz) for p in pitches) / (n - 1)
    cov_yz = sum((p["y0"] - my) * (p["z0"] - mz) for p in pitches) / (n - 1)

    radii = (k_sigma * std_x, k_sigma * std_y, k_sigma * std_z)
    volume = (4.0 / 3.0) * math.pi * radii[0] * radii[1] * radii[2]
    wireframe = generate_ellipsoid_wireframe((mx, my, mz), radii)

    return {
        "count": n,
        "mean_x": mx,
        "mean_y": my,
        "mean_z": mz,
        "std_x": std_x,
        "std_y": std_y,
        "std_z": std_z,
        "cov_xy": cov_xy,
        "cov_xz": cov_xz,
        "cov_yz": cov_yz,
        "volume_cu_ft": volume,
        "wireframe_segments": wireframe,
    }


def compute_fatigue_buckets(
    pitches: list[dict[str, Any]],
    bucket_size: int = 25,
) -> list[dict[str, Any]]:
    """Partition pitches into count buckets to quantify velocity drop and arm angle fatigue."""
    if not pitches or bucket_size <= 0:
        return []

    buckets: list[dict[str, Any]] = []
    base_speed: float | None = None
    base_z: float | None = None
    base_ext: float | None = None

    for i in range(0, len(pitches), bucket_size):
        chunk = pitches[i : i + bucket_size]
        count = len(chunk)
        if count == 0:
            continue

        avg_speed = sum(p["release_speed"] for p in chunk) / count
        avg_z = sum(p["z0"] for p in chunk) / count
        avg_x = sum(p["x0"] for p in chunk) / count
        avg_ext = sum(PITCHING_RUBBER_Y_FT - p["y0"] for p in chunk) / count

        swings = sum(p.get("is_swing", 0) for p in chunk)
        whiffs = sum(p.get("is_whiff", 0) for p in chunk)
        whiff_pct = (whiffs / swings * 100.0) if swings > 0 else 0.0

        if base_speed is None:
            base_speed = avg_speed
            base_z = avg_z
            base_ext = avg_ext

        delta_speed = avg_speed - base_speed
        delta_z_in = (avg_z - base_z) * 12.0
        delta_ext_in = (avg_ext - base_ext) * 12.0

        buckets.append({
            "bucket_index": len(buckets),
            "pitch_count_start": i + 1,
            "pitch_count_end": i + count,
            "pitch_count": count,
            "avg_release_speed": avg_speed,
            "avg_release_z": avg_z,
            "avg_release_x": avg_x,
            "avg_extension": avg_ext,
            "whiff_pct": whiff_pct,
            "delta_velocity_mph": delta_speed,
            "delta_release_z_inches": delta_z_in,
            "delta_extension_inches": delta_ext_in,
        })

    return buckets


def synth_pitch(
    rng: random.Random,
    game_id: int,
    game_day: date,
    i: int,
    ingestion_time: datetime | None = None,
) -> dict[str, Any]:
    """A plausible synthetic pitch in Statcast coordinate space.

    x: catcher's right (+), y: distance from plate, z: height above plate.
    Release ~ (-1.5..1.5 ft, 55 ft, 5.5 ft), typical MLB accelerations.
    """
    pt = rng.choice(PITCH_TYPES)
    speed = rng.uniform(72, 100)
    vy0 = -speed * 1.467 * rng.uniform(0.88, 0.97)  # mph -> ft/s, avg over flight
    flight = 55.0 / abs(vy0)
    ax = rng.uniform(-14, 14)  # horizontal break acceleration
    az = 32.174 + rng.uniform(-10, 25)  # gravity + lift
    whiff = rng.random() < 0.25
    return {
        "pitch_id": f"{game_id}-{i:04d}",
        "game_id": game_id,
        "game_date": game_day,
        "pitcher_id": rng.randint(110000, 699999),
        "batter_id": rng.randint(110000, 699999),
        "pitch_type": pt,
        "release_speed": speed,
        "release_spin_rate": rng.uniform(1400, 3200),
        "x0": rng.uniform(-1.8, 1.8),
        "y0": 55.0,
        "z0": rng.uniform(4.5, 6.5),
        "vx0": rng.uniform(-12, 12),
        "vy0": vy0,
        "vz0": rng.uniform(-8, 4),
        "ax": ax,
        "ay": 0.0,  # Statcast fits use constant ay=0 in the y polynomial
        "az": az,
        "plate_x": rng.uniform(-2.0, 2.0),
        "plate_z": rng.uniform(0.8, 3.8),
        "sz_top": 3.4,
        "sz_bot": 1.5,
        "is_swing": int(rng.random() < 0.47),
        "is_whiff": 0,
        "ingestion_time": ingestion_time or datetime.now(timezone.utc),
    }


def synth_day(
    rng: random.Random,
    game_day: date,
    n_pitches: int,
    *,
    ingestion_time: datetime | None = None,
) -> pa.Table:
    """One synthetic game day; whiffs only on swings, as in the real data.

    ingestion_time defaults to now per call; pass a fixed tz-aware datetime
    for byte-stable output (e.g. the serving /pitches/sample endpoint).
    """
    rows = []
    game_id = int(game_day.strftime("%Y%m%d")) * 100 + 1
    for i in range(n_pitches):
        p = synth_pitch(rng, game_id, game_day, i, ingestion_time=ingestion_time)
        if p["is_swing"]:
            p["is_whiff"] = int(rng.random() < 0.25)
        rows.append(p)
    return pa.Table.from_pylist(rows, schema=SCHEMA)


def rows_to_record_batches(rows: Iterable[dict[str, Any]], chunk_size: int = 5000):
    """Chunk rows for BigQuery load jobs (TDD §3.2: 5,000/chunk)."""
    chunk: list[dict[str, Any]] = []
    for row in rows:
        chunk.append(row)
        if len(chunk) >= chunk_size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def write_arrow(table: pa.Table, out_path: str) -> str:
    import os

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with pa.OSFile(out_path, "wb") as sink:
        with pa.ipc.new_file(sink, table.schema) as writer:
            writer.write_table(table)
    return out_path


def write_bq(
    rows: Iterable[dict[str, Any]],
    project: str,
    table: str,
    *,
    client: Any = None,
    resumable: bool = False,
) -> int:
    """Live path: BigQuery batch load jobs (WRITE_APPEND), one per 5,000-row chunk.

    Load jobs are free on the shared slot pool (unlike legacy
    `tabledata.insertAll` streaming, which is billed and never used here).
    Quota is 1,500 load jobs per table per day, far above one job per game day.
    `client` may be injected (tests, custom credentials); imported lazily so
    dry-run needs no GCP deps.
    """
    from google.cloud import bigquery

    if client is None:
        client = bigquery.Client(project=project)
    table_ref = f"{project}.statcast_analytics.{table}"
    job_config = bigquery.LoadJobConfig(
        write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
    )
    n = 0
    for chunk in rows_to_record_batches(rows):
        # load_table_from_json runs a bare json.dumps: normalize date/datetime
        # (and any other non-JSON scalar) to strings via str() (isoformat).
        json_rows = [json.loads(json.dumps(r, default=str)) for r in chunk]
        if resumable:
            # A lost HTTP response must not submit the same batch twice. A
            # known failed job is safe to retry under the next attempt ID.
            from google.api_core.exceptions import Conflict

            digest = hashlib.sha256(
                json.dumps([table_ref, json_rows], sort_keys=True).encode(),
            ).hexdigest()
            attempt = 0
            while True:
                job_id = f"statcast_backfill_{digest}_{attempt}"
                try:
                    job = client.load_table_from_json(
                        json_rows, table_ref, job_config=job_config, job_id=job_id,
                    )
                    break
                except Conflict:
                    job = client.get_job(job_id)
                    if job.done() and job.error_result:
                        attempt += 1
                        continue
                    break
            job.result()
        else:
            client.load_table_from_json(json_rows, table_ref, job_config=job_config).result()
        n += len(chunk)
    return n


def _live_day(game_day: date, project: str) -> int:
    """One day of the live path: fetch -> write. Returns rows written."""
    from ingestion.mlb_client import fetch_game_day

    default_ts = datetime.combine(game_day, datetime.min.time(), tzinfo=timezone.utc).isoformat()

    def _with_ts(records):
        for r in records:
            if not r.get("ingestion_time"):
                r["ingestion_time"] = default_ts
            yield r

    rows = _with_ts(fetch_game_day(game_day))
    return write_bq(rows, project, "bronze_pitches")


def _day_query_config(game_day: date):
    from google.cloud import bigquery

    return bigquery.QueryJobConfig(
        query_parameters=[bigquery.ScalarQueryParameter("target_date", "DATE", game_day)],
        maximum_bytes_billed=100 * 1024 * 1024,
    )


def _partition_pitch_counts(
    game_day: date, project: str, table: str, *, client: Any,
) -> dict[str, int]:
    """Read only one day's IDs, including duplicate counts for verification."""
    if table not in {"bronze_pitches", "fct_pitches"}:
        raise ValueError("unsupported pitch table")
    partition_filter = "game_date = @target_date"
    if table == "bronze_pitches":
        partition_filter += " AND DATE(ingestion_time) = @target_date"
    sql = (
        f"SELECT pitch_id, COUNT(*) AS row_count "
        f"FROM `{project}.statcast_analytics.{table}` "
        f"WHERE {partition_filter} GROUP BY pitch_id"
    )
    return {
        row["pitch_id"]: int(row["row_count"])
        for row in client.query(sql, job_config=_day_query_config(game_day)).result()
    }


def _curate_day(game_day: date, project: str, *, client: Any) -> None:
    """Execute the repository's partition-bounded, idempotent daily MERGE."""
    sql_path = Path(__file__).resolve().parents[1] / "warehouse/ddl/03_curate_day.sql"
    sql = sql_path.read_text().replace("`statcast_analytics.", f"`{project}.statcast_analytics.")
    client.query(sql, job_config=_day_query_config(game_day)).result()


def _backfill_day(game_day: date, project: str, *, client: Any) -> dict[str, Any]:
    """Reconcile source IDs with bronze before loading, then curate and verify.

    Fully consume the source before submitting any load jobs, so a truncated
    response cannot create a falsely completed date. On restart, missing IDs
    are loaded and completed chunks are left untouched. Run only one backfill
    per date at a time; this reconciliation is not a distributed lock.
    """
    from ingestion.mlb_client import fetch_game_day

    rows = list(fetch_game_day(game_day))
    source = {}
    for original in rows:
        row = dict(original)
        if str(row.get("game_date")) != game_day.isoformat() or not row.get("pitch_id"):
            raise ValueError("source rows require a pitch_id and the requested game_date")
        # Bronze is partitioned by ingestion_time; backfills use the game day.
        row["ingestion_time"] = datetime.combine(
            game_day, datetime.min.time(), tzinfo=timezone.utc,
        ).isoformat()
        pitch_id = row["pitch_id"]
        if pitch_id in source and source[pitch_id] != row:
            raise ValueError(f"conflicting source rows for pitch_id {pitch_id}")
        source[pitch_id] = row

    expected = set(source)
    before = _partition_pitch_counts(game_day, project, "bronze_pitches", client=client)
    if set(before) - expected:
        raise ValueError("bronze contains IDs absent from fetched source; refusing to append")
    missing = [source[pitch_id] for pitch_id in sorted(expected - set(before))]
    written = write_bq(
        missing, project, "bronze_pitches", client=client, resumable=True,
    ) if missing else 0
    bronze = _partition_pitch_counts(game_day, project, "bronze_pitches", client=client)
    if set(bronze) != expected:
        raise RuntimeError("bronze verification failed: pitch IDs differ from fetched source")
    if expected:
        _curate_day(game_day, project, client=client)
    curated = _partition_pitch_counts(game_day, project, "fct_pitches", client=client)
    if set(curated) != expected or any(count != 1 for count in curated.values()):
        raise RuntimeError("curated verification failed: missing, extra, or duplicate pitch IDs")
    return {
        "date": game_day.isoformat(),
        "status": "skipped" if before and not written else "ok",
        "source_rows": len(source),
        "written_rows": written,
        "bronze_rows": sum(bronze.values()),
        "bronze_duplicate_rows": sum(bronze.values()) - len(bronze),
        "curated_rows": len(curated),
    }


def run_backfill(
    start: date, end: date, project: str, *, manifest: str | Path | None = None,
    client: Any = None,
) -> int:
    """Resume each date from warehouse state; any failed date yields exit 1.

    Optional JSONL manifest records every attempt and is diagnostic only: the
    warehouse is always rechecked on rerun, including after interrupted writes.
    """
    from google.cloud import bigquery

    if not project or "`" in project:
        raise ValueError("an explicit valid project is required")
    if start > end:
        raise ValueError("backfill start must not be after end")
    if client is None:
        client = bigquery.Client(project=project)
    # Validate the report destination before doing any warehouse work.
    report = open(manifest, "a", encoding="utf-8") if manifest is not None else None
    ok, skipped, failures = 0, 0, []
    day = start
    try:
        while day <= end:
            try:
                result = _backfill_day(day, project, client=client)
                print(f"backfill {day.isoformat()}: {result['status']} ({result['source_rows']} pitches)")
                if result["status"] == "skipped":
                    skipped += 1
                else:
                    ok += 1
            except Exception as exc:  # noqa: BLE001 — continue with later dates
                error = f"{type(exc).__name__}: {exc}"
                print(f"backfill {day.isoformat()}: failed ({error})")
                failures.append((day, error))
                result = {"date": day.isoformat(), "status": "failed", "error": error}
            if report is not None:
                result.update(project=project, attempted_at=datetime.now(timezone.utc).isoformat())
                report.write(json.dumps(result) + "\n")
                report.flush()
            day += timedelta(days=1)
    finally:
        if report is not None:
            report.close()
    print(f"backfill summary: {ok} ok, {skipped} skipped, {len(failures)} failed")
    for day, summary in failures:
        print(f"  {day.isoformat()}: {summary}")
    return 1 if failures else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="synthetic day -> local Arrow file")
    ap.add_argument("--live", action="store_true", help="MLB API -> BigQuery load jobs")
    ap.add_argument("--date", default=None)
    ap.add_argument(
        "--backfill",
        nargs=2,
        metavar=("START", "END"),
        help="live multi-day backfill, inclusive (requires --live)",
    )
    ap.add_argument("--pitches", type=int, default=300)
    ap.add_argument("--out", default="data/sample.arrow")
    ap.add_argument("--project", default=None, help="GCP project (live mode)")
    ap.add_argument("--manifest", help="append backfill results to this JSONL file")
    args = ap.parse_args(argv)

    if args.manifest and not args.backfill:
        ap.error("--manifest requires --backfill")

    if args.backfill:
        if args.date is not None:
            ap.error("--backfill is mutually exclusive with --date")
        if not args.live:
            ap.error("--backfill requires --live")
        if args.dry_run:
            ap.error("--backfill requires --live (not compatible with --dry-run)")
        if not args.project:
            print(
                "error: --live requires --project (GCP project id, e.g. --project my-gcp-proj)",
                file=sys.stderr,
            )
            return 2
        try:
            start, end = (date.fromisoformat(s) for s in args.backfill)
        except ValueError:
            ap.error(
                f"invalid --backfill {args.backfill!r}: expected START END as YYYY-MM-DD"
            )
        if start > end:
            ap.error(f"--backfill START {start} is after END {end}")
        return run_backfill(start, end, args.project, manifest=args.manifest)

    if not args.project:
        args.project = os.environ.get("GCP_PROJECT")

    if args.date is None or args.date == "$(JOB_DATE)":
        args.date = os.environ.get("JOB_DATE") or str(date.today() - timedelta(days=1))
    elif args.date.startswith("$"):
        var_name = args.date.strip("$() ")
        args.date = os.environ.get(var_name) or str(date.today() - timedelta(days=1))

    try:
        game_day = date.fromisoformat(args.date)
    except ValueError:
        ap.error(f"invalid --date {args.date!r}: expected YYYY-MM-DD")
    if args.live and not args.project:
        print(
            "error: --live requires --project (GCP project id, e.g. --project my-gcp-proj)",
            file=sys.stderr,
        )
        return 2
    if args.dry_run or not args.live:
        rng = random.Random(2026)
        table = synth_day(rng, game_day, args.pitches)
        path = write_arrow(table, args.out)
        print(f"wrote {table.num_rows} pitches -> {path}")
        return 0
    if not args.project:
        ap.error("--live requires --project")
    n = _live_day(game_day, args.project)
    print(f"wrote {n} pitches -> {args.project}.statcast_analytics.bronze_pitches")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
