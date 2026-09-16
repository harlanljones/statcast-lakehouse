import { describe, expect, it } from "vitest";
import { DataFilterExtension } from "@deck.gl/extensions";
import {
  CAMERA_VIEWS,
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
import { deterministicFallbackColor } from "./pitch-type-color";

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

  it("returns deterministic colors for unknown codes, gray for empty", () => {
    // Unknown codes share the legend's deterministic mapping so the 3D
    // trajectories and the 2D legend always agree.
    expect(pitchColor("XX")).toEqual(deterministicFallbackColor("XX"));
    expect(pitchColor("XX")).not.toBe(FALLBACK_COLOR);
    expect(pitchColor("")).toBe(FALLBACK_COLOR);
    expect(pitchColor(undefined as unknown as string)).toBe(FALLBACK_COLOR);
  });

  it("is case-insensitive", () => {
    expect(pitchColor("sl")).toEqual(PITCH_COLORS.SL);
  });
});

describe("filterRange", () => {
  it("returns a 4-channel tuple matching filterSize", () => {
    const range = filterRange([70, 105]);
    expect(range).toEqual([
      [70, 105],
      [-Infinity, Infinity],
      [-Infinity, Infinity],
      [-Infinity, Infinity],
    ]);
  });

  it("passes through explicit break and type channels", () => {
    const range = filterRange([70, 105], [-1, 1], [0, 2], [0.5, 1.5]);
    expect(range[1]).toEqual([-1, 1]);
    expect(range[2]).toEqual([0, 2]);
    expect(range[3]).toEqual([0.5, 1.5]);
  });
});

describe("dataFilterExtension", () => {
  it("configures filterSize 4 with GPU filtering", () => {
    const ext = dataFilterExtension() as unknown as { opts: { filterSize: number } };
    expect(ext).toBeInstanceOf(DataFilterExtension);
    expect(ext.opts.filterSize).toBe(FILTER_SIZE);
    expect(FILTER_SIZE).toBe(4);
  });
});

describe("CAMERA_VIEWS", () => {
  it("defines the four broadcast presets with exact view states", () => {
    expect(CAMERA_VIEWS.Catcher).toEqual({
      target: [0, 1.417, 2.5],
      rotationX: 12,
      rotationOrbit: 35,
      zoom: 6.2,
    });
    expect(CAMERA_VIEWS.Pitcher).toEqual({
      target: [0, 25, 3],
      rotationX: 10,
      rotationOrbit: 215,
      zoom: 5.5,
    });
    expect(CAMERA_VIEWS.Overhead).toEqual({
      target: [0, 27, 0],
      rotationX: 90,
      rotationOrbit: 0,
      zoom: 5.0,
    });
    expect(CAMERA_VIEWS.Side).toEqual({
      target: [0, 25, 3],
      rotationX: 5,
      rotationOrbit: 90,
      zoom: 5.5,
    });
  });

  it("exposes exactly the four preset keys", () => {
    expect(Object.keys(CAMERA_VIEWS).sort()).toEqual(["Catcher", "Overhead", "Pitcher", "Side"]);
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
      [-Infinity, Infinity],
    ]);
    expect((layer.props.getFilterValue as (d: PitchDatum) => number[])(pitches[0])).toEqual([
      96, 0, 0, 1,
    ]);
  });

  it("uses the DataFilterExtension with filterSize 4", () => {
    const layer = buildLayers({ pitches, speedRange: [60, 105] })[0] as unknown as {
      props: { extensions: DataFilterExtension[] };
    };
    const exts = layer.props.extensions;
    expect(exts).toHaveLength(1);
    expect(exts[0]).toBeInstanceOf(DataFilterExtension);
    expect((exts[0] as unknown as { opts: { filterSize: number } }).opts.filterSize).toBe(4);
  });

  it("routes pitch-type selection through the 4th GPU channel, not array filtering", () => {
    const selected = new Set(["SL"]);
    const layer = buildLayers({ pitches, speedRange: [60, 105], selectedTypes: selected })[0] as unknown as {
      props: {
        data: PitchDatum[];
        filterRange: [[number, number], [number, number], [number, number], [number, number]];
        getFilterValue: (d: PitchDatum) => number[];
      };
    };
    // The full unfiltered dataset still goes to the GPU.
    expect(layer.props.data).toBe(pitches);
    expect(layer.props.filterRange[3]).toEqual([0.5, 1.5]);
    const get = layer.props.getFilterValue;
    expect(get(pitches[0])).toEqual([96, 0, 0, 0]); // FF deselected
    expect(get(pitches[1])).toEqual([85, 0, 0, 1]); // SL selected
  });

  it("emphasizes the picked trajectory via a per-datum GPU width accessor", () => {
    const layer = buildLayers({
      pitches,
      speedRange: [60, 105],
      picked: pitches[1],
    })[0] as unknown as {
      props: {
        getWidth: (d: PitchDatum) => number;
        updateTriggers: Record<string, unknown>;
      };
    };
    const BASE = 0.08;
    // Per-datum accessor on the GPU path — data stays unfiltered.
    expect(layer.props.getWidth(pitches[1])).toBeCloseTo(BASE * 2.5, 9);
    expect(layer.props.getWidth(pitches[0])).toBeCloseTo(BASE, 9);
    // Layer re-evaluation is triggered by the picked datum reference.
    expect(layer.props.updateTriggers.getWidth).toBe(pitches[1]);
  });

  it("uses base width everywhere when nothing is picked", () => {
    const layer = buildLayers({ pitches, speedRange: [60, 105], picked: null })[0] as unknown as {
      props: { getWidth: (d: PitchDatum) => number };
    };
    for (const p of pitches) expect(layer.props.getWidth(p)).toBeCloseTo(0.08, 9);
  });

  it("colors trajectories by pitch type", () => {
    const layer = buildLayers({ pitches, speedRange: [60, 105] })[0] as unknown as {
      props: { getColor: (d: PitchDatum) => number[] };
    };
    expect(layer.props.getColor(pitches[0])).toEqual([...PITCH_COLORS.FF, 220]);
    expect(layer.props.getColor(pitch({ pitchType: "ZZ" }))).toEqual([...deterministicFallbackColor("ZZ"), 220]);
  });
});
