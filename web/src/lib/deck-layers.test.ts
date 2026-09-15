import { describe, expect, it } from "vitest";
import { DataFilterExtension } from "@deck.gl/extensions";
import {
  FALLBACK_COLOR,
  FILTER_SIZE,
  PITCH_COLORS,
  STRIKE_ZONE,
  buildLayers,
  dataFilterExtension,
  filterRange,
  pitchColor,
  strikeZoneSegments,
  type PitchDatum,
} from "./deck-layers";

function pitch(overrides: Partial<PitchDatum> = {}): PitchDatum {
  return {
    path: new Float32Array([0, 55, 5, 0.5, 20, 4, 0, 1.417, 2.5]),
    releaseSpeed: 94.5,
    pfxX: 0,
    pfxZ: 0,
    pitchType: "FF",
    ...overrides,
  };
}

describe("pitchColor", () => {
  it("maps every documented pitch code to a distinct color", () => {
    for (const code of ["FF", "SL", "CH", "CU", "FC", "SI", "ST"]) {
      expect(PITCH_COLORS[code], code).toBeDefined();
      expect(PITCH_COLORS[code], code).toHaveLength(3);
    }
  });

  it("returns the fallback for unknown or empty codes", () => {
    expect(pitchColor("XX")).toBe(FALLBACK_COLOR);
    expect(pitchColor("")).toBe(FALLBACK_COLOR);
    expect(pitchColor(undefined as unknown as string)).toBe(FALLBACK_COLOR);
  });

  it("is case-insensitive", () => {
    expect(pitchColor("sl")).toEqual(PITCH_COLORS.SL);
  });
});

describe("filterRange", () => {
  it("returns a 3-channel triple matching filterSize", () => {
    const range = filterRange([70, 105]);
    expect(range).toEqual([[70, 105], [-Infinity, Infinity], [-Infinity, Infinity]]);
  });

  it("passes through explicit break channels", () => {
    const range = filterRange([70, 105], [-1, 1], [0, 2]);
    expect(range[1]).toEqual([-1, 1]);
    expect(range[2]).toEqual([0, 2]);
  });
});

describe("dataFilterExtension", () => {
  it("configures filterSize 3 with GPU filtering", () => {
    const ext = dataFilterExtension() as unknown as { opts: { filterSize: number } };
    expect(ext).toBeInstanceOf(DataFilterExtension);
    expect(ext.opts.filterSize).toBe(FILTER_SIZE);
    expect(FILTER_SIZE).toBe(3);
  });
});

describe("strikeZoneSegments", () => {
  const segs = strikeZoneSegments();

  it("emits 4 zone edges plus the plate pentagon", () => {
    expect(segs).toHaveLength(5);
    expect(segs[4]).toHaveLength(6); // closed pentagon loop
  });

  it("keeps zone edges on the plate plane within spec bounds", () => {
    for (const seg of segs.slice(0, 4)) {
      for (const [x, y, z] of seg) {
        expect(y).toBeCloseTo(STRIKE_ZONE.y, 6);
        expect(Math.abs(x)).toBeLessThanOrEqual(STRIKE_ZONE.halfWidth + 1e-9);
        expect(z).toBeGreaterThanOrEqual(STRIKE_ZONE.zMin);
        expect(z).toBeLessThanOrEqual(STRIKE_ZONE.zMax);
      }
    }
    // corners hit all four (x, z) combinations
    const corners = new Set(segs.slice(0, 4).flat().map(([x, , z]) => `${x},${z}`));
    expect(corners.size).toBe(4);
  });

  it("draws a 17-inch-wide plate pentagon pointing toward the catcher", () => {
    const plate = segs[4];
    const xs = plate.map(([x]) => x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(17 / 12, 6);
    const minY = Math.min(...plate.map(([, y]) => y));
    expect(minY).toBeLessThan(STRIKE_ZONE.y); // point faces negative y
    expect(plate[0]).toEqual(plate[5]); // closed loop
  });
});

describe("buildLayers", () => {
  const pitches = [
    pitch({ pitchType: "FF", releaseSpeed: 96 }),
    pitch({ pitchType: "SL", releaseSpeed: 85 }),
  ];

  it("returns one trajectory layer and one strike-zone layer", () => {
    const layers = buildLayers({ pitches, speedRange: [60, 105] });
    expect(layers.map((l) => l.id)).toEqual(["pitch-trajectories", "strike-zone"]);
  });

  it("binds the speed range to the GPU filter, not to filtered data", () => {
    const layer = buildLayers({ pitches, speedRange: [90, 105] })[0] as unknown as {
      props: Record<string, unknown>;
    };
    // Both pitches go to the GPU regardless of range — filtering is uniform-side.
    expect(layer.props.data).toBe(pitches);
    expect(layer.props.filterRange).toEqual([
      [90, 105],
      [-Infinity, Infinity],
      [-Infinity, Infinity],
    ]);
    expect((layer.props.getFilterValue as (d: PitchDatum) => number[])(pitches[0])).toEqual([
      96, 0, 0,
    ]);
  });

  it("uses the DataFilterExtension with filterSize 3", () => {
    const layer = buildLayers({ pitches, speedRange: [60, 105] })[0] as unknown as {
      props: { extensions: DataFilterExtension[] };
    };
    const exts = layer.props.extensions;
    expect(exts).toHaveLength(1);
    expect(exts[0]).toBeInstanceOf(DataFilterExtension);
    expect((exts[0] as unknown as { opts: { filterSize: number } }).opts.filterSize).toBe(3);
  });

  it("colors trajectories by pitch type", () => {
    const layer = buildLayers({ pitches, speedRange: [60, 105] })[0] as unknown as {
      props: { getColor: (d: PitchDatum) => number[] };
    };
    expect(layer.props.getColor(pitches[0])).toEqual([...PITCH_COLORS.FF, 220]);
    expect(layer.props.getColor(pitch({ pitchType: "ZZ" }))).toEqual([...FALLBACK_COLOR, 220]);
  });
});
