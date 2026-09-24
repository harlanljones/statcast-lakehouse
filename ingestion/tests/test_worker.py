"""Tests for the kinematics solver and dry-run ingestion path.

Run: python -m pytest ingestion/tests -q
"""
import math

import pyarrow as pa
import pytest

from ingestion.scenarios import real_pitches
from ingestion.worker import (
    SCHEMA,
    PLATE_Y_FT,
    GRAVITY_FT_S2,
    position_at,
    rows_to_record_batches,
    solve_flight_time,
    trajectory,
    ghost_kinematics,
    ghost_trajectory,
    compute_break_vector,
    break_vector_segment,
    PITCHING_RUBBER_Y_FT,
    release_extension,
    COMMITMENT_PLANE_Y_FT,
    solve_commitment_time,
    commitment_position,
    tunneling_distance,
    compute_arsenal_centroids,
    compute_pitch_pair_metrics,
    classify_contact_quality,
    compute_collision,
    project_batted_trajectory,
    generate_ellipsoid_wireframe,
    compute_release_dispersion,
    compute_fatigue_buckets,
    write_arrow,
)



class TestFlightTime:
    def test_reaches_plate(self):
        # 95 mph-ish: vy0 = -130 ft/s, no drag, ay = 0 -> t = (55-1.417)/130
        t = solve_flight_time(55.0, -130.0, 0.0)
        assert math.isclose(t, (55.0 - PLATE_Y_FT) / 130.0, rel_tol=1e-9)

    def test_with_acceleration(self):
        # y(t) = 55 - 130 t + 2 t^2 crossing 1.417
        t = solve_flight_time(55.0, -130.0, 4.0)
        y = 55.0 + (-130.0) * t + 0.5 * 4.0 * t * t
        assert math.isclose(y, PLATE_Y_FT, rel_tol=1e-9)

    def test_never_reaches_plate(self):
        with pytest.raises(ValueError):
            solve_flight_time(10.0, 5.0, 0.0)  # moving away

    def test_root_in_future(self):
        with pytest.raises(ValueError):
            solve_flight_time(1.0, 0.0, 0.0)  # already at plate, v=0


class TestTrajectory:
    def test_60_points_ending_at_plate(self):
        pitch = {"x0": 0.0, "y0": 55.0, "z0": 6.0,
                 "vx0": 0.0, "vy0": -130.0, "vz0": -10.0,
                 "ax": 0.0, "ay": 0.0, "az": 0.0}
        path = trajectory(pitch, n=60)
        assert len(path) == 60
        assert math.isclose(path[0][1], 55.0, rel_tol=1e-9)
        assert math.isclose(path[-1][1], PLATE_Y_FT, rel_tol=1e-6)
        # constant acceleration: z monotone decreasing here
        assert path[-1][2] < path[0][2]


class TestGhostKinematicsAndBreak:
    SLIDER = {
        "x0": -1.5, "y0": 55.0, "z0": 5.8,
        "vx0": 3.5, "vy0": -125.0, "vz0": -3.0,
        "ax": -8.0, "ay": 20.0, "az": -22.0,
    }

    def test_ghost_kinematics_clears_lateral_and_sets_gravity(self):
        ghost = ghost_kinematics(self.SLIDER)
        assert ghost["ax"] == 0.0
        assert ghost["ay"] == self.SLIDER["ay"]
        assert ghost["az"] == -GRAVITY_FT_S2
        assert ghost["x0"] == self.SLIDER["x0"]
        assert ghost["y0"] == self.SLIDER["y0"]
        assert ghost["z0"] == self.SLIDER["z0"]

    def test_ghost_trajectory_matches_plate_time(self):
        t_actual = solve_flight_time(self.SLIDER["y0"], self.SLIDER["vy0"], self.SLIDER["ay"])
        ghost = ghost_kinematics(self.SLIDER)
        t_ghost = solve_flight_time(ghost["y0"], ghost["vy0"], ghost["ay"])
        assert math.isclose(t_actual, t_ghost, rel_tol=1e-9)

        actual_path = trajectory(self.SLIDER)
        ghost_path = ghost_trajectory(self.SLIDER)
        assert len(ghost_path) == 60
        assert math.isclose(ghost_path[0][1], 55.0, rel_tol=1e-9)
        assert math.isclose(ghost_path[-1][1], PLATE_Y_FT, rel_tol=1e-6)
        assert math.isclose(actual_path[-1][1], ghost_path[-1][1], rel_tol=1e-6)

    def test_compute_break_vector_matches_nathan_definition(self):
        t_end = solve_flight_time(self.SLIDER["y0"], self.SLIDER["vy0"], self.SLIDER["ay"])
        bv = compute_break_vector(self.SLIDER)

        expected_dx_in = 0.5 * self.SLIDER["ax"] * t_end * t_end * 12.0
        expected_dz_in = 0.5 * (self.SLIDER["az"] - (-GRAVITY_FT_S2)) * t_end * t_end * 12.0

        assert math.isclose(bv["h_break_inches"], expected_dx_in, rel_tol=1e-5)
        assert math.isclose(bv["v_break_inches"], expected_dz_in, rel_tol=1e-5)
        assert math.isclose(bv["total_break_inches"], math.hypot(expected_dx_in, expected_dz_in), rel_tol=1e-5)

    def test_break_vector_segment_matches_displacement(self):
        ghost_pt, actual_pt = break_vector_segment(self.SLIDER)
        assert math.isclose(ghost_pt[1], PLATE_Y_FT, rel_tol=1e-6)
        assert math.isclose(actual_pt[1], PLATE_Y_FT, rel_tol=1e-6)

        dx = actual_pt[0] - ghost_pt[0]
        dz = actual_pt[2] - ghost_pt[2]
        bv = compute_break_vector(self.SLIDER)
        assert math.isclose(dx * 12.0, bv["h_break_inches"], rel_tol=1e-5)
        assert math.isclose(dz * 12.0, bv["v_break_inches"], rel_tol=1e-5)

    def test_release_extension(self):
        assert math.isclose(PITCHING_RUBBER_Y_FT, 60.5, rel_tol=1e-6)
        assert math.isclose(release_extension(55.0), 5.5, rel_tol=1e-6)
        assert math.isclose(release_extension(54.2), 6.3, rel_tol=1e-6)
        assert math.isclose(release_extension(self.SLIDER["y0"]), 60.5 - self.SLIDER["y0"], rel_tol=1e-6)


class TestCommitmentPlaneAndTunneling:
    FASTBALL = {
        "x0": 0.0, "y0": 55.0, "z0": 6.0,
        "vx0": 0.0, "vy0": -130.0, "vz0": -10.0,
        "ax": 0.0, "ay": 0.0, "az": 0.0,
    }
    SLIDER = {
        "x0": -1.5, "y0": 55.0, "z0": 5.8,
        "vx0": 3.5, "vy0": -125.0, "vz0": -3.0,
        "ax": -8.0, "ay": 20.0, "az": -22.0,
    }

    def test_commitment_plane_constant(self):
        assert math.isclose(COMMITMENT_PLANE_Y_FT, 23.8, rel_tol=1e-6)

    def test_solve_commitment_time_zero_accel(self):
        t = solve_commitment_time(self.FASTBALL["y0"], self.FASTBALL["vy0"], self.FASTBALL["ay"])
        assert math.isclose(t, (55.0 - 23.8) / 130.0, rel_tol=1e-9)

    def test_solve_commitment_time_with_accel(self):
        t = solve_commitment_time(self.SLIDER["y0"], self.SLIDER["vy0"], self.SLIDER["ay"])
        y = self.SLIDER["y0"] + self.SLIDER["vy0"] * t + 0.5 * self.SLIDER["ay"] * t * t
        assert math.isclose(y, COMMITMENT_PLANE_Y_FT, rel_tol=1e-7)

    def test_commitment_position_y_is_commitment_plane(self):
        pos = commitment_position(self.SLIDER)
        assert math.isclose(pos[1], COMMITMENT_PLANE_Y_FT, rel_tol=1e-7)

    def test_tunneling_distance_identity_and_symmetry(self):
        assert math.isclose(tunneling_distance(self.FASTBALL, self.FASTBALL), 0.0, abs_tol=1e-9)
        d12 = tunneling_distance(self.FASTBALL, self.SLIDER)
        d21 = tunneling_distance(self.SLIDER, self.FASTBALL)
        assert math.isclose(d12, d21, rel_tol=1e-9)
        assert d12 > 0.0

    def test_rejects_pitches_not_reaching_commitment_plane(self):
        with pytest.raises(ValueError):
            solve_commitment_time(20.0, 5.0, 0.0)


class TestArsenalCentroidsAndPairMetrics:
    def test_compute_arsenal_centroids(self):
        pitches = [
            {
                "pitch_type": "FF", "release_speed": 96.0, "release_spin_rate": 2400.0,
                "x0": -1.5, "y0": 55.0, "z0": 6.0,
                "vx0": 2.0, "vy0": -135.0, "vz0": -5.0,
                "ax": 5.0, "ay": 0.0, "az": 15.0,
                "plate_x": 0.2, "plate_z": 3.0,
            },
            {
                "pitch_type": "FF", "release_speed": 94.0, "release_spin_rate": 2300.0,
                "x0": -1.7, "y0": 55.0, "z0": 5.8,
                "vx0": 2.2, "vy0": -133.0, "vz0": -4.8,
                "ax": 5.2, "ay": 0.0, "az": 15.2,
                "plate_x": 0.4, "plate_z": 2.8,
            },
            {
                "pitch_type": "SL", "release_speed": 85.0, "release_spin_rate": 2600.0,
                "x0": -1.6, "y0": 55.0, "z0": 5.9,
                "vx0": 3.0, "vy0": -120.0, "vz0": -3.0,
                "ax": -8.0, "ay": 0.0, "az": -20.0,
                "plate_x": -0.8, "plate_z": 1.5,
            },
        ]
        centroids = compute_arsenal_centroids(pitches)
        assert "FF" in centroids
        assert "SL" in centroids
        assert centroids["FF"]["count"] == 2
        assert centroids["SL"]["count"] == 1
        assert math.isclose(centroids["FF"]["release_speed"], 95.0, rel_tol=1e-6)
        assert math.isclose(centroids["FF"]["release_spin_rate"], 2350.0, rel_tol=1e-6)
        assert math.isclose(centroids["FF"]["kinematics"]["x0"], -1.6, rel_tol=1e-6)
        assert math.isclose(centroids["FF"]["commitment_point"][1], 23.8, rel_tol=1e-6)

    def test_compute_pitch_pair_metrics(self):
        pitches = [
            {
                "pitch_type": "FF", "release_speed": 95.0, "release_spin_rate": 2350.0,
                "x0": -1.6, "y0": 55.0, "z0": 5.9,
                "vx0": 2.0, "vy0": -135.0, "vz0": -5.0,
                "ax": 5.0, "ay": 0.0, "az": 15.0,
                "plate_x": 0.3, "plate_z": 2.9,
            },
            {
                "pitch_type": "SL", "release_speed": 85.0, "release_spin_rate": 2600.0,
                "x0": -1.6, "y0": 55.0, "z0": 5.9,
                "vx0": 2.1, "vy0": -120.0, "vz0": -4.0,
                "ax": -8.0, "ay": 0.0, "az": -20.0,
                "plate_x": -0.8, "plate_z": 1.5,
            },
        ]
        centroids = compute_arsenal_centroids(pitches)
        metrics = compute_pitch_pair_metrics(centroids["FF"], centroids["SL"])

        # Identical release point -> 0 release separation
        assert math.isclose(metrics["release_separation_inches"], 0.0, abs_tol=1e-5)
        # Velocity delta is 10 mph
        assert math.isclose(metrics["velocity_delta_mph"], 10.0, rel_tol=1e-6)
        # Tunnel separation at y = 23.8 ft should be smaller than plate divergence at y = 1.417 ft
        assert metrics["tunneling_separation_inches"] > 0
        assert metrics["plate_divergence_inches"] > metrics["tunneling_separation_inches"]
        # Tunnel ratio > 1
        assert metrics["tunnel_ratio"] > 1.0


class TestCollisionAndContactSimulation:
    PITCH = {
        "x0": 0.0, "y0": 55.0, "z0": 6.0,
        "vx0": 0.0, "vy0": -135.0, "vz0": -5.0,
        "ax": 0.0, "ay": 0.0, "az": 0.0,
    }

    def test_classify_contact_quality(self):
        # Whiff
        assert classify_contact_quality(0.0, 0.0) == "Whiff"
        # Barrel: high exit speed, optimal launch angle
        assert classify_contact_quality(105.0, 25.0) == "Barrel"
        assert classify_contact_quality(99.0, 27.0) == "Barrel"
        # Solid Contact
        assert classify_contact_quality(92.0, 20.0) == "Solid Contact"
        # Flare / Burner
        assert classify_contact_quality(85.0, 15.0) == "Flare/Burner"
        # Under (Pop up)
        assert classify_contact_quality(85.0, 45.0) == "Under"
        # Topped (Grounder)
        assert classify_contact_quality(85.0, -10.0) == "Topped"
        # Weak
        assert classify_contact_quality(65.0, 15.0) == "Weak"

    def test_compute_collision_flush_sweet_spot(self):
        col = compute_collision(self.PITCH, bat_speed=75.0, attack_angle_deg=12.0, offset_z_in=0.0, offset_x_in=0.0)
        # 92 mph pitch + 75 mph bat -> exit speed > 105 mph
        assert col["exit_speed_mph"] > 105.0
        assert math.isclose(col["launch_angle_deg"], 12.0, rel_tol=1e-5)
        assert math.isclose(col["spray_angle_deg"], 0.0, abs_tol=1e-5)
        assert col["contact_quality"] in ("Barrel", "Solid Contact")
        assert col["distance_ft"] > 250.0
        assert col["hang_time_s"] > 1.8

    def test_compute_collision_barrel_fly_ball(self):
        col = compute_collision(self.PITCH, bat_speed=75.0, attack_angle_deg=26.0, offset_z_in=0.0, offset_x_in=0.0)
        assert col["contact_quality"] == "Barrel"
        assert col["distance_ft"] > 370.0
        assert col["hang_time_s"] > 4.0

    def test_compute_collision_whiff_when_offset_exceeds_radius(self):
        col = compute_collision(self.PITCH, bat_speed=75.0, offset_z_in=3.0)
        assert col["contact_quality"] == "Whiff"
        assert col["exit_speed_mph"] == 0.0
        assert col["distance_ft"] == 0.0

    def test_project_batted_trajectory(self):
        pts = project_batted_trajectory((0.0, 1.417, 2.5), exit_speed_mph=100.0, launch_angle_deg=25.0, hang_time_s=4.0, n=30)
        assert len(pts) == 30
        # Origin matches start point
        assert math.isclose(pts[0][0], 0.0, abs_tol=1e-5)
        assert math.isclose(pts[0][1], 1.417, abs_tol=1e-5)
        assert math.isclose(pts[0][2], 2.5, abs_tol=1e-5)
        # Path arcs forward into positive y (outfield)
        assert pts[-1][1] > 200.0
        # Terminal point lands near ground
        assert pts[-1][2] >= 0.0


class TestReleaseDispersionAndFatigue:
    def test_compute_release_dispersion(self):
        pitches = [
            {"x0": -1.5, "y0": 55.0, "z0": 5.5},
            {"x0": -1.3, "y0": 55.2, "z0": 5.6},
            {"x0": -1.7, "y0": 54.8, "z0": 5.4},
            {"x0": -1.5, "y0": 55.0, "z0": 5.5},
        ]
        res = compute_release_dispersion(pitches, k_sigma=1.0)
        assert res["count"] == 4
        assert math.isclose(res["mean_x"], -1.5, rel_tol=1e-5)
        assert math.isclose(res["mean_y"], 55.0, rel_tol=1e-5)
        assert math.isclose(res["mean_z"], 5.5, rel_tol=1e-5)
        assert res["std_x"] > 0.0
        assert res["std_y"] > 0.0
        assert res["std_z"] > 0.0
        assert res["volume_cu_ft"] > 0.0
        # 5 loops: equator, 2 meridians, 2 latitude parallels
        assert len(res["wireframe_segments"]) == 5
        for seg in res["wireframe_segments"]:
            assert len(seg) == 25  # 24 segments + 1 closing point
            # Closed loop invariant: start == end
            assert math.isclose(seg[0][0], seg[-1][0], abs_tol=1e-5)
            assert math.isclose(seg[0][1], seg[-1][1], abs_tol=1e-5)
            assert math.isclose(seg[0][2], seg[-1][2], abs_tol=1e-5)

    def test_compute_release_dispersion_empty(self):
        res = compute_release_dispersion([])
        assert res["count"] == 0
        assert res["volume_cu_ft"] == 0.0
        assert res["wireframe_segments"] == []

    def test_compute_fatigue_buckets(self):
        early = [{"release_speed": 95.0, "x0": -1.5, "y0": 54.5, "z0": 6.0, "is_swing": 1, "is_whiff": 1} for _ in range(25)]
        late = [{"release_speed": 92.0, "x0": -1.4, "y0": 54.7, "z0": 5.7, "is_swing": 1, "is_whiff": 0} for _ in range(25)]
        buckets = compute_fatigue_buckets(early + late, bucket_size=25)

        assert len(buckets) == 2
        # Baseline bucket 0
        b0 = buckets[0]
        assert b0["pitch_count"] == 25
        assert math.isclose(b0["avg_release_speed"], 95.0)
        assert math.isclose(b0["delta_velocity_mph"], 0.0)
        assert math.isclose(b0["delta_release_z_inches"], 0.0)
        assert math.isclose(b0["whiff_pct"], 100.0)

        # Degraded bucket 1
        b1 = buckets[1]
        assert b1["pitch_count"] == 25
        assert math.isclose(b1["avg_release_speed"], 92.0)
        assert math.isclose(b1["delta_velocity_mph"], -3.0)
        # z drops from 6.0 to 5.7 ft = -0.3 ft = -3.6 inches
        assert math.isclose(b1["delta_release_z_inches"], -3.6, rel_tol=1e-4)
        assert math.isclose(b1["whiff_pct"], 0.0)


class TestWriteArrow:
    def test_arrow_write_roundtrip(self, tmp_path):
        table = real_pitches(limit=50)
        out = write_arrow(table, str(tmp_path / "sub" / "day.arrow"))
        with pa.memory_map(out) as src:
            back = pa.ipc.open_file(src).read_all()
        assert back.num_rows == 50
        assert back.schema.equals(SCHEMA)


class TestBatching:
    def test_chunks_of_5000(self):
        rows = [{"i": i} for i in range(11_001)]
        sizes = [len(c) for c in rows_to_record_batches(rows, chunk_size=5000)]
        assert sizes == [5000, 5000, 1001]

    def test_empty(self):
        assert list(rows_to_record_batches([])) == []
