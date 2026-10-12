import { describe, expect, it } from "vitest";
import type { PitchDatum } from "./deck-layers";
import { sprayProfile } from "./spray-profile";

const HX = 125;
const HY = 205;

/** A batted ball at a chart offset (dx, dy) with a measured distance. */
const ball = (over: Partial<PitchDatum>): PitchDatum => ({
  path: new Float32Array(3),
  releaseSpeed: 92,
  pfxX: 0,
  pfxZ: 0,
  plateX: 0,
  plateZ: 2.5,
  pitchType: "FF",
  ...over,
});

describe("sprayProfile", () => {
  const balls = [
    ball({ pitcherId: 1, hcX: HX, hcY: HY - 200, hitDistance: 400, launchSpeed: 100 }), // centre
    ball({ pitcherId: 1, hcX: HX - 140, hcY: HY - 200, hitDistance: 320, launchSpeed: 90 }), // left field
    ball({ pitcherId: 1, hcX: HX + 70, hcY: HY - 200, hitDistance: 360, launchSpeed: 96 }), // right-centre
    // another pitcher's contact must not leak in
    ball({ pitcherId: 2, hcX: HX + 140, hcY: HY - 200, hitDistance: 410, launchSpeed: 105 }),
    // behind the plate: no field direction
    ball({ pitcherId: 1, hcX: HX, hcY: HY + 20, hitDistance: 60 }),
    // chart coordinates but no measured distance
    ball({ pitcherId: 1, hcX: HX, hcY: HY - 100 }),
    // not in play at all
    ball({ pitcherId: 1 }),
  ];

  it("counts one pitcher's placeable contact per sector, in display order, keeping empties", () => {
    const profile = sprayProfile(balls, 1)!;
    expect(profile.total).toBe(3);
    expect(profile.unplaced).toBe(1);
    expect(profile.sectors.map((s) => s.sector)).toEqual([
      "left field",
      "left-centre",
      "centre field",
      "right-centre",
      "right field",
    ]);
    expect(profile.sectors.map((s) => s.count)).toEqual([1, 0, 1, 1, 0]);
    expect(profile.sectors.reduce((n, s) => n + s.share, 0)).toBeCloseTo(1);
    expect(profile.sectors[1].hardHitShare).toBeNull();
    expect(profile.sectors[0].avgDistance).toBeCloseTo(320);
  });

  it("reports the hard-hit share within each sector against the line it is given", () => {
    const profile = sprayProfile(balls, 1)!;
    // centre had one ball at 100 mph, right-centre one at 96
    const centre = profile.sectors.find((s) => s.sector === "centre field")!;
    const rightCentre = profile.sectors.find((s) => s.sector === "right-centre")!;
    expect(centre.hardHitShare).toBeCloseTo(1);
    expect(rightCentre.hardHitShare).toBeCloseTo(1);
    expect(profile.sectors.find((s) => s.sector === "left field")!.hardHitShare).toBeCloseTo(0);
  });

  it("merges every pitcher when no id is given, and is null with nothing to place", () => {
    expect(sprayProfile(balls)!.total).toBe(4);
    expect(sprayProfile(balls, 3)).toBeNull();
    expect(sprayProfile([ball({ pitcherId: 1, hitDistance: 380 })], 1)).toBeNull();
  });
});
