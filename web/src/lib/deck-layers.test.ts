import { describe, expect, it } from "vitest";
import { DataFilterExtension } from "@deck.gl/extensions";
import { ScatterplotLayer } from "@deck.gl/layers";
import {
  CAMERA_VIEWS,
  FALLBACK_COLOR,
  FILTER_SIZE,
  PITCH_COLORS,
  STRIKE_ZONE,
  battersBoxesSegments,
  batterStrikeZoneSegments,
  buildLayers,
  dataFilterExtension,
  diamondWireframeSegments,
  filterRange,
  isInsideStrikeZone,
  moundCircleSegments,
  pitchColor,
  pitcherRubberSegments,
  strikeZoneSegments,
  tunnelingPlaneSegments,
  type PitchDatum,
  type WireSegment,
} from "./deck-layers";
import { deterministicFallbackColor } from "./pitch-type-color";
import { computeArsenalCentroids } from "./arsenal";

function pitch(overrides: Partial<PitchDatum> = {}): PitchDatum {
  return {
    path: new Float32Array([0, 55, 5, 0.5, 20, 4, 0, 1.417, 2.5]),
    releaseSpeed: 94.5,
    pfxX: 0,
    pfxZ: 0,
    plateX: 0,
    plateZ: 0,
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
  it("defines the broadcast and batter presets with exact view states", () => {
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
    expect(CAMERA_VIEWS.Batter).toEqual({
      target: [0, 25, 3],
      rotationX: 8,
      rotationOrbit: 0,
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

  it("exposes the five preset keys", () => {
    expect(Object.keys(CAMERA_VIEWS).sort()).toEqual(["Batter", "Catcher", "Overhead", "Pitcher", "Side"]);
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

describe("diamondWireframeSegments", () => {
  const segs = diamondWireframeSegments();

  it("combines strike zone, plate, rubber, mound circle, and batter boxes", () => {
    // 4 zone edges + 1 plate + 1 rubber + 1 mound circle + 2 batter's boxes = 9 wireframe paths
    expect(segs).toHaveLength(9);
  });

  it("defines pitcher rubber at y = [60.5, 61.0], z = 0.833, width 2.0 ft", () => {
    const rubber = pitcherRubberSegments()[0];
    expect(rubber).toHaveLength(5); // closed rectangle
    expect(rubber[0]).toEqual(rubber[4]);
    for (const [x, y, z] of rubber) {
      expect(x).toBeGreaterThanOrEqual(-1.0);
      expect(x).toBeLessThanOrEqual(1.0);
      expect(y).toBeGreaterThanOrEqual(60.5);
      expect(y).toBeLessThanOrEqual(61.0);
      expect(z).toBeCloseTo(0.833, 3);
    }
  });

  it("defines mound circle at y = 59.0 with radius 9.0 ft at z = 0", () => {
    const circle = moundCircleSegments()[0];
    expect(circle.length).toBeGreaterThan(10);
    expect(circle[0]).toEqual(circle[circle.length - 1]); // closed loop
    for (const [x, y, z] of circle) {
      expect(z).toBe(0);
      const dist = Math.hypot(x, y - 59.0);
      expect(dist).toBeCloseTo(9.0, 5);
    }
  });

  it("defines left and right batter boxes at z = 0", () => {
    const [leftBox, rightBox] = battersBoxesSegments();
    expect(leftBox).toHaveLength(5);
    expect(rightBox).toHaveLength(5);
    expect(leftBox[0]).toEqual(leftBox[4]);
    expect(rightBox[0]).toEqual(rightBox[4]);

    for (const [x, y, z] of leftBox) {
      expect(x).toBeGreaterThanOrEqual(1.2 - 1e-6);
      expect(x).toBeLessThanOrEqual(5.2 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(-1.58 - 1e-6);
      expect(y).toBeLessThanOrEqual(4.42 + 1e-6);
      expect(z).toBe(0);
    }

    for (const [x, y, z] of rightBox) {
      expect(x).toBeGreaterThanOrEqual(-5.2 - 1e-6);
      expect(x).toBeLessThanOrEqual(-1.2 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(-1.58 - 1e-6);
      expect(y).toBeLessThanOrEqual(4.42 + 1e-6);
      expect(z).toBe(0);
    }
  });
});

describe("tunnelingPlaneSegments", () => {
  const segs = tunnelingPlaneSegments();

  it("defines wireframe rectangle at y = 23.8 ft, x in [-2.5, 2.5], z in [1.0, 5.0]", () => {
    expect(segs).toHaveLength(1);
    const rect = segs[0];
    expect(rect).toHaveLength(5); // closed loop
    expect(rect[0]).toEqual(rect[4]);
    for (const [x, y, z] of rect) {
      expect(y).toBeCloseTo(23.8, 6);
      expect(x).toBeGreaterThanOrEqual(-2.5);
      expect(x).toBeLessThanOrEqual(2.5);
      expect(z).toBeGreaterThanOrEqual(1.0);
      expect(z).toBeLessThanOrEqual(5.0);
    }
  });
});

describe("isInsideStrikeZone", () => {
  it("identifies pitches inside the strike zone", () => {
    expect(isInsideStrikeZone(0, 2.5)).toBe(true);
    expect(isInsideStrikeZone(0.83, 1.5)).toBe(true);
    expect(isInsideStrikeZone(-0.83, 3.5)).toBe(true);
  });

  it("identifies pitches outside horizontal and vertical bounds", () => {
    expect(isInsideStrikeZone(0.84, 2.5)).toBe(false);
    expect(isInsideStrikeZone(-0.84, 2.5)).toBe(false);
    expect(isInsideStrikeZone(0, 1.49)).toBe(false);
    expect(isInsideStrikeZone(0, 3.51)).toBe(false);
  });

  it("honors batter-specific szTop and szBot when supplied", () => {
    // Custom batter zone: knees at 1.7 ft, letters at 3.8 ft
    expect(isInsideStrikeZone(0, 3.6, 3.8, 1.7)).toBe(true);
    expect(isInsideStrikeZone(0, 1.6, 3.8, 1.7)).toBe(false);
  });
});

describe("batterStrikeZoneSegments", () => {
  it("draws a closed wireframe rectangle at specified batter heights", () => {
    const segs = batterStrikeZoneSegments(3.6, 1.7);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toHaveLength(5);
    expect(segs[0][0]).toEqual(segs[0][4]);
    for (const [, y, z] of segs[0]) {
      expect(y).toBeCloseTo(STRIKE_ZONE.y, 6);
      expect(z).toBeGreaterThanOrEqual(1.7 - 1e-9);
      expect(z).toBeLessThanOrEqual(3.6 + 1e-9);
    }
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

  it("binds plateXRange and plateZRange to channels 1 and 2 of filterRange", () => {
    const layer = buildLayers({
      pitches,
      speedRange: [80, 100],
      plateXRange: [-1.2, 1.2],
      plateZRange: [1.2, 4.0],
    })[0] as unknown as {
      props: { filterRange: number[][] };
    };
    expect(layer.props.filterRange[1]).toEqual([-1.2, 1.2]);
    expect(layer.props.filterRange[2]).toEqual([1.2, 4.0]);
  });

  it("filters by strike zone via channel 3 discrete mask", () => {
    const inZonePitch = pitch({ plateX: 0, plateZ: 2.5 });
    const outZonePitch = pitch({ plateX: 1.5, plateZ: 2.5 });
    const testPitches = [inZonePitch, outZonePitch];

    const inLayer = buildLayers({
      pitches: testPitches,
      speedRange: [60, 105],
      zoneFilter: "in_zone",
    })[0] as unknown as {
      props: {
        filterRange: number[][];
        getFilterValue: (d: PitchDatum) => number[];
      };
    };
    expect(inLayer.props.filterRange[3]).toEqual([0.5, 1.5]);
    expect(inLayer.props.getFilterValue(inZonePitch)[3]).toBe(1);
    expect(inLayer.props.getFilterValue(outZonePitch)[3]).toBe(0);

    const outLayer = buildLayers({
      pitches: testPitches,
      speedRange: [60, 105],
      zoneFilter: "out_of_zone",
    })[0] as unknown as {
      props: {
        filterRange: number[][];
        getFilterValue: (d: PitchDatum) => number[];
      };
    };
    expect(outLayer.props.filterRange[3]).toEqual([0.5, 1.5]);
    expect(outLayer.props.getFilterValue(inZonePitch)[3]).toBe(0);
    expect(outLayer.props.getFilterValue(outZonePitch)[3]).toBe(1);
  });

  it("filters by outcome (swings and whiffs) via channel 3 discrete mask", () => {
    const takePitch = pitch({ isSwing: 0, isWhiff: 0 });
    const foulPitch = pitch({ isSwing: 1, isWhiff: 0 });
    const whiffPitch = pitch({ isSwing: 1, isWhiff: 1 });
    const testPitches = [takePitch, foulPitch, whiffPitch];

    const swingLayer = buildLayers({
      pitches: testPitches,
      speedRange: [60, 105],
      outcomeFilter: "swings",
    })[0] as unknown as {
      props: {
        filterRange: number[][];
        getFilterValue: (d: PitchDatum) => number[];
      };
    };
    expect(swingLayer.props.filterRange[3]).toEqual([0.5, 1.5]);
    expect(swingLayer.props.getFilterValue(takePitch)[3]).toBe(0);
    expect(swingLayer.props.getFilterValue(foulPitch)[3]).toBe(1);
    expect(swingLayer.props.getFilterValue(whiffPitch)[3]).toBe(1);

    const whiffLayer = buildLayers({
      pitches: testPitches,
      speedRange: [60, 105],
      outcomeFilter: "whiffs",
    })[0] as unknown as {
      props: {
        filterRange: number[][];
        getFilterValue: (d: PitchDatum) => number[];
      };
    };
    expect(whiffLayer.props.filterRange[3]).toEqual([0.5, 1.5]);
    expect(whiffLayer.props.getFilterValue(takePitch)[3]).toBe(0);
    expect(whiffLayer.props.getFilterValue(foulPitch)[3]).toBe(0);
    expect(whiffLayer.props.getFilterValue(whiffPitch)[3]).toBe(1);
  });

  it("combines pitch type, zone, and outcome criteria in channel 3 mask", () => {
    const matchPitch = pitch({ pitchType: "FF", plateX: 0, plateZ: 2.5, isSwing: 1, isWhiff: 1 });
    const wrongType = pitch({ pitchType: "SL", plateX: 0, plateZ: 2.5, isSwing: 1, isWhiff: 1 });
    const wrongZone = pitch({ pitchType: "FF", plateX: 2.0, plateZ: 2.5, isSwing: 1, isWhiff: 1 });
    const wrongOutcome = pitch({ pitchType: "FF", plateX: 0, plateZ: 2.5, isSwing: 1, isWhiff: 0 });

    const layer = buildLayers({
      pitches: [matchPitch, wrongType, wrongZone, wrongOutcome],
      speedRange: [60, 105],
      selectedTypes: new Set(["FF"]),
      zoneFilter: "in_zone",
      outcomeFilter: "whiffs",
    })[0] as unknown as {
      props: {
        filterRange: number[][];
        getFilterValue: (d: PitchDatum) => number[];
      };
    };
    expect(layer.props.filterRange[3]).toEqual([0.5, 1.5]);
    expect(layer.props.getFilterValue(matchPitch)[3]).toBe(1);
    expect(layer.props.getFilterValue(wrongType)[3]).toBe(0);
    expect(layer.props.getFilterValue(wrongZone)[3]).toBe(0);
    expect(layer.props.getFilterValue(wrongOutcome)[3]).toBe(0);
  });

  it("uses diamond wireframe segments for the strike-zone layer", () => {
    const layers = buildLayers({ pitches, speedRange: [60, 105] });
    const szLayer = layers.find((l) => l.id === "strike-zone") as unknown as {
      props: { data: unknown };
    };
    expect(szLayer).toBeDefined();
    expect(szLayer.props.data).toEqual(diamondWireframeSegments());
  });

  it("conditionally includes the tunneling commitment plane layer", () => {
    const withoutTunnel = buildLayers({ pitches, speedRange: [60, 105], showTunneling: false });
    expect(withoutTunnel.some((l) => l.id === "tunneling-plane")).toBe(false);

    const withTunnel = buildLayers({ pitches, speedRange: [60, 105], showTunneling: true });
    const tunnelLayer = withTunnel.find((l) => l.id === "tunneling-plane") as unknown as {
      props: { data: unknown };
    };
    expect(tunnelLayer).toBeDefined();
    expect(tunnelLayer.props.data).toEqual(tunnelingPlaneSegments());
  });

  it("conditionally adds ScatterplotLayer baseball markers when flightProgress is defined", () => {
    const withoutProgress = buildLayers({ pitches, speedRange: [60, 105] });
    expect(withoutProgress.some((l) => l.id === "baseball-markers")).toBe(false);

    // Flat path of 60 points: (0, 55, 6) to (0, 1.417, 2.5)
    const testPath = new Float32Array(180);
    for (let i = 0; i < 60; i++) {
      testPath[i * 3] = i * 0.1;
      testPath[i * 3 + 1] = 55 - (i * (55 - 1.417)) / 59;
      testPath[i * 3 + 2] = 6 - (i * (6 - 2.5)) / 59;
    }
    const testPitch = pitch({ pitchType: "SL", path: testPath, releaseSpeed: 87 });

    const withProgress = buildLayers({
      pitches: [testPitch],
      speedRange: [60, 105],
      flightProgress: 0.5,
    });

    const markerLayer = withProgress.find((l) => l.id === "baseball-markers") as unknown as {
      props: {
        coordinateSystem: string;
        data: PitchDatum[];
        getRadius: number;
        radiusUnits: string;
        stroked: boolean;
        filled: boolean;
        getFillColor: number[];
        getLineColor: (d: PitchDatum) => number[];
        lineWidthMinPixels: number;
        extensions: DataFilterExtension[];
        filterRange: number[][];
        getFilterValue: (d: PitchDatum) => number[];
        getPosition: (d: PitchDatum) => [number, number, number];
        updateTriggers: Record<string, unknown>;
      };
    };

    expect(markerLayer).toBeDefined();
    expect(markerLayer).toBeInstanceOf(ScatterplotLayer);
    expect(markerLayer.props.coordinateSystem).toBe("cartesian");
    expect(markerLayer.props.getRadius).toBe(0.1);
    expect(markerLayer.props.radiusUnits).toBe("meters");
    expect(markerLayer.props.stroked).toBe(true);
    expect(markerLayer.props.filled).toBe(true);
    expect(markerLayer.props.getFillColor).toEqual([255, 255, 255, 240]);
    expect(markerLayer.props.getLineColor(testPitch)).toEqual([...PITCH_COLORS.SL, 255]);
    expect(markerLayer.props.lineWidthMinPixels).toBe(1.5);
    expect(markerLayer.props.updateTriggers.getPosition).toBe(0.5);

    // Samples 3D coordinates at Math.floor(0.5 * 59) = 29
    const sampleAtHalf = markerLayer.props.getPosition(testPitch);
    expect(sampleAtHalf[0]).toBeCloseTo(testPath[29 * 3], 5);
    expect(sampleAtHalf[1]).toBeCloseTo(testPath[29 * 3 + 1], 5);
    expect(sampleAtHalf[2]).toBeCloseTo(testPath[29 * 3 + 2], 5);

    // Tests progress 0 (release) and 1 (plate)
    const layerRelease = buildLayers({
      pitches: [testPitch],
      speedRange: [60, 105],
      flightProgress: 0.0,
    }).find((l) => l.id === "baseball-markers") as unknown as {
      props: { getPosition: (d: PitchDatum) => [number, number, number] };
    };
    expect(layerRelease.props.getPosition(testPitch)).toEqual([testPath[0], testPath[1], testPath[2]]);

    const layerPlate = buildLayers({
      pitches: [testPitch],
      speedRange: [60, 105],
      flightProgress: 1.0,
    }).find((l) => l.id === "baseball-markers") as unknown as {
      props: { getPosition: (d: PitchDatum) => [number, number, number] };
    };
    expect(layerPlate.props.getPosition(testPitch)).toEqual([
      testPath[59 * 3],
      testPath[59 * 3 + 1],
      testPath[59 * 3 + 2],
    ]);

    // Inherits GPU uniform filter props
    expect(markerLayer.props.filterRange).toEqual([
      [60, 105],
      [-Infinity, Infinity],
      [-Infinity, Infinity],
      [-Infinity, Infinity],
    ]);
    expect(markerLayer.props.getFilterValue(testPitch)).toEqual([87, 0, 0, 1]);
    expect(markerLayer.props.extensions[0]).toBeInstanceOf(DataFilterExtension);
  });

  it("builds ghost-trajectories layer when showGhostBreak is true", () => {
    const testPitch = pitch({
      ghostPath: new Float32Array([0, 55, 5, 0, 20, 3.5, 0, 1.417, 2.0]),
    });
    const layers = buildLayers({
      pitches: [testPitch],
      speedRange: [60, 105],
      showGhostBreak: true,
    });
    const ghostLayer = layers.find((l) => l.id === "ghost-trajectories") as unknown as {
      props: {
        coordinateSystem: string;
        getColor: [number, number, number, number];
        getPath: (d: PitchDatum) => Float32Array;
        extensions: unknown[];
      };
    };
    expect(ghostLayer).toBeDefined();
    expect(ghostLayer.props.coordinateSystem).toBe("cartesian");
    expect(ghostLayer.props.getColor).toEqual([200, 220, 240, 80]);
    expect(ghostLayer.props.getPath(testPitch)).toBe(testPitch.ghostPath);
    expect(ghostLayer.props.extensions[0]).toBeInstanceOf(DataFilterExtension);
  });

  it("builds picked-ghost-trajectory and picked-break-vector when a pitch with kinematics is picked", () => {
    const testPitch = pitch({
      kinematics: {
        x0: -1.5, y0: 55, z0: 5.8,
        vx0: 3.5, vy0: -125, vz0: -3.0,
        ax: -8.0, ay: 20.0, az: -22.0,
      },
    });
    const layers = buildLayers({
      pitches: [testPitch],
      speedRange: [60, 105],
      picked: testPitch,
    });
    const pickedGhost = layers.find((l) => l.id === "picked-ghost-trajectory") as unknown as {
      props: {
        coordinateSystem: string;
        getColor: [number, number, number, number];
        getPath: () => Float32Array;
      };
    };
    const breakVecLayer = layers.find((l) => l.id === "picked-break-vector") as unknown as {
      props: {
        coordinateSystem: string;
        getColor: [number, number, number];
        data: [[[number, number, number], [number, number, number]]];
      };
    };
    expect(pickedGhost).toBeDefined();
    expect(pickedGhost.props.coordinateSystem).toBe("cartesian");
    expect(pickedGhost.props.getColor).toEqual([220, 240, 255, 230]);
    expect(pickedGhost.props.getPath()).toHaveLength(180);

    expect(breakVecLayer).toBeDefined();
    expect(breakVecLayer.props.getColor).toEqual([255, 215, 0]);
    expect(breakVecLayer.props.data).toHaveLength(1);
    expect(breakVecLayer.props.data[0][0][1]).toBeCloseTo(1.417, 3);
    expect(breakVecLayer.props.data[0][1][1]).toBeCloseTo(1.417, 3);

    const pickedRelease = layers.find((l) => l.id === "picked-release-point") as unknown as {
      props: {
        coordinateSystem: string;
        getPosition: () => [number, number, number];
        getFillColor: [number, number, number, number];
      };
    };
    expect(pickedRelease).toBeDefined();
    expect(pickedRelease.props.coordinateSystem).toBe("cartesian");
    expect(pickedRelease.props.getPosition()).toEqual([-1.5, 55, 5.8]);
    expect(pickedRelease.props.getFillColor).toEqual([255, 215, 0, 240]);
  });

  it("builds release-points layer when showReleasePoints is true", () => {
    const testPitch = pitch({
      kinematics: {
        x0: -1.6, y0: 54.5, z0: 5.9,
        vx0: 3.0, vy0: -130, vz0: -4.0,
        ax: -5.0, ay: 15.0, az: -20.0,
      },
    });
    const layers = buildLayers({
      pitches: [testPitch],
      speedRange: [60, 105],
      showReleasePoints: true,
    });
    const releaseLayer = layers.find((l) => l.id === "release-points") as unknown as {
      props: {
        coordinateSystem: string;
        getPosition: (d: PitchDatum) => [number, number, number];
        getRadius: number;
        extensions: unknown[];
      };
    };
    expect(releaseLayer).toBeDefined();
    expect(releaseLayer.props.coordinateSystem).toBe("cartesian");
    expect(releaseLayer.props.getRadius).toBe(0.12);
    expect(releaseLayer.props.getPosition(testPitch)).toEqual([-1.6, 54.5, 5.9]);
    expect(releaseLayer.props.extensions[0]).toBeInstanceOf(DataFilterExtension);
  });

  it("builds plate-crossings layer when showPlateCrossings is true", () => {
    const testPitch = pitch({ plateX: 0.35, plateZ: 2.75 });
    const layers = buildLayers({
      pitches: [testPitch],
      speedRange: [60, 105],
      showPlateCrossings: true,
    });
    const plateLayer = layers.find((l) => l.id === "plate-crossings") as unknown as {
      props: {
        coordinateSystem: string;
        getPosition: (d: PitchDatum) => [number, number, number];
        getRadius: number;
        extensions: unknown[];
      };
    };
    expect(plateLayer).toBeDefined();
    expect(plateLayer.props.coordinateSystem).toBe("cartesian");
    expect(plateLayer.props.getRadius).toBe(0.06);
    expect(plateLayer.props.getPosition(testPitch)).toEqual([0.35, STRIKE_ZONE.y, 2.75]);
    expect(plateLayer.props.extensions[0]).toBeInstanceOf(DataFilterExtension);
  });

  it("builds picked-plate-crossing and picked-batter-strike-zone when picked has szTop and szBot", () => {
    const testPitch = pitch({
      plateX: -0.2,
      plateZ: 2.1,
      szTop: 3.6,
      szBot: 1.6,
    });
    const layers = buildLayers({
      pitches: [testPitch],
      speedRange: [60, 105],
      picked: testPitch,
    });
    const pickedCrossing = layers.find((l) => l.id === "picked-plate-crossing") as unknown as {
      props: {
        coordinateSystem: string;
        getPosition: () => [number, number, number];
        getFillColor: [number, number, number, number];
      };
    };
    const pickedZone = layers.find((l) => l.id === "picked-batter-strike-zone") as unknown as {
      props: {
        coordinateSystem: string;
        getColor: [number, number, number];
        data: WireSegment[];
      };
    };
    expect(pickedCrossing).toBeDefined();
    expect(pickedCrossing.props.coordinateSystem).toBe("cartesian");
    expect(pickedCrossing.props.getPosition()).toEqual([-0.2, STRIKE_ZONE.y, 2.1]);
    expect(pickedCrossing.props.getFillColor).toEqual([255, 215, 0, 240]);

    expect(pickedZone).toBeDefined();
    expect(pickedZone.props.coordinateSystem).toBe("cartesian");
    expect(pickedZone.props.getColor).toEqual([0, 220, 255]);
    expect(pickedZone.props.data).toHaveLength(1);
    expect(pickedZone.props.data[0][0][2]).toBeCloseTo(1.6);
    expect(pickedZone.props.data[0][2][2]).toBeCloseTo(3.6);
  });

  it("builds tunnel-points layer when showTunneling is true", () => {
    const testPitch = pitch({
      commitmentPoint: [0.25, 23.8, 3.1],
    });
    const layers = buildLayers({
      pitches: [testPitch],
      speedRange: [60, 105],
      showTunneling: true,
    });
    const tunnelLayer = layers.find((l) => l.id === "tunnel-points") as unknown as {
      props: {
        coordinateSystem: string;
        getPosition: (d: PitchDatum) => [number, number, number];
        getRadius: number;
        extensions: unknown[];
      };
    };
    expect(tunnelLayer).toBeDefined();
    expect(tunnelLayer.props.coordinateSystem).toBe("cartesian");
    expect(tunnelLayer.props.getRadius).toBe(0.08);
    expect(tunnelLayer.props.getPosition(testPitch)).toEqual([0.25, 23.8, 3.1]);
    expect(tunnelLayer.props.extensions[0]).toBeInstanceOf(DataFilterExtension);
  });

  it("builds picked-tunnel-point layer when picked pitch has kinematics or commitmentPoint", () => {
    const testPitch = pitch({
      commitmentPoint: [0.15, 23.8, 2.95],
      kinematics: {
        x0: 0, y0: 55, z0: 6,
        vx0: 0, vy0: -130, vz0: 0,
        ax: 0, ay: 0, az: 0,
      },
    });
    const layers = buildLayers({
      pitches: [testPitch],
      speedRange: [60, 105],
      picked: testPitch,
    });
    const pickedTunnel = layers.find((l) => l.id === "picked-tunnel-point") as unknown as {
      props: {
        coordinateSystem: string;
        getPosition: () => [number, number, number];
        getRadius: number;
        getFillColor: [number, number, number, number];
      };
    };
    expect(pickedTunnel).toBeDefined();
    expect(pickedTunnel.props.coordinateSystem).toBe("cartesian");
    expect(pickedTunnel.props.getRadius).toBe(0.14);
    expect(pickedTunnel.props.getPosition()).toEqual([0.15, 23.8, 2.95]);
    expect(pickedTunnel.props.getFillColor).toEqual([255, 215, 0, 240]);
  });

  it("builds paired-tunnel-envelope and paired-centroid-paths when pairedTypes and arsenalCentroids are provided", () => {
    const p1 = pitch({
      pitchType: "FF",
      kinematics: {
        x0: -1.6, y0: 55.0, z0: 6.0,
        vx0: 2.0, vy0: -135.0, vz0: -5.0,
        ax: 5.0, ay: 0.0, az: 15.0,
      },
    });
    const p2 = pitch({
      pitchType: "SL",
      kinematics: {
        x0: -1.6, y0: 55.0, z0: 5.9,
        vx0: 2.5, vy0: -120.0, vz0: -3.0,
        ax: -8.0, ay: 0.0, az: -20.0,
      },
    });
    const centroids = computeArsenalCentroids([p1, p2]);
    const layers = buildLayers({
      pitches: [p1, p2],
      speedRange: [60, 105],
      pairedTypes: ["FF", "SL"],
      arsenalCentroids: centroids,
    });

    const envelopeLayer = layers.find((l) => l.id === "paired-tunnel-envelope");
    const pathsLayer = layers.find((l) => l.id === "paired-centroid-paths");

    expect(envelopeLayer).toBeDefined();
    expect(pathsLayer).toBeDefined();
    expect(envelopeLayer!.props.coordinateSystem).toBe("cartesian");
    expect(pathsLayer!.props.coordinateSystem).toBe("cartesian");
  });

  it("builds simulated batted trajectory and landing spot layers when contact sim is enabled", () => {
    const p = pitch({
      pitchType: "FF",
      kinematics: {
        x0: -2.0,
        y0: 50.0,
        z0: 5.8,
        vx0: 5.0,
        vy0: -130.0,
        vz0: -4.0,
        ax: -12.0,
        ay: 26.0,
        az: -18.0,
      },
    });

    const layers = buildLayers({
      pitches: [p],
      speedRange: [60, 105],
      picked: p,
      showContactSim: true,
      batSpeed: 75.0,
      attackAngleDeg: 25.0,
    });

    const battedLayer = layers.find((l) => l.id === "simulated-batted-trajectory");
    const landingLayer = layers.find((l) => l.id === "simulated-landing-spot");

    expect(battedLayer).toBeDefined();
    expect(landingLayer).toBeDefined();
    expect(battedLayer!.props.coordinateSystem).toBe("cartesian");
    expect(landingLayer!.props.coordinateSystem).toBe("cartesian");
  });

  it("builds release dispersion ellipsoid layer when showDispersion is true", () => {
    const layers = buildLayers({
      pitches: [],
      speedRange: [60, 105],
      showDispersion: true,
      releaseDispersion: {
        count: 10,
        meanX: -1.5,
        meanY: 55.0,
        meanZ: 5.8,
        stdX: 0.1,
        stdY: 0.2,
        stdZ: 0.15,
        covXY: 0,
        covXZ: 0,
        covYZ: 0,
        volumeCuFt: 0.05,
        wireframeSegments: [
          [[-1.4, 55.0, 5.8], [-1.6, 55.0, 5.8]],
        ],
      },
    });

    const ellipsoidLayer = layers.find((l) => l.id === "release-dispersion-ellipsoid");
    expect(ellipsoidLayer).toBeDefined();
    expect(ellipsoidLayer!.props.coordinateSystem).toBe("cartesian");
  });

  it("builds strike zone heatmap PolygonLayer when showHeatmap is true", () => {
    const layers = buildLayers({
      pitches: [],
      speedRange: [60, 105],
      showHeatmap: true,
      heatmapCells: [
        {
          cellId: 0,
          xMin: -0.5,
          xMax: 0.0,
          zMin: 1.5,
          zMax: 2.5,
          polygon: [[-0.5, 1.417, 1.5], [0.0, 1.417, 1.5], [0.0, 1.417, 2.5], [-0.5, 1.417, 2.5]],
          pitchCount: 5,
          swingCount: 3,
          whiffCount: 2,
          value: 1.0,
          color: [255, 50, 30, 240],
        },
      ],
    });

    const heatmapLayer = layers.find((l) => l.id === "strike-zone-heatmap");
    expect(heatmapLayer).toBeDefined();
    expect(heatmapLayer!.props.coordinateSystem).toBe("cartesian");
  });
});

