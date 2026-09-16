/**
 * Deck.gl layer definitions (TDD §5.3).
 *
 * GPU-side filtering: slider signals bind straight to DataFilterExtension
 * filter ranges — no JavaScript array filtering on the interaction path.
 */
import { DataFilterExtension } from "@deck.gl/extensions";
import { PathLayer, ScatterplotLayer, type PathLayerProps } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import { type AccessorFunction } from "@deck.gl/core";
import type { OrbitViewState } from "@deck.gl/core";

export const ORBIT_TARGET: [number, number, number] = [0, 1.417, 2.5];
export const INITIAL_VIEW: OrbitViewState = {
  target: ORBIT_TARGET,
  rotationX: 12,
  rotationOrbit: 35,
  zoom: 6.2,
};

export interface PitchDatum {
  path: Float32Array;
  releaseSpeed: number;
  pfxX: number;
  pfxZ: number;
  plateX: number;
  plateZ: number;
  pitchType: string;
  isSwing?: number;
  isWhiff?: number;
}

export const FILTER_SIZE = 4;

/**
 * Strike zone geometry (feet, Z-up). Plate front face at y = 1.417 ft;
 * zone is 17 in (1.4167 ft) wide, knees (1.5 ft) to letters (3.5 ft).
 */
export const STRIKE_ZONE = {
  y: 1.417,
  halfWidth: 0.83, // 17 inches / 2
  zMin: 1.5,
  zMax: 3.5,
} as const;

/** Check whether a coordinate at the plate is inside the rulebook strike zone. */
export function isInsideStrikeZone(plateX: number, plateZ: number): boolean {
  return (
    Math.abs(plateX) <= STRIKE_ZONE.halfWidth &&
    plateZ >= STRIKE_ZONE.zMin &&
    plateZ <= STRIKE_ZONE.zMax
  );
}

/**
 * Camera viewpoint presets (OrbitView view states, feet / degrees).
 * Catcher looks from behind the plate; Pitcher from the mound; Overhead is
 * top-down; Side is the dugout line. Zoom follows deck.gl OrbitView scale.
 */
export const CAMERA_VIEWS = {
  Catcher: { target: [0, 1.417, 2.5], rotationX: 12, rotationOrbit: 35, zoom: 6.2 },
  Pitcher: { target: [0, 25, 3], rotationX: 10, rotationOrbit: 215, zoom: 5.5 },
  Overhead: { target: [0, 27, 0], rotationX: 90, rotationOrbit: 0, zoom: 5.0 },
  Side: { target: [0, 25, 3], rotationX: 5, rotationOrbit: 90, zoom: 5.5 },
} as const satisfies Record<string, OrbitViewState>;

export type CameraViewName = keyof typeof CAMERA_VIEWS;

/** Uniform filter range that disables a channel ([.., ..] matches everything). */
const OPEN_RANGE: [number, number] = [-Infinity, Infinity];

/** Full [speed, hBreak, vBreak, type] filterRange quadruple for GPU-side filtering. */
export function filterRange(
  speed: [number, number],
  hBreak: [number, number] = OPEN_RANGE,
  vBreak: [number, number] = OPEN_RANGE,
  types: [number, number] = OPEN_RANGE,
): [[number, number], [number, number], [number, number], [number, number]] {
  return [speed, hBreak, vBreak, types];
}

/** GPU uniform filter extension shared by all trajectory layers (filterSize=4). */
export function dataFilterExtension() {
  return new DataFilterExtension({ filterSize: FILTER_SIZE });
}

/**
 * Pitch colors live in pitch-type-color.ts (shared with the 2D legend);
 * unknown codes get a deterministic per-code color so legend and trajectories
 * always agree; gray is reserved for missing/empty codes.
 */
import { pitchColor } from "./pitch-type-color";
export { PITCH_COLORS, FALLBACK_COLOR, pitchColor } from "./pitch-type-color";

export type WireSegment = [number, number, number][];

/**
 * Strike zone wireframe as line-segment paths (plate-plane rectangle,
 * y = STRIKE_ZONE.y), plus the home-plate pentagon outline at z = 0.
 */
export function strikeZoneSegments(): WireSegment[] {
  const { y, halfWidth: w, zMin, zMax } = STRIKE_ZONE;
  const rect: WireSegment[] = [
    [[-w, y, zMin], [w, y, zMin]],
    [[w, y, zMin], [w, y, zMax]],
    [[w, y, zMax], [-w, y, zMax]],
    [[-w, y, zMax], [-w, y, zMin]],
  ];
  // Home plate: 17 in wide, 8.5 in deep sides, 12 in point facing catcher.
  const hpW = 17 / 24;
  const hpD = 8.5 / 24;
  const hpPoint = -hpD; // point extends toward catcher (negative y)
  const plate: WireSegment = [
    [-hpW, y, 0],
    [hpW, y, 0],
    [hpW, y - hpD, 0],
    [0, hpPoint, 0],
    [-hpW, y - hpD, 0],
    [-hpW, y, 0],
  ];
  return [...rect, plate];
}

/**
 * Pitcher's rubber at y = 60.5, z = 0.833, width 2.0 ft, depth 0.5 ft (closed rectangle).
 */
export function pitcherRubberSegments(): WireSegment[] {
  const yFront = 60.5;
  const yBack = 61.0;
  const halfW = 1.0;
  const z = 0.833;
  return [
    [
      [-halfW, yFront, z],
      [halfW, yFront, z],
      [halfW, yBack, z],
      [-halfW, yBack, z],
      [-halfW, yFront, z],
    ],
  ];
}

/**
 * Mound circle at y = 59.0, radius 9.0 ft at z = 0.
 */
export function moundCircleSegments(segments = 36): WireSegment[] {
  const cy = 59.0;
  const r = 9.0;
  const pts: [number, number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const theta = (i * 2 * Math.PI) / segments;
    pts.push([r * Math.sin(theta), cy + r * Math.cos(theta), 0]);
  }
  pts.push([...pts[0]]);
  return [pts];
}

/**
 * Batter's boxes on left (x in [1.2, 5.2]) and right (x in [-5.2, -1.2]),
 * y in [-1.58, 4.42], z = 0 (closed rectangles).
 */
export function battersBoxesSegments(): WireSegment[] {
  const yMin = -1.58;
  const yMax = 4.42;
  const leftBox: WireSegment = [
    [1.2, yMin, 0],
    [5.2, yMin, 0],
    [5.2, yMax, 0],
    [1.2, yMax, 0],
    [1.2, yMin, 0],
  ];
  const rightBox: WireSegment = [
    [-5.2, yMin, 0],
    [-1.2, yMin, 0],
    [-1.2, yMax, 0],
    [-5.2, yMax, 0],
    [-5.2, yMin, 0],
  ];
  return [leftBox, rightBox];
}

/**
 * Tunneling commitment plane wireframe at y = 23.8 ft (x in [-2.5, 2.5], z in [1.0, 5.0]).
 */
export function tunnelingPlaneSegments(): WireSegment[] {
  const y = 23.8;
  return [
    [
      [-2.5, y, 1.0],
      [2.5, y, 1.0],
      [2.5, y, 5.0],
      [-2.5, y, 5.0],
      [-2.5, y, 1.0],
    ],
  ];
}

/**
 * Full diamond spatial reference wireframe combining strike zone rectangle,
 * home plate pentagon, pitcher rubber, mound circle, and left/right batter's boxes.
 */
export function diamondWireframeSegments(): WireSegment[] {
  return [
    ...strikeZoneSegments(),
    ...pitcherRubberSegments(),
    ...moundCircleSegments(),
    ...battersBoxesSegments(),
  ];
}

/**
 * DataFilterExtension props are attached at runtime by the `extensions` prop;
 * deck.gl's base typings don't include them, so the filtered props are cast.
 */
type FilteredPathProps<D> = Partial<Omit<PathLayerProps<D>, "data">> & {
  getFilterValue: AccessorFunction<D, [number, number, number, number]>;
  filterRange: [[number, number], [number, number], [number, number], [number, number]];
};

export type ZoneFilter = "all" | "in_zone" | "out_of_zone";
export type OutcomeFilter = "all" | "swings" | "whiffs";

export interface BuildLayersOpts {
  pitches: PitchDatum[];
  speedRange: [number, number];
  /** Optional extra channels; default open (match everything). */
  hBreakRange?: [number, number];
  vBreakRange?: [number, number];
  plateXRange?: [number, number];
  plateZRange?: [number, number];
  zoneFilter?: ZoneFilter;
  outcomeFilter?: OutcomeFilter;
  /**
   * Selected pitch-type codes. When provided (and non-empty), the 4th GPU
   * filter channel carries set membership per datum and the type range
   * narrows to [0.5, 1.5]. Data is still never filtered in JavaScript.
   */
  selectedTypes?: ReadonlySet<string> | null;
  /**
   * Hover/click pick handler for the trajectory layer (pickable). Picking
   * is deck.gl GPU picking; it never changes filter uniforms or data.
   */
  onHover?: (info: PickingInfo<PitchDatum>) => void;
  /**
   * Currently picked pitch datum (hover/click). Drives a per-datum GPU width
   * accessor that emphasizes the hovered trajectory — a layer attribute
   * accessor, NOT CPU-side filtering; filter uniforms are untouched.
   */
  picked?: PitchDatum | null;
  flightProgress?: number;
  showTunneling?: boolean;
}

/** Base trajectory width in meters (the un-picked line width). */
export const TRAJECTORY_WIDTH = 0.08;
/** Width multiplier applied to the picked trajectory. */
export const PICKED_WIDTH_MULTIPLIER = 2.5;

/**
 * Full layer set for the visualizer. Filtering is 100% GPU-side: pitch data
 * is passed unfiltered and the slider/type selections land in
 * DataFilterExtension uniforms (TDD §5.3 invariant — zero per-frame JS
 * filtering).
 */
export function buildLayers(opts: BuildLayersOpts) {
  const {
    pitches,
    speedRange,
    hBreakRange,
    vBreakRange,
    plateXRange,
    plateZRange,
    zoneFilter,
    outcomeFilter,
    selectedTypes,
    onHover,
    picked,
    flightProgress,
    showTunneling,
  } = opts;
  const ext = dataFilterExtension();

  const hasTypeFilter = Boolean(selectedTypes && selectedTypes.size > 0);
  const hasZoneFilter = zoneFilter === "in_zone" || zoneFilter === "out_of_zone";
  const hasOutcomeFilter = outcomeFilter === "swings" || outcomeFilter === "whiffs";
  const anyCriteriaActive = hasTypeFilter || hasZoneFilter || hasOutcomeFilter;

  const typeRange: [number, number] = anyCriteriaActive ? [0.5, 1.5] : OPEN_RANGE;
  const xRange = plateXRange ?? hBreakRange ?? OPEN_RANGE;
  const zRange = plateZRange ?? vBreakRange ?? OPEN_RANGE;

  const filteredProps: FilteredPathProps<PitchDatum> = {
    getFilterValue: (d) => {
      const px = d.plateX ?? d.pfxX ?? 0;
      const pz = d.plateZ ?? d.pfxZ ?? 0;
      const typePass = !hasTypeFilter || selectedTypes!.has(d.pitchType);
      const zonePass =
        !hasZoneFilter ||
        (zoneFilter === "in_zone" ? isInsideStrikeZone(px, pz) : !isInsideStrikeZone(px, pz));
      const outcomePass =
        !hasOutcomeFilter ||
        (outcomeFilter === "swings" ? Boolean(d.isSwing) : Boolean(d.isWhiff));
      const mask = typePass && zonePass && outcomePass ? 1 : 0;
      return [d.releaseSpeed, px, pz, mask];
    },
    filterRange: filterRange(speedRange, xRange, zRange, typeRange),
  };
  const layers: (PathLayer<any> | ScatterplotLayer<any>)[] = [
    new PathLayer<PitchDatum>({
      id: "pitch-trajectories",
      pickable: true,
      onHover,
      coordinateSystem: "cartesian" as never,
      data: pitches,
      // path is a flat 60-point [x,y,z] array — consumed directly, zero-copy.
      getPath: (d) => d.path,
      getColor: (d) => [...pitchColor(d.pitchType), 220],
      getWidth: (d) => (d === picked ? TRAJECTORY_WIDTH * PICKED_WIDTH_MULTIPLIER : TRAJECTORY_WIDTH),
      widthUnits: "meters",
      widthMinPixels: 1.5,
      opacity: 0.9,
      ...filteredProps,
      extensions: [ext],
      updateTriggers: {
        filterRange: [speedRange, xRange, zRange, typeRange],
        getFilterValue: [selectedTypes ?? null, zoneFilter ?? "all", outcomeFilter ?? "all"],
        getWidth: picked ?? null,
      },
    }),
    new PathLayer<WireSegment>({
      id: "strike-zone",
      coordinateSystem: "cartesian" as never,
      data: diamondWireframeSegments(),
      getPath: (s) => s,
      getColor: [255, 255, 255],
      getWidth: 0.03,
      widthUnits: "meters",
      widthMinPixels: 1,
      opacity: 0.85,
    }),
  ];

  if (showTunneling) {
    layers.push(
      new PathLayer<WireSegment>({
        id: "tunneling-plane",
        coordinateSystem: "cartesian" as never,
        data: tunnelingPlaneSegments(),
        getPath: (s) => s,
        getColor: [255, 215, 0],
        getWidth: 0.03,
        widthUnits: "meters",
        widthMinPixels: 1,
        opacity: 0.85,
      }),
    );
  }

  if (flightProgress !== undefined) {
    layers.push(
      new ScatterplotLayer<PitchDatum>({
        id: "baseball-markers",
        coordinateSystem: "cartesian" as never,
        data: pitches,
        getPosition: (d: PitchDatum): [number, number, number] => {
          const idx = Math.min(59, Math.max(0, Math.floor(flightProgress * 59)));
          const offset = idx * 3;
          if (d.path && d.path.length >= offset + 3) {
            return [d.path[offset], d.path[offset + 1], d.path[offset + 2]];
          }
          return [0, 0, 0];
        },
        getRadius: 0.1,
        radiusUnits: "meters",
        stroked: true,
        filled: true,
        getFillColor: [255, 255, 255, 240],
        getLineColor: (d: PitchDatum) => [...pitchColor(d.pitchType), 255],
        lineWidthMinPixels: 1.5,
        extensions: [ext],
        ...filteredProps,
        updateTriggers: {
          getPosition: flightProgress,
          getFilterValue: [selectedTypes ?? null, zoneFilter ?? "all", outcomeFilter ?? "all"],
          filterRange: [speedRange, xRange, zRange, typeRange],
        },
      } as never),
    );
  }

  return layers;
}
