import { describe, it, expect } from "vitest";
import {
  computeReleaseDispersion,
  computeFatigueBuckets,
  fatiguePitcher,
  pitcherPitchesInOrder,
  distinctPitcherCount,
  fatigueNote,
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

  it("averages extension only over pitches that report it, null when none do", () => {
    const none = computeFatigueBuckets([dummyPitch(), dummyPitch()], 25);
    expect(none[0].avgExtension).toBeNull();
    expect(none[0].deltaExtensionInches).toBeNull();

    const some = computeFatigueBuckets(
      [dummyPitch({ extension: 6.0 }), dummyPitch(), dummyPitch({ extension: 6.4 })],
      2,
    );
    // Bucket 0: pitches 1-2, only the first reports extension; bucket 1: the 6.4 pitch.
    expect(some[0].avgExtension).toBeCloseTo(6.0, 9);
    expect(some[1].avgExtension).toBeCloseTo(6.4, 9);
    expect(some[1].deltaExtensionInches).toBeCloseTo(4.8, 6); // (6.4 - 6.0) * 12
    // No 60.5 - y0 fallback: y0 is the 50 ft measurement plane, not the hand.
  });
});

describe("fatigue is per pitcher", () => {
  const mk = (pitcherId: number | undefined, speed: number, extra: Partial<PitchDatum> = {}) =>
    dummyPitch({ pitcherId, releaseSpeed: speed, ...extra });

  it("fatiguePitcher: pinned wins, else the majority pitcher, else undefined", () => {
    const pitches = [mk(1, 90), mk(2, 90), mk(2, 90), mk(2, 90), mk(3, 90)];
    expect(fatiguePitcher(pitches)).toBe(2);
    expect(fatiguePitcher(pitches, 3)).toBe(3);
    expect(fatiguePitcher(pitches, null)).toBe(2);
    expect(fatiguePitcher([mk(undefined, 90)])).toBeUndefined();
    expect(fatiguePitcher([])).toBeUndefined();
    // Ties break to the lower id, deterministically.
    expect(fatiguePitcher([mk(9, 90), mk(4, 90)])).toBe(4);
    expect(distinctPitcherCount(pitches)).toBe(3);
  });

  it("never pools pitchers: buckets cover only the chosen pitcher's pitches", () => {
    const pitches = [mk(1, 80), mk(2, 95), mk(2, 93), mk(1, 80), mk(2, 91)];
    const b = computeFatigueBuckets(pitches, 25);
    expect(b).toHaveLength(1);
    expect(b[0].pitchCount).toBe(3); // pitcher 2 is the majority
    expect(b[0].avgReleaseSpeed).toBeCloseTo(93, 9);
    const other = computeFatigueBuckets(pitches, 25, 1);
    expect(other[0].pitchCount).toBe(2);
    expect(other[0].avgReleaseSpeed).toBeCloseTo(80, 9);
  });

  it("orders by (atBatNumber, pitchNumber) when present, else keeps the given order", () => {
    const pitches = [
      mk(7, 90, { atBatNumber: 2, pitchNumber: 1 }),
      mk(7, 96, { atBatNumber: 1, pitchNumber: 2 }),
      mk(7, 94, { atBatNumber: 1, pitchNumber: 1 }),
    ];
    expect(pitcherPitchesInOrder(pitches, 7).map((p) => p.releaseSpeed)).toEqual([94, 96, 90]);
    // A bucket size of 1 exposes the order in the deltas: 94 -> 96 -> 90.
    expect(computeFatigueBuckets(pitches, 1).map((x) => x.avgReleaseSpeed)).toEqual([94, 96, 90]);
    // One pitch missing the fields: the loaded order is kept.
    const partial = [mk(7, 90, { atBatNumber: 2, pitchNumber: 1 }), mk(7, 96)];
    expect(pitcherPitchesInOrder(partial, 7).map((p) => p.releaseSpeed)).toEqual([90, 96]);
  });
});

describe("fatigueNote", () => {
  it("only speaks up when several pitchers are visible", () => {
    expect(fatigueNote("Blake Snell", 1)).toBeNull();
    expect(fatigueNote("Blake Snell", 0)).toBeNull();
    expect(fatigueNote("Blake Snell", undefined)).toBeNull();
    expect(fatigueNote("Blake Snell", 3)).toBe("Showing Blake Snell (1 of 3 pitchers); pin a pitch to choose");
  });
});
