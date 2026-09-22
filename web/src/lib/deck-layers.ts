/**
 * Deck.gl layer definitions (TDD §5.3).
 *
 * GPU-side filtering: slider signals bind straight to DataFilterExtension
 * filter ranges — no JavaScript array filtering on the interaction path.
 */
import { DataFilterExtension } from "@deck.gl/extensions";
import { PathLayer, ScatterplotLayer, PolygonLayer, type PathLayerProps } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import { type AccessorFunction } from "@deck.gl/core";
import type { OrbitViewState } from "@deck.gl/core";
import {
  trajectoryFlat,
  ghostTrajectoryFlat,
  breakVectorSegment,
  commitmentPosition,
  flightTime,
  positionAt,
  type PitchKinematics,
  type BreakVector,
} from "./kinematics";
import { tunnelingEnvelopeSegments, type ArsenalCentroid } from "./arsenal";
import {
  computeCollision,
  projectBattedTrajectory,
  CONTACT_QUALITY_COLORS,
} from "./collision";
import type { ReleaseDispersion } from "./dispersion";
import type { HeatmapCell } from "./heatmap";

export const ORBIT_TARGET: [number, number, number] = [0, 14, 1.8];
export const INITIAL_VIEW: OrbitViewState = {
  target: ORBIT_TARGET,
  rotationX: 8,
  rotationOrbit: 0,
  zoom: 4.8,
};

export interface PitchDatum {
  path: Float32Array;
  ghostPath?: Float32Array;
  releaseSpeed: number;
  pfxX: number;
  pfxZ: number;
  plateX: number;
  plateZ: number;
  pitchType: string;
  isSwing?: number;
  isWhiff?: number;
  spinRate?: number;
  extension?: number;
  szTop?: number;
  szBot?: number;
  kinematics?: PitchKinematics;
  breakVector?: BreakVector;
  commitmentPoint?: [number, number, number];
  /** Identity, when the Arrow table carries it (drives the player card and its MLB links). */
  pitcherId?: number;
  batterId?: number;
  gameId?: number;
  pitchId?: string;
  /** MLB per-pitch video id; real data only. */
  playId?: string;
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

/** Check whether a coordinate at the plate is inside the rulebook or batter-specific strike zone. */
export function isInsideStrikeZone(
  plateX: number,
  plateZ: number,
  szTop: number = STRIKE_ZONE.zMax,
  szBot: number = STRIKE_ZONE.zMin,
): boolean {
  return (
    Math.abs(plateX) <= STRIKE_ZONE.halfWidth &&
    plateZ >= szBot &&
    plateZ <= szTop
  );
}

/**
 * Batter-specific strike zone outline wireframe at y = 1.417 ft.
 */
export function batterStrikeZoneSegments(
  szTop: number = STRIKE_ZONE.zMax,
  szBot: number = STRIKE_ZONE.zMin,
): WireSegment[] {
  const { y, halfWidth: w } = STRIKE_ZONE;
  return [
    [
      [-w, y, szBot],
      [w, y, szBot],
      [w, y, szTop],
      [-w, y, szTop],
      [-w, y, szBot],
    ],
  ];
}

/**
 * Camera viewpoint presets (OrbitView view states, feet / degrees).
 * Catcher looks from behind the plate; Pitcher from the mound; Batter looks
 * from the batter's box straight toward the mound; Overhead is top-down;
 * Side is the dugout line. Zoom follows deck.gl OrbitView scale.
 */
export const CAMERA_VIEWS = {
  Catcher: { target: [0, 14, 1.8], rotationX: 8, rotationOrbit: 0, zoom: 4.8 },
  Pitcher: { target: [0, 24, 2.5], rotationX: 12, rotationOrbit: 180, zoom: 3.7 },
  Batter: { target: [2.5, 24, 1.2], rotationX: 9, rotationOrbit: 8, zoom: 3.9 },
  Overhead: { target: [0, 31, 0], rotationX: 90, rotationOrbit: 90, zoom: 3.9 },
  Side: { target: [0, 31, 3.0], rotationX: 0, rotationOrbit: 90, zoom: 3.9 },
} as const satisfies Record<string, OrbitViewState>;

/**
 * Tighter Catcher framing used while the strike-zone heatmap is on (Chase Map):
 * the zone fills the canvas. Kept separate so ghost-break / corpus-slice keep
 * the shared Catcher preset.
 */
export const CATCHER_HEATMAP_VIEW = {
  target: [0, 14, 1.6],
  rotationX: 8,
  rotationOrbit: 0,
  zoom: 5.0,
} as const satisfies OrbitViewState;

/** Camera to render: Catcher swaps to the heatmap framing when the heatmap is on. */
export function effectiveViewState(
  vs: OrbitViewState | null | undefined,
  showHeatmap: boolean | undefined,
): OrbitViewState | null | undefined {
  return showHeatmap && vs === CAMERA_VIEWS.Catcher ? CATCHER_HEATMAP_VIEW : vs;
}

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
  showGhostBreak?: boolean;
  showReleasePoints?: boolean;
  showPlateCrossings?: boolean;
  pairedTypes?: [string, string] | null;
  arsenalCentroids?: Map<string, ArsenalCentroid> | null;
  showContactSim?: boolean;
  batSpeed?: number;
  attackAngleDeg?: number;
  showDispersion?: boolean;
  releaseDispersion?: ReleaseDispersion | null;
  showHeatmap?: boolean;
  heatmapCells?: HeatmapCell[] | null;
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
    showGhostBreak,
    showReleasePoints,
    showPlateCrossings,
    pairedTypes,
    arsenalCentroids,
    showContactSim,
    batSpeed,
    attackAngleDeg,
    showDispersion,
    releaseDispersion,
    showHeatmap,
    heatmapCells,
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
        (zoneFilter === "in_zone"
          ? isInsideStrikeZone(px, pz, d.szTop, d.szBot)
          : !isInsideStrikeZone(px, pz, d.szTop, d.szBot));
      const outcomePass =
        !hasOutcomeFilter ||
        (outcomeFilter === "swings" ? Boolean(d.isSwing) : Boolean(d.isWhiff));
      const mask = typePass && zonePass && outcomePass ? 1 : 0;
      return [d.releaseSpeed, px, pz, mask];
    },
    filterRange: filterRange(speedRange, xRange, zRange, typeRange),
  };
  const layers: (PathLayer<any> | ScatterplotLayer<any> | PolygonLayer<any>)[] = [
    new PathLayer<PitchDatum>({
      id: "pitch-trajectories",
      pickable: true,
      onHover,
      onClick: onHover,
      coordinateSystem: "cartesian" as never,
      data: pitches,
      // path is a flat 60-point [x,y,z] array — consumed directly, zero-copy.
      getPath: (d) => d.path,
      getColor: (d) => [...pitchColor(d.pitchType), 220],
      getWidth: TRAJECTORY_WIDTH,
      widthUnits: "meters",
      widthMinPixels: 1.5,
      billboard: true,
      // Fade the bundle when the heatmap is on so the zone stays legible.
      opacity: showHeatmap && heatmapCells && heatmapCells.length > 0 ? 0.35 : 0.9,
      ...filteredProps,
      extensions: [ext],
      updateTriggers: {
        filterRange: [speedRange, xRange, zRange, typeRange],
        getFilterValue: [selectedTypes ?? null, zoneFilter ?? "all", outcomeFilter ?? "all"],
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
      new ScatterplotLayer<PitchDatum>({
        id: "tunnel-points",
        coordinateSystem: "cartesian" as never,
        data: pitches,
        getPosition: (d: PitchDatum): [number, number, number] => {
          if (d.commitmentPoint) return d.commitmentPoint;
          if (d.kinematics) return commitmentPosition(d.kinematics);
          return [0, 23.8, 3.0];
        },
        getRadius: 0.08,
        radiusUnits: "meters",
        stroked: true,
        filled: true,
        getFillColor: (d: PitchDatum) => [...pitchColor(d.pitchType), 190],
        getLineColor: [255, 255, 255, 200],
        lineWidthMinPixels: 1,
        extensions: [ext],
        ...filteredProps,
        updateTriggers: {
          getFilterValue: [selectedTypes ?? null, zoneFilter ?? "all", outcomeFilter ?? "all"],
          filterRange: [speedRange, xRange, zRange, typeRange],
        },
      } as never),
    );
  }

  if (showGhostBreak) {
    layers.unshift(
      new PathLayer<PitchDatum>({
        id: "ghost-trajectories",
        coordinateSystem: "cartesian" as never,
        data: pitches,
        getPath: (d) => d.ghostPath ?? (d.kinematics ? ghostTrajectoryFlat(d.kinematics) : d.path),
        getColor: [200, 220, 240, 80],
        getWidth: TRAJECTORY_WIDTH * 0.75,
        widthUnits: "meters",
        widthMinPixels: 1.0,
        billboard: true,
        opacity: 0.6,
        ...filteredProps,
        extensions: [ext],
        updateTriggers: {
          filterRange: [speedRange, xRange, zRange, typeRange],
          getFilterValue: [selectedTypes ?? null, zoneFilter ?? "all", outcomeFilter ?? "all"],
        },
      }),
    );
  }

  if (picked?.kinematics) {
    const k = picked.kinematics;
    layers.push(
      new PathLayer<PitchDatum>({
        id: "picked-ghost-trajectory",
        coordinateSystem: "cartesian" as never,
        data: [picked],
        getPath: () => picked.ghostPath ?? ghostTrajectoryFlat(k),
        getColor: [220, 240, 255, 230],
        getWidth: TRAJECTORY_WIDTH * 1.5,
        widthUnits: "meters",
        widthMinPixels: 2.0,
        billboard: true,
        opacity: 0.95,
      }),
      new PathLayer<WireSegment>({
        id: "picked-break-vector",
        coordinateSystem: "cartesian" as never,
        data: [breakVectorSegment(k)],
        getPath: (s) => s,
        getColor: [255, 215, 0],
        getWidth: 0.04,
        widthUnits: "meters",
        widthMinPixels: 2.5,
        opacity: 1.0,
      }),
      new ScatterplotLayer<PitchDatum>({
        id: "picked-release-point",
        coordinateSystem: "cartesian" as never,
        data: [picked],
        getPosition: () => [k.x0, k.y0, k.z0],
        getRadius: 0.18,
        radiusUnits: "meters",
        stroked: true,
        filled: true,
        getFillColor: [255, 215, 0, 240],
        getLineColor: [255, 255, 255, 255],
        lineWidthMinPixels: 2.5,
      } as never),
      new ScatterplotLayer<PitchDatum>({
        id: "picked-tunnel-point",
        coordinateSystem: "cartesian" as never,
        data: [picked],
        getPosition: () => picked.commitmentPoint ?? commitmentPosition(k),
        getRadius: 0.14,
        radiusUnits: "meters",
        stroked: true,
        filled: true,
        getFillColor: [255, 215, 0, 240],
        getLineColor: [255, 255, 255, 255],
        lineWidthMinPixels: 2.0,
      } as never),
    );
  }

  if (picked) {
    layers.push(
      new PathLayer<PitchDatum>({
        id: "picked-pitch-highlight",
        coordinateSystem: "cartesian" as never,
        data: [picked],
        getPath: (d) => d.path,
        getColor: (d) => [...pitchColor(d.pitchType), 255],
        getWidth: TRAJECTORY_WIDTH * PICKED_WIDTH_MULTIPLIER,
        widthUnits: "meters",
        widthMinPixels: 2.5,
        billboard: true,
        opacity: 1.0,
      }),
    );
    const px = picked.plateX ?? picked.pfxX ?? 0;
    const pz = picked.plateZ ?? picked.pfxZ ?? 2.5;
    layers.push(
      new ScatterplotLayer<PitchDatum>({
        id: "picked-plate-crossing",
        coordinateSystem: "cartesian" as never,
        data: [picked],
        getPosition: () => [px, STRIKE_ZONE.y, pz],
        getRadius: 0.1,
        radiusUnits: "meters",
        stroked: true,
        filled: true,
        getFillColor: [255, 215, 0, 240],
        getLineColor: [255, 255, 255, 255],
        lineWidthMinPixels: 2.0,
      } as never),
    );
    if (picked.szTop != null && picked.szBot != null) {
      layers.push(
        new PathLayer<WireSegment>({
          id: "picked-batter-strike-zone",
          coordinateSystem: "cartesian" as never,
          data: batterStrikeZoneSegments(picked.szTop, picked.szBot),
          getPath: (s) => s,
          getColor: [0, 220, 255],
          getWidth: 0.04,
          widthUnits: "meters",
          widthMinPixels: 2.0,
          opacity: 0.9,
        }),
      );
    }
  }

  if (showPlateCrossings) {
    layers.push(
      new ScatterplotLayer<PitchDatum>({
        id: "plate-crossings",
        coordinateSystem: "cartesian" as never,
        data: pitches,
        getPosition: (d: PitchDatum): [number, number, number] => [
          d.plateX ?? d.pfxX ?? 0,
          STRIKE_ZONE.y,
          d.plateZ ?? d.pfxZ ?? 2.5,
        ],
        getRadius: 0.06,
        radiusUnits: "meters",
        stroked: true,
        filled: true,
        getFillColor: (d: PitchDatum) => [...pitchColor(d.pitchType), 190],
        getLineColor: [255, 255, 255, 200],
        lineWidthMinPixels: 1,
        extensions: [ext],
        ...filteredProps,
        updateTriggers: {
          getFilterValue: [selectedTypes ?? null, zoneFilter ?? "all", outcomeFilter ?? "all"],
          filterRange: [speedRange, xRange, zRange, typeRange],
        },
      } as never),
    );
  }

  if (showReleasePoints) {
    layers.push(
      new ScatterplotLayer<PitchDatum>({
        id: "release-points",
        coordinateSystem: "cartesian" as never,
        data: pitches,
        getPosition: (d: PitchDatum): [number, number, number] => {
          if (d.kinematics) {
            return [d.kinematics.x0, d.kinematics.y0, d.kinematics.z0];
          }
          if (d.path && d.path.length >= 3) {
            return [d.path[0], d.path[1], d.path[2]];
          }
          return [0, 55, 5.5];
        },
        getRadius: 0.12,
        radiusUnits: "meters",
        stroked: true,
        filled: true,
        getFillColor: (d: PitchDatum) => [...pitchColor(d.pitchType), 200],
        getLineColor: [255, 255, 255, 200],
        lineWidthMinPixels: 1.5,
        extensions: [ext],
        ...filteredProps,
        updateTriggers: {
          getFilterValue: [selectedTypes ?? null, zoneFilter ?? "all", outcomeFilter ?? "all"],
          filterRange: [speedRange, xRange, zRange, typeRange],
        },
      } as never),
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
        billboard: true,
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

  if (pairedTypes && arsenalCentroids) {
    const c1 = arsenalCentroids.get(pairedTypes[0]);
    const c2 = arsenalCentroids.get(pairedTypes[1]);
    if (c1 && c2) {
      layers.push(
        new PathLayer<WireSegment>({
          id: "paired-tunnel-envelope",
          coordinateSystem: "cartesian" as never,
          data: tunnelingEnvelopeSegments(c1, c2),
          getPath: (s) => s,
          getColor: [255, 180, 0, 220],
          getWidth: 0.04,
          widthUnits: "meters",
          widthMinPixels: 2.0,
          opacity: 0.9,
        }),
        new PathLayer<ArsenalCentroid>({
          id: "paired-centroid-paths",
          coordinateSystem: "cartesian" as never,
          data: [c1, c2],
          getPath: (c) => trajectoryFlat(c.kinematics),
          getColor: (c) => [...pitchColor(c.pitchType), 240],
          getWidth: TRAJECTORY_WIDTH * 1.8,
          widthUnits: "meters",
          widthMinPixels: 2.5,
          opacity: 0.95,
        }),
      );
    }
  }

  if (showContactSim && picked && picked.kinematics) {
    const col = computeCollision(picked.kinematics, batSpeed ?? 75.0, attackAngleDeg ?? 10.0);
    if (col.contactQuality !== "Whiff" && col.distanceFt > 0) {
      const tEnd = flightTime(picked.kinematics);
      const origin = positionAt(picked.kinematics, tEnd);
      const battedTrajectory = projectBattedTrajectory(
        origin,
        col.exitSpeedMph,
        col.launchAngleDeg,
        col.sprayAngleDeg,
        col.hangTimeS,
        40
      );
      const color = CONTACT_QUALITY_COLORS[col.contactQuality] ?? [255, 255, 255];
      const landingPt = battedTrajectory[battedTrajectory.length - 1];

      layers.push(
        new PathLayer<[number, number, number][]>({
          id: "simulated-batted-trajectory",
          coordinateSystem: "cartesian" as never,
          data: [battedTrajectory],
          getPath: (d: [number, number, number][]) => d,
          getColor: [...color, 240],
          getWidth: TRAJECTORY_WIDTH * 1.6,
          widthUnits: "meters",
          widthMinPixels: 2.5,
          opacity: 0.95,
        }),
        new ScatterplotLayer<[number, number, number]>({
          id: "simulated-landing-spot",
          coordinateSystem: "cartesian" as never,
          data: [landingPt],
          getPosition: (p: [number, number, number]) => p,
          getRadius: 0.35,
          radiusUnits: "meters",
          stroked: true,
          filled: true,
          getFillColor: [...color, 180],
          getLineColor: [255, 255, 255, 240],
          lineWidthMinPixels: 1.5,
        } as never),
      );
    }
  }

  if (showDispersion && releaseDispersion && releaseDispersion.wireframeSegments.length > 0) {
    layers.push(
      new PathLayer<[number, number, number][]>({
        id: "release-dispersion-ellipsoid",
        coordinateSystem: "cartesian" as never,
        data: releaseDispersion.wireframeSegments,
        getPath: (d: [number, number, number][]) => d,
        getColor: [255, 215, 0, 220],
        getWidth: 0.03,
        widthUnits: "meters",
        widthMinPixels: 1.5,
        opacity: 0.85,
      }),
    );
  }

  if (showHeatmap && heatmapCells && heatmapCells.length > 0) {
    layers.push(
      new PolygonLayer<HeatmapCell>({
        id: "strike-zone-heatmap",
        coordinateSystem: "cartesian" as never,
        data: heatmapCells,
        // SolidPolygon tessellates in the layer's x/y plane; the cells live in
        // the plate plane (x, PLATE_Y, z), so feed [x, z, y] and swap y/z back
        // with a modelMatrix (a pure axis swap, rendering-only).
        getPolygon: (c: HeatmapCell) => c.polygon.map(([x, y, z]) => [x, z, y] as [number, number, number]),
        modelMatrix: [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1],
        getFillColor: (c: HeatmapCell) => c.color,
        getLineColor: [255, 255, 255, 60],
        // Default line width is 1 world unit (1 ft): pin outlines to hairlines.
        getLineWidth: 1,
        lineWidthUnits: "pixels",
        lineWidthMinPixels: 1.0,
        stroked: true,
        filled: true,
        opacity: 0.85,
        // Draw over the pitch-path bundle instead of being depth-occluded by it.
        parameters: { depthCompare: "always" } as never,
      }),
    );
  }

  return layers;
}

