import { describe, it, expect } from "vitest";
import {
  computeStrikeZoneHeatmap,
  interpolateColor,
  DENSITY_COLOR_STOPS,
  WHIFF_COLOR_STOPS,
  HEATMAP_BOUNDS,
} from "./heatmap";
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

describe("Strike Zone Spatial Density & Heatmaps (Sprint 12)", () => {
  it("interpolates color gradients smoothly across stops", () => {
    const c0 = interpolateColor(0.0, DENSITY_COLOR_STOPS);
    expect(c0).toEqual(DENSITY_COLOR_STOPS[0].color);

    const c1 = interpolateColor(1.0, DENSITY_COLOR_STOPS);
    expect(c1).toEqual(DENSITY_COLOR_STOPS[DENSITY_COLOR_STOPS.length - 1].color);

    const mid = interpolateColor(0.5, DENSITY_COLOR_STOPS);
    expect(mid).toEqual(DENSITY_COLOR_STOPS[2].color);

    // Clamping works
    expect(interpolateColor(-0.5, DENSITY_COLOR_STOPS)).toEqual(c0);
    expect(interpolateColor(1.5, DENSITY_COLOR_STOPS)).toEqual(c1);
  });

  it("computes spatial density heatmap across 6x6 grid cells", () => {
    const pitches: PitchDatum[] = [
      dummyPitch({ plateX: 0.0, plateZ: 2.5 }),
      dummyPitch({ plateX: 0.0, plateZ: 2.5 }),
      dummyPitch({ plateX: -0.5, plateZ: 1.8 }),
      dummyPitch({ plateX: 5.0, plateZ: 10.0 }), // Out of bounds, ignored
    ];

    const cells = computeStrikeZoneHeatmap(pitches, "density", 6, 6);
    expect(cells.length).toBe(36);

    // Peak cell at (0.0, 2.5) should have 2 pitches and value 1.0
    const peakCell = cells.find((c) => c.pitchCount === 2);
    expect(peakCell).toBeDefined();
    expect(peakCell!.value).toBeCloseTo(1.0);
    expect(peakCell!.color[3]).toBeGreaterThan(200); // Higher alpha for peak

    // Each cell has a 4-point polygon at y = 1.417
    for (const c of cells) {
      expect(c.polygon.length).toBe(4);
      for (const pt of c.polygon) {
        expect(pt[1]).toBeCloseTo(1.417);
      }
    }
  });

  it("computes whiff rate heatmap accurately", () => {
    const pitches: PitchDatum[] = [
      dummyPitch({ plateX: 0.0, plateZ: 2.5, isSwing: 1, isWhiff: 1 }),
      dummyPitch({ plateX: 0.0, plateZ: 2.5, isSwing: 1, isWhiff: 0 }),
      dummyPitch({ plateX: 0.5, plateZ: 3.0, isSwing: 1, isWhiff: 1 }),
    ];

    const cells = computeStrikeZoneHeatmap(pitches, "whiff_rate", 6, 6);
    const cellA = cells.find((c) => c.xMin <= 0.0 && c.xMax > 0.0 && c.zMin <= 2.5 && c.zMax > 2.5);
    expect(cellA).toBeDefined();
    expect(cellA!.swingCount).toBe(2);
    expect(cellA!.whiffCount).toBe(1);
    expect(cellA!.value).toBeCloseTo(50.0); // 50% whiff rate

    const cellB = cells.find((c) => c.xMin <= 0.5 && c.xMax > 0.5 && c.zMin <= 3.0 && c.zMax > 3.0);
    expect(cellB).toBeDefined();
    expect(cellB!.value).toBeCloseTo(100.0); // 100% whiff rate
  });
});
