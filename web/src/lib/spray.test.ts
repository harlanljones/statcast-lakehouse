import { describe, expect, it } from "vitest";
import {
  HIT_CHART_PLATE_X,
  HIT_CHART_PLATE_Y,
  sprayColor,
  sprayDirection,
  sprayPoint,
} from "./spray";

describe("sprayPoint", () => {
  it("puts a ball hit straight up the middle straight out from the plate", () => {
    const p = sprayPoint(HIT_CHART_PLATE_X, HIT_CHART_PLATE_Y - 80, 400)!;
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(-400, 6);
  });

  it("sends right-field balls to positive x and left-field balls to negative x", () => {
    // Fielder codes from the corpus put left field at a low chart x and right field at a high one.
    const right = sprayPoint(200, 150, 350)!;
    const left = sprayPoint(50, 150, 350)!;
    expect(right.x).toBeGreaterThan(0);
    expect(left.x).toBeLessThan(0);
    expect(Math.hypot(right.x, right.y)).toBeCloseTo(350, 6);
  });

  it("keeps the measured distance, not the chart's radius, as the landing distance", () => {
    const far = sprayPoint(200, 100, 420)!;
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(420, 6);
  });

  it("is null when the ball has no chart coordinates or no measured distance", () => {
    expect(sprayPoint(undefined, 150, 380)).toBeNull();
    expect(sprayPoint(180, undefined, 380)).toBeNull();
    expect(sprayPoint(180, 150, undefined)).toBeNull();
    expect(sprayPoint(180, 150, 0)).toBeNull();
  });

  it("is null for a chart point sitting exactly on the plate anchor", () => {
    expect(sprayPoint(HIT_CHART_PLATE_X, HIT_CHART_PLATE_Y, 100)).toBeNull();
  });
});

describe("sprayColor", () => {
  it("separates the batted-ball classes the card reports", () => {
    const ground = sprayColor("ground_ball");
    const line = sprayColor("line_drive");
    const fly = sprayColor("fly_ball");
    expect(new Set([ground.join(), line.join(), fly.join()]).size).toBe(3);
  });

  it("gives bunts and unknown classes a shared neutral colour", () => {
    expect(sprayColor("bunt_popup")).toEqual(sprayColor("bunt_grounder"));
    expect(sprayColor(undefined)).toEqual(sprayColor("never_seen"));
  });
});

describe("sprayDirection", () => {
  const at = (dx: number, dy: number) =>
    sprayDirection(HIT_CHART_PLATE_X + dx, HIT_CHART_PLATE_Y - dy);

  it("names the five field sectors from the grounded chart orientation", () => {
    expect(at(0, 200)).toBe("centre field");
    expect(at(20, 200)).toBe("centre field"); // ~5.7 degrees
    expect(at(70, 200)).toBe("right-centre"); // ~19 degrees
    expect(at(140, 200)).toBe("right field"); // ~35 degrees
    expect(at(-70, 200)).toBe("left-centre");
    expect(at(-140, 200)).toBe("left field");
  });

  it("is null without both chart coordinates, and for a point on the anchor", () => {
    expect(sprayDirection(undefined, 150)).toBeNull();
    expect(sprayDirection(180, undefined)).toBeNull();
    expect(sprayDirection(HIT_CHART_PLATE_X, HIT_CHART_PLATE_Y)).toBeNull();
  });

  it("has no direction for a ball recorded behind the plate", () => {
    expect(at(20, -30)).toBeNull();
    expect(at(0, -5)).toBeNull();
  });
});
