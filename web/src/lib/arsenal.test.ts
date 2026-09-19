import { describe, expect, it } from "vitest";
import {
  computeArsenalCentroids,
  computePitchPairMetrics,
  tunnelingEnvelopeSegments,
} from "./arsenal";
import type { PitchDatum } from "./deck-layers";

function createPitch(overrides: Partial<PitchDatum> = {}): PitchDatum {
  return {
    path: new Float32Array([0, 55, 6, 0, 1.417, 2.5]),
    releaseSpeed: 95.0,
    pfxX: 0,
    pfxZ: 2.5,
    plateX: 0,
    plateZ: 2.5,
    pitchType: "FF",
    kinematics: {
      x0: -1.6, y0: 55.0, z0: 6.0,
      vx0: 2.0, vy0: -135.0, vz0: -5.0,
      ax: 5.0, ay: 0.0, az: 15.0,
    },
    ...overrides,
  };
}

describe("arsenal clustering and pitch-pair tunneling", () => {
  it("computes centroids grouped by pitch type", () => {
    const pitches: PitchDatum[] = [
      createPitch({
        pitchType: "FF",
        releaseSpeed: 96.0,
        spinRate: 2400,
        kinematics: {
          x0: -1.5, y0: 55.0, z0: 6.0,
          vx0: 2.0, vy0: -135.0, vz0: -5.0,
          ax: 5.0, ay: 0.0, az: 15.0,
        },
      }),
      createPitch({
        pitchType: "FF",
        releaseSpeed: 94.0,
        spinRate: 2300,
        kinematics: {
          x0: -1.7, y0: 55.0, z0: 5.8,
          vx0: 2.2, vy0: -133.0, vz0: -4.8,
          ax: 5.2, ay: 0.0, az: 15.2,
        },
      }),
      createPitch({
        pitchType: "SL",
        releaseSpeed: 85.0,
        spinRate: 2600,
        kinematics: {
          x0: -1.6, y0: 55.0, z0: 5.9,
          vx0: 3.0, vy0: -120.0, vz0: -3.0,
          ax: -8.0, ay: 0.0, az: -20.0,
        },
      }),
    ];

    const centroids = computeArsenalCentroids(pitches);
    expect(centroids.size).toBe(2);
    expect(centroids.has("FF")).toBe(true);
    expect(centroids.has("SL")).toBe(true);

    const ff = centroids.get("FF")!;
    expect(ff.count).toBe(2);
    expect(ff.releaseSpeed).toBeCloseTo(95.0, 5);
    expect(ff.releaseSpinRate).toBeCloseTo(2350.0, 5);
    expect(ff.kinematics.x0).toBeCloseTo(-1.6, 5);
    expect(ff.commitmentPoint[1]).toBeCloseTo(23.8, 5);
  });

  it("computes pairwise tunneling and deception divergence metrics", () => {
    const ff = createPitch({
      pitchType: "FF",
      releaseSpeed: 95.0,
      kinematics: {
        x0: -1.6, y0: 55.0, z0: 5.9,
        vx0: 2.0, vy0: -135.0, vz0: -5.0,
        ax: 5.0, ay: 0.0, az: 15.0,
      },
    });
    const sl = createPitch({
      pitchType: "SL",
      releaseSpeed: 85.0,
      kinematics: {
        x0: -1.6, y0: 55.0, z0: 5.9,
        vx0: 2.1, vy0: -120.0, vz0: -4.0,
        ax: -8.0, ay: 0.0, az: -20.0,
      },
    });

    const centroids = computeArsenalCentroids([ff, sl]);
    const metrics = computePitchPairMetrics(centroids.get("FF")!, centroids.get("SL")!);

    expect(metrics.typeA).toBe("FF");
    expect(metrics.typeB).toBe("SL");
    expect(metrics.releaseSeparationInches).toBeCloseTo(0.0, 4);
    expect(metrics.velocityDeltaMph).toBeCloseTo(10.0, 4);
    expect(metrics.tunnelingSeparationInches).toBeGreaterThan(0);
    expect(metrics.plateDivergenceInches).toBeGreaterThan(metrics.tunnelingSeparationInches);
    expect(metrics.tunnelRatio).toBeGreaterThan(1.0);
  });

  it("generates 3D tunneling envelope bridges", () => {
    const ff = createPitch({ pitchType: "FF" });
    const sl = createPitch({ pitchType: "SL", releaseSpeed: 85 });
    const centroids = computeArsenalCentroids([ff, sl]);
    const segs = tunnelingEnvelopeSegments(centroids.get("FF")!, centroids.get("SL")!);

    expect(segs).toHaveLength(3);
    // Release bridge connects release points
    expect(segs[0]).toHaveLength(2);
    expect(segs[0][0][1]).toBeCloseTo(55.0, 5);
    // Commitment bridge connects at y = 23.8 ft
    expect(segs[1]).toHaveLength(2);
    expect(segs[1][0][1]).toBeCloseTo(23.8, 5);
    expect(segs[1][1][1]).toBeCloseTo(23.8, 5);
    // Plate bridge connects at y = 1.417 ft
    expect(segs[2]).toHaveLength(2);
    expect(segs[2][0][1]).toBeCloseTo(1.417, 4);
    expect(segs[2][1][1]).toBeCloseTo(1.417, 4);
  });
});
