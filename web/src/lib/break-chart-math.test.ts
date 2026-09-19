import { describe, expect, it } from "vitest";
import {
  breakToSvgCoords,
  breakGridTicks,
  DEFAULT_BREAK_RANGE_INCHES,
} from "./break-chart-math";

describe("break-chart-math", () => {
  it("maps (0, 0) origin to exact center of plot area", () => {
    const width = 200;
    const height = 200;
    const padding = 20;
    const coord = breakToSvgCoords(0, 0, width, height, 25, padding);
    expect(coord.x).toBeCloseTo(100, 6);
    expect(coord.y).toBeCloseTo(100, 6);
  });

  it("maps top-left quadrant (+IVB, -HB: ride and glove-side)", () => {
    const width = 240;
    const height = 240;
    const padding = 20;
    const coord = breakToSvgCoords(-25, 25, width, height, 25, padding);
    expect(coord.x).toBeCloseTo(20, 6); // left
    expect(coord.y).toBeCloseTo(20, 6); // top
  });

  it("maps bottom-right quadrant (-IVB, +HB: sink and arm-side)", () => {
    const width = 240;
    const height = 240;
    const padding = 20;
    const coord = breakToSvgCoords(25, -25, width, height, 25, padding);
    expect(coord.x).toBeCloseTo(220, 6); // right (240 - 20)
    expect(coord.y).toBeCloseTo(220, 6); // bottom (240 - 20)
  });

  it("clamps break values beyond the range to the boundary", () => {
    const width = 200;
    const height = 200;
    const padding = 20;
    const coord = breakToSvgCoords(40, -50, width, height, 25, padding);
    expect(coord.x).toBeCloseTo(180, 6);
    expect(coord.y).toBeCloseTo(180, 6);
  });

  it("generates grid ticks at step intervals", () => {
    const ticks = breakGridTicks(25, 10);
    expect(ticks).toEqual([-20, -10, 0, 10, 20]);
  });

  it("defaults to 25 inches range", () => {
    expect(DEFAULT_BREAK_RANGE_INCHES).toBe(25);
  });
});
