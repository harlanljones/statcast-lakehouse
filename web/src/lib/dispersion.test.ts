import { describe, it, expect } from "vitest";
import {
  computeReleaseDispersion,
  computeFatigueBuckets,
  generateEllipsoidWireframe,
} from "./dispersion";
import type { PitchDatum } from "./deck-layers";

function dummyPitch(overrides: Partial<PitchDatum> = {}): PitchDatum {
  return {
    path: new Float32Array([0, 55, 5, 0.5, 20, 4, 0, 1.417, 2.5]),
    releaseSpeed: 94.5,
    pfxX: 0,
    pfxZ: 2.5,
    plateX: 0,
    plateZ: 2.5,
    pitchType: "FF",
    ...overrides,
  };
}

describe("Release Point Dispersion & Pitcher Fatigue (Sprint 11)", () => {
  it("computes 3D release point covariance and wireframe ellipsoid", () => {
    const pitches: PitchDatum[] = [
      dummyPitch({ kinematics: { x0: -1.5, y0: 55.0, z0: 5.5, vx0: 0, vy0: -130, vz0: 0, ax: 0, ay: 0, az: 0 } }),
      dummyPitch({ kinematics: { x0: -1.3, y0: 55.2, z0: 5.6, vx0: 0, vy0: -130, vz0: 0, ax: 0, ay: 0, az: 0 } }),
      dummyPitch({ kinematics: { x0: -1.7, y0: 54.8, z0: 5.4, vx0: 0, vy0: -130, vz0: 0, ax: 0, ay: 0, az: 0 } }),
      dummyPitch({ kinematics: { x0: -1.5, y0: 55.0, z0: 5.5, vx0: 0, vy0: -130, vz0: 0, ax: 0, ay: 0, az: 0 } }),
    ];

    const res = computeReleaseDispersion(pitches, 1.0);
    expect(res.count).toBe(4);
    expect(res.meanX).toBeCloseTo(-1.5, 4);
    expect(res.meanY).toBeCloseTo(55.0, 4);
    expect(res.meanZ).toBeCloseTo(5.5, 4);
    expect(res.stdX).toBeGreaterThan(0);
    expect(res.stdY).toBeGreaterThan(0);
    expect(res.stdZ).toBeGreaterThan(0);
    expect(res.volumeCuFt).toBeGreaterThan(0);

    // 5 closed loops
    expect(res.wireframeSegments.length).toBe(5);
    for (const seg of res.wireframeSegments) {
      expect(seg.length).toBe(25);
      // Closed loop: start == end
      expect(seg[0][0]).toBeCloseTo(seg[24][0], 4);
      expect(seg[0][1]).toBeCloseTo(seg[24][1], 4);
      expect(seg[0][2]).toBeCloseTo(seg[24][2], 4);
    }
  });

  it("handles empty or insufficient pitches safely", () => {
    const res = computeReleaseDispersion([]);
    expect(res.count).toBe(0);
    expect(res.volumeCuFt).toBe(0);
    expect(res.wireframeSegments).toEqual([]);
  });

  it("generates empty wireframe when radii are non-positive", () => {
    const segs = generateEllipsoidWireframe([0, 0, 0], [0, 1, 1]);
    expect(segs).toEqual([]);
  });

  it("computes fatigue degradation buckets across pitch count", () => {
    const early = Array.from({ length: 25 }, () =>
      dummyPitch({
        releaseSpeed: 95.0,
        kinematics: { x0: -1.5, y0: 54.5, z0: 6.0, vx0: 0, vy0: -130, vz0: 0, ax: 0, ay: 0, az: 0 },
        isSwing: 1,
        isWhiff: 1,
      })
    );
    const late = Array.from({ length: 25 }, () =>
      dummyPitch({
        releaseSpeed: 92.0,
        kinematics: { x0: -1.4, y0: 54.7, z0: 5.7, vx0: 0, vy0: -130, vz0: 0, ax: 0, ay: 0, az: 0 },
        isSwing: 1,
        isWhiff: 0,
      })
    );

    const buckets = computeFatigueBuckets([...early, ...late], 25);
    expect(buckets.length).toBe(2);

    // Bucket 0 (baseline)
    const b0 = buckets[0];
    expect(b0.pitchCount).toBe(25);
    expect(b0.avgReleaseSpeed).toBeCloseTo(95.0, 4);
    expect(b0.deltaVelocityMph).toBeCloseTo(0.0, 4);
    expect(b0.deltaReleaseZInches).toBeCloseTo(0.0, 4);
    expect(b0.whiffPct).toBeCloseTo(100.0, 4);

    // Bucket 1 (degradation)
    const b1 = buckets[1];
    expect(b1.pitchCount).toBe(25);
    expect(b1.avgReleaseSpeed).toBeCloseTo(92.0, 4);
    expect(b1.deltaVelocityMph).toBeCloseTo(-3.0, 4);
    // z drop: 6.0 -> 5.7 ft = -0.3 ft = -3.6 inches
    expect(b1.deltaReleaseZInches).toBeCloseTo(-3.6, 3);
    expect(b1.whiffPct).toBeCloseTo(0.0, 4);
  });
});
