import { describe, it, expect } from "vitest";
import {
  classifyContactQuality,
  computeCollision,
  projectBattedTrajectory,
  projectBattedTrajectoryFlat,
} from "./collision";
import type { PitchKinematics } from "./kinematics";

describe("Collision & Contact Quality Simulation", () => {
  const PITCH: PitchKinematics = {
    x0: -2.0,
    y0: 50.0,
    z0: 5.8,
    vx0: 5.0,
    vy0: -130.0,
    vz0: -4.0,
    ax: -12.0,
    ay: 26.0,
    az: -18.0,
  };

  it("classifies contact quality accurately across exit speeds and launch angles", () => {
    // Whiff
    expect(classifyContactQuality(0.0, 0.0)).toBe("Whiff");
    // Barrel: high exit speed, optimal launch angle
    expect(classifyContactQuality(105.0, 25.0)).toBe("Barrel");
    expect(classifyContactQuality(99.0, 27.0)).toBe("Barrel");
    // Solid Contact
    expect(classifyContactQuality(92.0, 20.0)).toBe("Solid Contact");
    // Flare / Burner
    expect(classifyContactQuality(85.0, 15.0)).toBe("Flare/Burner");
    // Under (Pop up)
    expect(classifyContactQuality(85.0, 45.0)).toBe("Under");
    // Topped (Grounder)
    expect(classifyContactQuality(85.0, -10.0)).toBe("Topped");
    // Weak
    expect(classifyContactQuality(65.0, 15.0)).toBe("Weak");
  });

  it("computes flush sweet spot collision correctly (line drive)", () => {
    const col = computeCollision(PITCH, 75.0, 12.0, 0.0, 0.0);
    // 92 mph pitch + 75 mph bat -> exit speed > 105 mph
    expect(col.exitSpeedMph).toBeGreaterThan(105.0);
    expect(col.launchAngleDeg).toBeCloseTo(12.0, 4);
    expect(col.sprayAngleDeg).toBeCloseTo(0.0, 4);
    expect(["Barrel", "Solid Contact"]).toContain(col.contactQuality);
    expect(col.distanceFt).toBeGreaterThan(250.0);
    expect(col.hangTimeS).toBeGreaterThan(1.8);
  });

  it("computes barrel fly ball collision with distance exceeding 370 ft", () => {
    const col = computeCollision(PITCH, 75.0, 26.0, 0.0, 0.0);
    expect(col.contactQuality).toBe("Barrel");
    expect(col.distanceFt).toBeGreaterThan(370.0);
    expect(col.hangTimeS).toBeGreaterThan(4.0);
  });

  it("classifies collision as Whiff when impact offset exceeds bat radius", () => {
    const col = computeCollision(PITCH, 75.0, 10.0, 3.0, 0.0);
    expect(col.contactQuality).toBe("Whiff");
    expect(col.exitSpeedMph).toBe(0.0);
    expect(col.distanceFt).toBe(0.0);
    expect(col.hangTimeS).toBe(0.0);
  });

  it("projects 3D flight path of batted trajectory", () => {
    const origin: [number, number, number] = [0.0, 1.417, 2.5];
    const pts = projectBattedTrajectory(origin, 100.0, 25.0, 0.0, 4.0, 30);
    expect(pts.length).toBe(30);
    expect(pts[0][0]).toBeCloseTo(0.0, 4);
    expect(pts[0][1]).toBeCloseTo(1.417, 4);
    expect(pts[0][2]).toBeCloseTo(2.5, 4);
    // Path moves forward into field (increasing y)
    expect(pts[29][1]).toBeGreaterThan(pts[0][1]);
    // Trajectory lands near ground level (z >= 0)
    expect(pts[29][2]).toBeGreaterThanOrEqual(0.0);

    const flat = projectBattedTrajectoryFlat(origin, 100.0, 25.0, 0.0, 4.0, 30);
    expect(flat.length).toBe(30 * 3);
    expect(flat[0]).toBeCloseTo(0.0, 4);
    expect(flat[1]).toBeCloseTo(1.417, 4);
    expect(flat[2]).toBeCloseTo(2.5, 4);
  });
});
