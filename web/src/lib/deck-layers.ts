/**
 * Deck.gl layer definitions (TDD §5.3).
 *
 * GPU-side filtering: slider signals bind straight to DataFilterExtension
 * filter ranges — no JavaScript array filtering on the interaction path.
 */
import { DataFilterExtension } from "@deck.gl/extensions";
import { PathLayer, type PathLayerProps } from "@deck.gl/layers";
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
  pitchType: string;
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
 * Pitch-type palette: 4-seam FF, slider SL, changeup CH, curveball CU,
 * cutter FC, sinker SI, sweeper ST, plus common Statcast codes.
 * Unknown codes fall back to gray.
 */
export const PITCH_COLORS: Readonly<Record<string, [number, number, number]>> = Object.freeze({
  FF: [230, 57, 70], // 4-seam fastball — red
  FT: [241, 133, 44], // two-seam — orange
  SI: [184, 115, 51], // sinker — rust
  FC: [255, 196, 0], // cutter — gold
  SL: [67, 170, 139], // slider — teal
  ST: [38, 132, 255], // sweeper — blue
  SW: [38, 132, 255], // sweeper (alt code)
  CU: [139, 81, 255], // curveball — violet
  KC: [97, 62, 178], // knuckle curve — deep violet
  CS: [72, 61, 139], // slow curve — slate violet
  CH: [42, 157, 244], // changeup — sky blue
  FS: [0, 181, 204], // splitter — cyan
  FO: [0, 181, 204], // forkball — cyan
  KN: [199, 199, 111], // knuckleball — olive
  EP: [155, 205, 155], // eephus — pale green
  SC: [188, 140, 255], // screwball — light violet
});

export const FALLBACK_COLOR: [number, number, number] = [160, 160, 160];

/** Distinct RGB per pitch type code, with a neutral fallback. */
export function pitchColor(pitchType: string): [number, number, number] {
  return PITCH_COLORS[pitchType?.toUpperCase()] ?? FALLBACK_COLOR;
}

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
 * DataFilterExtension props are attached at runtime by the `extensions` prop;
 * deck.gl's base typings don't include them, so the filtered props are cast.
 */
type FilteredPathProps<D> = Partial<Omit<PathLayerProps<D>, "data">> & {
  getFilterValue: AccessorFunction<D, [number, number, number, number]>;
  filterRange: [[number, number], [number, number], [number, number], [number, number]];
};

export interface BuildLayersOpts {
  pitches: PitchDatum[];
  speedRange: [number, number];
  /** Optional extra channels; default open (match everything). */
  hBreakRange?: [number, number];
  vBreakRange?: [number, number];
  /**
   * Selected pitch-type codes. When provided (and non-empty), the 4th GPU
   * filter channel carries set membership per datum and the type range
   * narrows to [0.5, 1.5]. Data is still never filtered in JavaScript.
   */
  selectedTypes?: ReadonlySet<string> | null;
}

/**
 * Full layer set for the visualizer. Filtering is 100% GPU-side: pitch data
 * is passed unfiltered and the slider/type selections land in
 * DataFilterExtension uniforms (TDD §5.3 invariant — zero per-frame JS
 * filtering).
 */
export function buildLayers(opts: BuildLayersOpts) {
  const { pitches, speedRange, hBreakRange, vBreakRange, selectedTypes } = opts;
  const ext = dataFilterExtension();
  const hasSelection = !!selectedTypes && selectedTypes.size > 0;
  const typeRange: [number, number] = hasSelection ? [0.5, 1.5] : OPEN_RANGE;
  const filteredProps: FilteredPathProps<PitchDatum> = {
    getFilterValue: (d) => [
      d.releaseSpeed,
      d.pfxX,
      d.pfxZ,
      hasSelection ? (selectedTypes.has(d.pitchType) ? 1 : 0) : 1,
    ],
    filterRange: filterRange(speedRange, hBreakRange, vBreakRange, typeRange),
  };
  const layers = [
    new PathLayer<PitchDatum>({
      id: "pitch-trajectories",
      coordinateSystem: "cartesian" as never,
      data: pitches,
      // path is a flat 60-point [x,y,z] array — consumed directly, zero-copy.
      getPath: (d) => d.path,
      getColor: (d) => [...pitchColor(d.pitchType), 220],
      getWidth: 0.08,
      widthUnits: "meters",
      widthMinPixels: 1.5,
      opacity: 0.9,
      ...filteredProps,
      extensions: [ext],
      updateTriggers: {
        filterRange: [speedRange, hBreakRange, vBreakRange, typeRange],
        getFilterValue: selectedTypes ?? null,
      },
    }),
    new PathLayer<WireSegment>({
      id: "strike-zone",
      coordinateSystem: "cartesian" as never,
      data: strikeZoneSegments(),
      getPath: (s) => s,
      getColor: [255, 255, 255],
      getWidth: 0.03,
      widthUnits: "meters",
      widthMinPixels: 1,
      opacity: 0.85,
    }),
  ];
  return layers;
}
