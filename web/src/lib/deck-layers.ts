/**
 * Deck.gl layer definitions (TDD §5.3).
 *
 * GPU-side filtering: slider signals bind straight to DataFilterExtension
 * filter ranges — no JavaScript array filtering on the interaction path.
 */
import { DataFilterExtension } from "@deck.gl/extensions";
import { PathLayer, ScatterplotLayer, PolygonLayer } from "@deck.gl/layers";
import { TripsLayer } from "@deck.gl/geo-layers";
import { COORDINATE_SYSTEM } from "@deck.gl/core";
import type { AccessorFunction, OrbitViewState, PickingInfo } from "@deck.gl/core";
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
import { sprayColor, sprayPoint } from "./spray";

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
  /** Pitcher extension in ft (from the optional `extension` column); undefined when unknown. */
  extension?: number;
  szTop?: number;
  szBot?: number;
  kinematics?: PitchKinematics;
  breakVector?: BreakVector;
  commitmentPoint?: [number, number, number];
  /** Identity, when the Arrow table carries it (drives the player card and its MLB links). */
  pitcherId?: number;
  batterId?: number;
  /** Display names from real-data assets; ids remain the canonical link keys. */
  pitcherName?: string;
  batterName?: string;
  gameId?: number;
  pitchId?: string;
  /** MLB per-pitch video id; real data only. */
  playId?: string;
  /** Plate-appearance and pitch order within the game; nullable in older files. */
  atBatNumber?: number;
  pitchNumber?: number;
  /** Count when the pitch was thrown (drives the count cut in the filter panel). */
  balls?: number;
  strikes?: number;
  /**
   * MLB's own zone number for the pitch: 1-9 are the nine cells of the strike
   * zone, 11-14 the four cells around it. Carried from the feed rather than
   * derived — the league's cell edges are not published, and its 1-9 disagrees
   * with a plain plate box on about 4% of pitches, which is why the outside
   * cells cannot be reconstructed from plate_x/plate_z.
   */
  zone?: number;
  /**
   * The pitch's outcome as one canonical code (the pipeline's PITCH_RESULTS):
   * "called_strike", "ball", "ball_in_dirt", "foul", "hit_into_play", ...
   * isSwing/isWhiff cannot recover it — a called strike, a ball, a hit batter
   * and a pitchout are all (0, 0), about half the corpus.
   */
  pitchResult?: string;
  /**
   * Outcome of the plate appearance this pitch belongs to ("Strikeout",
   * "Single", "Home Run", ...), repeated on every pitch of that appearance —
   * Savant's CSV does the same. It is NOT what this pitch did; that is
   * pitchResult. Present verbatim, so it is shown as the feed spells it.
   */
  playEvent?: string;
  /**
   * Observed batted-ball data (MLB's contact columns): measured exit velocity
   * (mph), launch angle (degrees), projected distance (feet) and batted-ball
   * class. Undefined unless the pitch was put in play.
   */
  launchSpeed?: number;
  launchAngle?: number;
  hitDistance?: number;
  bbType?: string;
  /**
   * Savant's hit-chart coordinates (250x250 image space, home near (125, 205));
   * undefined unless the pitch was put in play. The spray layer turns them into
   * scene feet with `sprayPoint`.
   */
  hcX?: number;
  hcY?: number;
}

export const FILTER_SIZE = 4;

/**
 * Strike zone geometry (feet, Z-up). Plate front face at y = 1.417 ft;
 * zone is 17 in (1.4167 ft) wide, knees (1.5 ft) to letters (3.5 ft).
 */
export const STRIKE_ZONE = {
  y: 1.417,
  // The plate's half-width (17 in / 2) plus the ball's radius, so a pitch whose
  // edge clips the plate is inside — the same effective width the cells below cut.
  halfWidth: 0.83,
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
 * Tighter Catcher framing used while the strike-zone heatmap is on so the zone
 * fills the canvas. Kept separate from the shared Catcher camera preset.
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

/** Singleton GPU uniform filter extension shared by all filtered layers (filterSize=4). */
const FILTER_EXTENSION = new DataFilterExtension({ filterSize: FILTER_SIZE });
export function dataFilterExtension() {
  return FILTER_EXTENSION;
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
  // Home plate: 17 in front edge on the zone plane, 8.5 in sides, then two
  // 12 in edges meeting at the back point, 17 in behind the front (y = 0).
  const hpW = 17 / 24;
  const hpSide = 8.5 / 12;
  const hpPoint = y - 17 / 12; // point extends toward catcher (negative y)
  const plate: WireSegment = [
    [-hpW, y, 0],
    [hpW, y, 0],
    [hpW, y - hpSide, 0],
    [0, hpPoint, 0],
    [-hpW, y - hpSide, 0],
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
type FilterRange4 = [[number, number], [number, number], [number, number], [number, number]];

export type ZoneFilter = "all" | "in_zone" | "out_of_zone";
export type OutcomeFilter = "all" | "swings" | "whiffs" | "balls" | "called_strikes";

/** The filter state shared by the GPU masks (buildLayers) and the CPU counts/panels (App). */
/** The nine in-zone cells, numbered left to right with the top row first. */
export type ZoneCell = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * Picker titles, in cell order. The columns are stated by x range rather than by
 * "inside/outside", because the app labels no left/right for the horizontal axis
 * anywhere else and inventing one here would be the only place it appears.
 */
export const ZONE_CELLS: readonly { cell: ZoneCell; row: number; col: number; title: string }[] = [
  { cell: 1, row: 0, col: 0, title: "High, x −0.83 to −0.28" },
  { cell: 2, row: 0, col: 1, title: "High, x −0.28 to 0.28" },
  { cell: 3, row: 0, col: 2, title: "High, x 0.28 to 0.83" },
  { cell: 4, row: 1, col: 0, title: "Middle, x −0.83 to −0.28" },
  { cell: 5, row: 1, col: 1, title: "Middle, x −0.28 to 0.28" },
  { cell: 6, row: 1, col: 2, title: "Middle, x 0.28 to 0.83" },
  { cell: 7, row: 2, col: 0, title: "Low, x −0.83 to −0.28" },
  { cell: 8, row: 2, col: 1, title: "Low, x −0.28 to 0.28" },
  { cell: 9, row: 2, col: 2, title: "Low, x 0.28 to 0.83" },
];

/**
 * MLB's own zone numbers, in the order the league reports them: the nine cells
 * of the strike zone, then the four around it. The control shows the numbers
 * themselves, because the app labels no left/right anywhere else and the
 * league's cell geometry is deliberately not published — inventing a name for
 * each cell would be the only place it appeared.
 */
export const LEAGUE_ZONES: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14];

export const LEAGUE_ZONE_TITLE =
  "MLB's own zone number for the pitch: 1-9 the nine cells of the strike zone, 11-14 the four cells around it";

/**
 * Which in-zone cell the pitch crossed, or null when it is outside the zone or
 * carries no plate location. The bounds are the ones `isInsideStrikeZone` uses —
 * the plate plus the ball's radius wide, the batter's own sz_bot..sz_top tall —
 * so a cell result and the "in zone" filter can never disagree. The zone's height
 * is cut into equal thirds and its width likewise; a pitch exactly on an edge
 * lands in the outer cell, matching the inclusive bounds above.
 */
export function zoneCell(
  plateX?: number,
  plateZ?: number,
  szTop?: number,
  szBot?: number,
): ZoneCell | null {
  if (plateX == null || plateZ == null) return null;
  if (!isInsideStrikeZone(plateX, plateZ, szTop, szBot)) return null;
  const top = szTop ?? STRIKE_ZONE.zMax;
  const bot = szBot ?? STRIKE_ZONE.zMin;
  if (!(top > bot)) return null;
  const half = STRIKE_ZONE.halfWidth;
  const col = Math.min(2, Math.max(0, Math.floor(((plateX + half) / (2 * half)) * 3)));
  // z grows upward, so the top row is the highest third.
  const row = Math.min(2, Math.max(0, Math.floor(((top - plateZ) / (top - bot)) * 3)));
  return (row * 3 + col + 1) as ZoneCell;
}

/** Game state when the pitch was thrown, as a disjoint cut of the count. */
export type CountBucket = "first" | "pitcher_ahead" | "hitter_ahead" | "even";

/** The four buckets in display order, phrased from the pitcher's point of view. */
export const COUNT_BUCKETS: readonly { bucket: CountBucket; label: string; title: string }[] = [
  { bucket: "first", label: "First pitch", title: "First pitch of the at-bat (0-0)" },
  { bucket: "pitcher_ahead", label: "Pitcher ahead", title: "More strikes than balls (0-1, 0-2, 1-2)" },
  {
    bucket: "hitter_ahead",
    label: "Hitter ahead",
    title: "More balls than strikes (1-0, 2-0, 3-0, 2-1, 3-1, 3-2)",
  },
  { bucket: "even", label: "Even", title: "Level count, not the first pitch (1-1, 2-2)" },
];

/**
 * Which side the count favours, or null when the row carries no count.
 * 0-0 is its own bucket: the first pitch of an at-bat is a different decision
 * from any other even count, which is why it is not just "even".
 */
/**
 * Every plate-appearance outcome present in the loaded pitches, alphabetical.
 * The picker is built from this, so it can only offer events the data has.
 */
export function distinctPlayEvents(pitches: readonly PitchDatum[]): string[] {
  const seen = new Set<string>();
  for (const p of pitches) if (p.playEvent) seen.add(p.playEvent);
  return [...seen].sort();
}

export function countBucket(balls?: number, strikes?: number): CountBucket | null {
  if (balls == null || strikes == null) return null;
  if (balls === 0 && strikes === 0) return "first";
  if (strikes > balls) return "pitcher_ahead";
  if (balls > strikes) return "hitter_ahead";
  return "even";
}

/**
 * Narrows the view to specific players' pitches — what the card's isolate
 * actions set. Either role may be set alone (only this pitcher / only this
 * batter) or both together, which is the matchup: this pitcher to this batter.
 */
export interface PlayerFilter {
  pitcher?: number;
  batter?: number;
}

export interface FilterOpts {
  speedRange: [number, number];
  playerFilter?: PlayerFilter | null;
  /** Empty or absent means every count; otherwise only these buckets show. */
  countBuckets?: ReadonlySet<CountBucket> | null;
  /** Empty or absent means every in-zone cell; pitches outside the zone are excluded by it. */
  zoneCells?: ReadonlySet<ZoneCell> | null;
  /** Empty or absent means every zone; selecting any restricts to the league's own numbers. */
  leagueZones?: ReadonlySet<number> | null;
  /** One plate-appearance outcome to keep every pitch of ("Strikeout", "Home Run", ...), or null for any. */
  playEvent?: string | null;
  plateXRange?: [number, number];
  plateZRange?: [number, number];
  zoneFilter?: ZoneFilter;
  outcomeFilter?: OutcomeFilter;
  selectedTypes?: ReadonlySet<string> | null;
}

type CriteriaOpts = Pick<
  FilterOpts,
  "zoneFilter" | "outcomeFilter" | "selectedTypes" | "playerFilter" | "countBuckets" | "zoneCells" | "leagueZones" |
  "playEvent"
>;

/**
 * Categorical criteria (type set, zone, outcome): the part of the filter that
 * rides the 4th GPU channel as a 0/1 mask. The batter-specific zone
 * (szTop/szBot) applies when the datum carries it; plateX falls back to pfxX.
 */
function passesCriteria(d: PitchDatum, opts: CriteriaOpts): boolean {
  // Options are read lazily: this runs once per pitch per filter change, the
  // categorical options are usually inactive, and destructuring all three up
  // front costs more than the comparisons that reject most pitches.
  // One player's pitches first: it rejects almost everything, so it pays to run
  // it before the other criteria.
  const playerFilter = opts.playerFilter;
  if (playerFilter) {
    if (playerFilter.pitcher != null && d.pitcherId !== playerFilter.pitcher) return false;
    if (playerFilter.batter != null && d.batterId !== playerFilter.batter) return false;
  }
  const zoneCells = opts.zoneCells;
  if (zoneCells && zoneCells.size > 0) {
    const cell = zoneCell(d.plateX ?? d.pfxX, d.plateZ ?? d.pfxZ, d.szTop, d.szBot);
    if (cell === null || !zoneCells.has(cell)) return false;
  }
  const leagueZones = opts.leagueZones;
  if (leagueZones && leagueZones.size > 0) {
    if (d.zone == null || !leagueZones.has(d.zone)) return false;
  }
  const countBuckets = opts.countBuckets;
  if (countBuckets && countBuckets.size > 0) {
    const bucket = countBucket(d.balls, d.strikes);
    if (bucket === null || !countBuckets.has(bucket)) return false;
  }
  const selectedTypes = opts.selectedTypes;
  if (selectedTypes && selectedTypes.size > 0 && !selectedTypes.has(d.pitchType)) return false;
  const zoneFilter = opts.zoneFilter;
  if (zoneFilter === "in_zone" || zoneFilter === "out_of_zone") {
    const px = d.plateX ?? d.pfxX ?? 0;
    const pz = d.plateZ ?? d.pfxZ ?? 0;
    const inside = isInsideStrikeZone(px, pz, d.szTop, d.szBot);
    if (zoneFilter === "in_zone" ? !inside : inside) return false;
  }
  const outcomeFilter = opts.outcomeFilter;
  if (outcomeFilter === "swings" && !d.isSwing) return false;
  if (outcomeFilter === "whiffs" && !d.isWhiff) return false;
  // Reads the stored result code, not a derivation: a pitch in the dirt is a
  // called ball, and only the code tells a called strike from a ball.
  if (outcomeFilter === "balls" && d.pitchResult !== "ball" && d.pitchResult !== "ball_in_dirt") return false;
  if (outcomeFilter === "called_strikes" && d.pitchResult !== "called_strike") return false;
  // At-bat level, not pitch level: this keeps EVERY pitch of the appearances that
  // ended in the chosen event, so the sequence that produced it stays together.
  const playEvent = opts.playEvent;
  if (playEvent != null && playEvent !== "" && d.playEvent !== playEvent) return false;
  return true;
}

/**
 * CPU mirror of the GPU filter: true when DataFilterExtension would draw `d`
 * for these options. Used for counts and analysis panels (memoized on state
 * change, never on the interaction/frame path). Ranges are inclusive, like the
 * GPU's [min, max] test.
 */
export function passesFilters(d: PitchDatum, opts: FilterOpts): boolean {
  // Index access, not array destructuring: destructuring walks the iterator
  // protocol once per pitch (thousands of times per filter change), which
  // measures ~20% slower than reading the two bounds directly.
  const speed = opts.speedRange;
  if (d.releaseSpeed < speed[0] || d.releaseSpeed > speed[1]) return false;
  const px = d.plateX ?? d.pfxX ?? 0;
  const pz = d.plateZ ?? d.pfxZ ?? 0;
  const xRange = opts.plateXRange;
  if (xRange !== undefined && (px < xRange[0] || px > xRange[1])) return false;
  const zRange = opts.plateZRange;
  if (zRange !== undefined && (pz < zRange[0] || pz > zRange[1])) return false;
  return passesCriteria(d, opts);
}

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
   * Currently picked pitch datum. When given, the picked-highlight layers
   * are appended (see pickedLayers); Visualizer builds them separately so a
   * hover never rebuilds the base layers.
   */
  picked?: PitchDatum | null;
  /** Flight playback position in [0, 1]; undefined draws the full paths. */
  flightProgress?: number;
  /** True while the flight animation runs: the trail (TripsLayer) is the only moving layer. */
  isPlaying?: boolean;
  showTunneling?: boolean;
  showGhostBreak?: boolean;
  showReleasePoints?: boolean;
  showPlateCrossings?: boolean;
  showSpray?: boolean;
  playerFilter?: PlayerFilter | null;
  countBuckets?: ReadonlySet<CountBucket> | null;
  zoneCells?: ReadonlySet<ZoneCell> | null;
  leagueZones?: ReadonlySet<number> | null;
  playEvent?: string | null;
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

/** Spray-dot radius in metres (the scene is in feet; keep the dots pitch-sized). */
const SPRAY_RADIUS = 0.9;

/**
 * Landing position in scene feet. Rows that cannot be placed get the origin and
 * a zero radius below, which draws nothing — ScatterplotLayer needs a position
 * for every row, and a NaN would corrupt the vertex buffer.
 */
function sprayPosition(d: PitchDatum): [number, number, number] {
  const p = sprayPoint(d.hcX, d.hcY, d.hitDistance);
  return p ? [p.x, p.y, 0] : [0, 0, 0];
}

function sprayRadius(d: PitchDatum): number {
  return sprayPoint(d.hcX, d.hcY, d.hitDistance) ? SPRAY_RADIUS : 0;
}

/** Base trajectory width in meters (the un-picked line width). */
export const TRAJECTORY_WIDTH = 0.08;
/** Width multiplier applied to the picked trajectory. */
export const PICKED_WIDTH_MULTIPLIER = 2.5;

/**
 * Point markers (plate crossings, release points, flight markers, ...) face the
 * camera and keep a pixel-sized outline. ScatterplotLayer's default outline is
 * 1 world unit (1 ft here) in meters, which turned every marker into a
 * foot-wide gray disc lying flat in the ground plane.
 */
export function markerStyle(outlinePx: number, minRadiusPx = 2) {
  return {
    billboard: true,
    lineWidthUnits: "pixels",
    getLineWidth: outlinePx,
    lineWidthMinPixels: outlinePx,
    radiusMinPixels: minRadiusPx,
  } as const;
}

/**
 * Props shared by every GPU-filtered layer: the four-channel filter value and
 * range, the extension, and the update triggers. The result is memoized on the
 * filter state so consecutive buildLayers calls (a hover, a playback frame)
 * hand deck.gl identical accessor and range references, and only real filter
 * changes re-evaluate attributes.
 */
export interface FilteredLayerProps {
  getFilterValue: AccessorFunction<PitchDatum, [number, number, number, number]>;
  filterRange: FilterRange4;
  extensions: [DataFilterExtension];
  updateTriggers: {
    filterRange: unknown[];
    getFilterValue: unknown[];
  };
}

let lastFiltered: { key: unknown[]; props: FilteredLayerProps } | null = null;

export function filteredLayerProps(opts: BuildLayersOpts): FilteredLayerProps {
  const { speedRange, hBreakRange, vBreakRange, plateXRange, plateZRange, zoneFilter, outcomeFilter } = opts;
  const selectedTypes = opts.selectedTypes ?? null;
  const playerFilter = opts.playerFilter ?? null;
  const countBuckets = opts.countBuckets ?? null;
  const zoneCells = opts.zoneCells ?? null;
  const leagueZones = opts.leagueZones ?? null;
  const playEvent = opts.playEvent ?? null;
  const hasTypeFilter = Boolean(selectedTypes && selectedTypes.size > 0);
  const hasZoneFilter = zoneFilter === "in_zone" || zoneFilter === "out_of_zone";
  const hasOutcomeFilter = outcomeFilter !== "all" && outcomeFilter != null;
  const hasPlayerFilter = playerFilter !== null;
  const hasCountFilter = Boolean(countBuckets && countBuckets.size > 0);
  const hasCellFilter = Boolean(zoneCells && zoneCells.size > 0);
  const hasLeagueFilter = Boolean(leagueZones && leagueZones.size > 0);
  const hasPlayEventFilter = playEvent != null && playEvent !== "";
  const typeRange: [number, number] =
    hasTypeFilter || hasZoneFilter || hasOutcomeFilter || hasPlayerFilter || hasCountFilter || hasCellFilter ||
    hasLeagueFilter || hasPlayEventFilter
      ? [0.5, 1.5]
      : OPEN_RANGE;
  const xRange = plateXRange ?? hBreakRange ?? OPEN_RANGE;
  const zRange = plateZRange ?? vBreakRange ?? OPEN_RANGE;

  const key = [
    speedRange[0], speedRange[1], xRange[0], xRange[1], zRange[0], zRange[1],
    typeRange[0], typeRange[1], selectedTypes, zoneFilter ?? "all", outcomeFilter ?? "all",
    selectedTypes ? selectedTypes.size : 0,
    playerFilter ? `${playerFilter.pitcher ?? ""}:${playerFilter.batter ?? ""}` : "",
    countBuckets ? [...countBuckets].sort().join(",") : "",
    zoneCells ? [...zoneCells].sort((a, b) => a - b).join(",") : "",
    leagueZones ? [...leagueZones].sort((a, b) => a - b).join(",") : "",
    playEvent ?? "",
  ];
  if (lastFiltered && lastFiltered.key.every((v, i) => v === key[i])) return lastFiltered.props;

  const criteria: CriteriaOpts = {
    zoneFilter,
    outcomeFilter,
    selectedTypes,
    playerFilter,
    countBuckets,
    zoneCells,
    leagueZones,
    playEvent,
  };
  const props: FilteredLayerProps = {
    getFilterValue: (d) => [
      d.releaseSpeed,
      d.plateX ?? d.pfxX ?? 0,
      d.plateZ ?? d.pfxZ ?? 0,
      passesCriteria(d, criteria) ? 1 : 0,
    ],
    filterRange: filterRange(speedRange, xRange, zRange, typeRange),
    extensions: [FILTER_EXTENSION],
    updateTriggers: {
      filterRange: [speedRange, xRange, zRange, typeRange],
      getFilterValue: [selectedTypes, zoneFilter ?? "all", outcomeFilter ?? "all"],
    },
  };
  lastFiltered = { key, props };
  return props;
}

// Module-level accessors: stable identities across buildLayers calls, so
// deck.gl sees non-flight layers as unchanged while a flight plays.
const getPitchPath = (d: PitchDatum) => d.path;
const getTrajectoryColor = (d: PitchDatum): [number, number, number, number] => [...pitchColor(d.pitchType), 220];
const getGhostPath = (d: PitchDatum) => d.ghostPath ?? (d.kinematics ? ghostTrajectoryFlat(d.kinematics) : d.path);
const getPitchFill190 = (d: PitchDatum): [number, number, number, number] => [...pitchColor(d.pitchType), 190];
const getPitchFill200 = (d: PitchDatum): [number, number, number, number] => [...pitchColor(d.pitchType), 200];
const getPitchStroke = (d: PitchDatum): [number, number, number, number] => [...pitchColor(d.pitchType), 255];
const getTunnelPosition = (d: PitchDatum): [number, number, number] => {
  if (d.commitmentPoint) return d.commitmentPoint;
  if (d.kinematics) return commitmentPosition(d.kinematics);
  return [0, 23.8, 3.0];
};
const getPlateCrossing = (d: PitchDatum): [number, number, number] => [
  d.plateX ?? d.pfxX ?? 0,
  STRIKE_ZONE.y,
  d.plateZ ?? d.pfxZ ?? 2.5,
];
const getReleasePosition = (d: PitchDatum): [number, number, number] => {
  if (d.kinematics) return [d.kinematics.x0, d.kinematics.y0, d.kinematics.z0];
  if (d.path && d.path.length >= 3) return [d.path[0], d.path[1], d.path[2]];
  return [0, 55, 5.5];
};
const getSegmentPath = (s: WireSegment) => s;

/** TripsLayer timestamps: point i of the 60-point path is at i/59 of the flight. */
const PATH_POINTS = 60;
const PATH_TIMESTAMPS: Float32Array = Float32Array.from({ length: PATH_POINTS }, (_, i) => i / (PATH_POINTS - 1));
const getPathTimestamps = () => PATH_TIMESTAMPS;

/**
 * Full layer set for the visualizer. Filtering is 100% GPU-side: pitch data
 * is passed unfiltered and the slider/type selections land in
 * DataFilterExtension uniforms (TDD §5.3 invariant — zero per-frame JS
 * filtering).
 *
 * During playback the only prop that changes between frames is the
 * TripsLayer's `currentTime` uniform; every other layer receives identical
 * data and accessor references and is not re-evaluated.
 */
export function buildLayers(opts: BuildLayersOpts) {
  const {
    pitches,
    onHover,
    picked,
    flightProgress,
    isPlaying,
    showTunneling,
    showGhostBreak,
    showReleasePoints,
    showPlateCrossings,
    showSpray,
    pairedTypes,
    arsenalCentroids,
    showDispersion,
    releaseDispersion,
    showHeatmap,
    heatmapCells,
  } = opts;
  const filtered = filteredLayerProps(opts);

  const trajectoryProps = {
    id: "pitch-trajectories",
    // deck.gl >= 9.3 depth picking: info.coordinate is the 3D point on the
    // hovered path, so the tooltip can say where along the flight it is.
    pickable: "3d" as const,
    onHover,
    onClick: onHover,
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    data: pitches,
    // path is a flat 60-point [x,y,z] array — consumed directly, zero-copy.
    getPath: getPitchPath,
    getColor: getTrajectoryColor,
    getWidth: TRAJECTORY_WIDTH,
    widthUnits: "meters" as const,
    widthMinPixels: 1.5,
    billboard: true,
    // Fade the bundle when the heatmap is on so the zone stays legible.
    opacity: showHeatmap && heatmapCells && heatmapCells.length > 0 ? 0.35 : 0.9,
    ...filtered,
  };
  const layers: (PathLayer<any> | TripsLayer<any> | ScatterplotLayer<any> | PolygonLayer<any>)[] = [
    flightProgress !== undefined
      ? // The trail up to the ball: timestamps 0..1 along the path, trailLength 1
        // keeps the whole path behind the ball visible. currentTime is a
        // uniform, so scrubbing/playing never re-uploads attributes.
        new TripsLayer<PitchDatum>({
          ...trajectoryProps,
          getTimestamps: getPathTimestamps,
          currentTime: flightProgress,
          trailLength: 1.0,
          fadeTrail: false,
        })
      : new PathLayer<PitchDatum>(trajectoryProps),
  ];

  if (showTunneling) {
    layers.push(
      new PathLayer<WireSegment>({
        id: "tunneling-plane",
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        data: tunnelingPlaneSegments(),
        getPath: getSegmentPath,
        getColor: [255, 215, 0],
        getWidth: 0.03,
        widthUnits: "meters",
        billboard: true,
        widthMinPixels: 1,
        opacity: 0.85,
      }),
      new ScatterplotLayer<PitchDatum>({
        id: "tunnel-points",
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        data: pitches,
        getPosition: getTunnelPosition,
        getRadius: 0.08,
        radiusUnits: "meters",
        stroked: true,
        filled: true,
        getFillColor: getPitchFill190,
        getLineColor: [255, 255, 255, 200],
        ...markerStyle(1),
        ...filtered,
      }),
    );
  }

  if (showSpray) {
    layers.push(
      new ScatterplotLayer<PitchDatum>({
        id: "spray-landings",
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        data: pitches,
        getPosition: sprayPosition,
        getRadius: sprayRadius,
        radiusUnits: "meters",
        filled: true,
        stroked: true,
        getFillColor: (d) => {
          const [r, g, b] = sprayColor(d.bbType);
          return [r, g, b, 215];
        },
        getLineColor: [12, 14, 18, 220],
        lineWidthUnits: "meters",
        getLineWidth: 0.06,
        pickable: true,
        ...filtered,
      }),
    );
  }

  if (showGhostBreak) {
    layers.unshift(
      new PathLayer<PitchDatum>({
        id: "ghost-trajectories",
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        data: pitches,
        getPath: getGhostPath,
        getColor: [200, 220, 240, 80],
        getWidth: TRAJECTORY_WIDTH * 0.75,
        widthUnits: "meters",
        widthMinPixels: 1.0,
        billboard: true,
        opacity: 0.6,
        ...filtered,
      }),
    );
  }

  if (picked) layers.push(...pickedLayers(picked, opts));

  if (showPlateCrossings) {
    layers.push(
      new ScatterplotLayer<PitchDatum>({
        id: "plate-crossings",
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        data: pitches,
        getPosition: getPlateCrossing,
        getRadius: 0.06,
        radiusUnits: "meters",
        stroked: true,
        filled: true,
        getFillColor: getPitchFill190,
        // Dark hairline: a dense cluster reads as separate dots, not a white blob.
        getLineColor: [10, 15, 30, 220],
        ...markerStyle(1, 1.5),
        ...filtered,
      }),
    );
  }

  if (showReleasePoints) {
    layers.push(
      new ScatterplotLayer<PitchDatum>({
        id: "release-points",
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        data: pitches,
        getPosition: getReleasePosition,
        getRadius: 0.12,
        radiusUnits: "meters",
        stroked: true,
        filled: true,
        getFillColor: getPitchFill200,
        getLineColor: [255, 255, 255, 200],
        ...markerStyle(1.5),
        ...filtered,
      }),
    );
  }

  // The ball marker is only drawn while paused (scrubbing); during playback the
  // head of the trail is the ball, and this layer's per-frame position update
  // would be the one thing that re-uploads attributes.
  if (flightProgress !== undefined && !isPlaying) {
    layers.push(
      new ScatterplotLayer<PitchDatum>({
        id: "baseball-markers",
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
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
        getLineColor: getPitchStroke,
        ...markerStyle(1.5),
        ...filtered,
        updateTriggers: { ...filtered.updateTriggers, getPosition: flightProgress },
      }),
    );
  }

  if (pairedTypes && arsenalCentroids) {
    const c1 = arsenalCentroids.get(pairedTypes[0]);
    const c2 = arsenalCentroids.get(pairedTypes[1]);
    if (c1 && c2) {
      layers.push(
        new PathLayer<WireSegment>({
          id: "paired-tunnel-envelope",
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
          data: tunnelingEnvelopeSegments(c1, c2),
          getPath: getSegmentPath,
          getColor: [255, 180, 0, 220],
          getWidth: 0.04,
          widthUnits: "meters",
          billboard: true,
          widthMinPixels: 2.0,
          opacity: 0.9,
        }),
        new PathLayer<ArsenalCentroid>({
          id: "paired-centroid-paths",
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
          data: [c1, c2],
          getPath: (c) => trajectoryFlat(c.kinematics),
          getColor: (c) => [...pitchColor(c.pitchType), 240],
          getWidth: TRAJECTORY_WIDTH * 1.8,
          widthUnits: "meters",
          billboard: true,
          widthMinPixels: 2.5,
          opacity: 0.95,
        }),
      );
    }
  }

  if (showDispersion && releaseDispersion && releaseDispersion.wireframeSegments.length > 0) {
    layers.push(
      new PathLayer<[number, number, number][]>({
        id: "release-dispersion-ellipsoid",
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        data: releaseDispersion.wireframeSegments,
        getPath: (d: [number, number, number][]) => d,
        getColor: [255, 215, 0, 220],
        getWidth: 0.03,
        widthUnits: "meters",
        billboard: true,
        widthMinPixels: 1.5,
        opacity: 0.85,
      }),
    );
  }

  if (showHeatmap && heatmapCells && heatmapCells.length > 0) {
    // Right after the pitch paths, before the plate markers and the zone
    // outline, so those stay on top of the cells instead of z-fighting with
    // them on the same plane.
    layers.splice(
      layers.findIndex((l) => l.id === "pitch-trajectories") + 1,
      0,
      new PolygonLayer<HeatmapCell>({
        id: "strike-zone-heatmap",
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
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
        // Draw over the pitch-path bundle instead of being depth-occluded by it,
        // without writing depth that would hide the outline and markers after it.
        parameters: { depthCompare: "always", depthWriteEnabled: false },
      }),
    );
  }

  // The field wireframe goes last: the zone outline shares the plate plane with
  // the heatmap and the plate-crossing markers, and deck.gl's per-layer polygon
  // offset lets the last layer win that tie, so the zone is never buried.
  layers.push(
    // Billboarded like every PathLayer here: a non-billboard path is extruded in
    // the ground (x/y) plane, so the zone's vertical edges had zero width and its
    // horizontal edges were seen edge-on from behind the plate.
    new PathLayer<WireSegment>({
      id: "strike-zone",
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: diamondWireframeSegments(),
      getPath: getSegmentPath,
      getColor: [255, 255, 255],
      getWidth: 0.03,
      widthUnits: "meters",
      billboard: true,
      widthMinPixels: 1,
      opacity: 0.85,
    }),
  );

  return layers;
}

/**
 * Highlight layers for the hovered/pinned pitch. Built separately from the
 * base bundle so a hover only swaps these few single-datum layers and never
 * re-diffs the (large) base layers; Visualizer concatenates [...base, ...picked].
 */
export function pickedLayers(
  picked: PitchDatum | null | undefined,
  opts: Pick<BuildLayersOpts, "showContactSim" | "batSpeed" | "attackAngleDeg"> = {},
) {
  const layers: (PathLayer<any> | ScatterplotLayer<any>)[] = [];
  if (!picked) return layers;

  if (picked.kinematics) {
    const k = picked.kinematics;
    layers.push(
      new PathLayer<PitchDatum>({
        id: "picked-ghost-trajectory",
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
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
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        data: [breakVectorSegment(k)],
        getPath: getSegmentPath,
        getColor: [255, 215, 0],
        getWidth: 0.04,
        widthUnits: "meters",
        billboard: true,
        widthMinPixels: 2.5,
        opacity: 1.0,
      }),
      new ScatterplotLayer<PitchDatum>({
        id: "picked-release-point",
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        data: [picked],
        getPosition: () => [k.x0, k.y0, k.z0],
        getRadius: 0.18,
        radiusUnits: "meters",
        stroked: true,
        filled: true,
        getFillColor: [255, 215, 0, 240],
        getLineColor: [255, 255, 255, 255],
        ...markerStyle(2.5, 4),
      }),
      new ScatterplotLayer<PitchDatum>({
        id: "picked-tunnel-point",
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        data: [picked],
        getPosition: () => picked.commitmentPoint ?? commitmentPosition(k),
        getRadius: 0.14,
        radiusUnits: "meters",
        stroked: true,
        filled: true,
        getFillColor: [255, 215, 0, 240],
        getLineColor: [255, 255, 255, 255],
        ...markerStyle(2.0, 4),
      }),
    );
  }

  layers.push(
    new PathLayer<PitchDatum>({
      id: "picked-pitch-highlight",
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [picked],
      getPath: getPitchPath,
      getColor: getPitchStroke,
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
      coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
      data: [picked],
      getPosition: () => [px, STRIKE_ZONE.y, pz],
      getRadius: 0.1,
      radiusUnits: "meters",
      stroked: true,
      filled: true,
      getFillColor: [255, 215, 0, 240],
      getLineColor: [255, 255, 255, 255],
      ...markerStyle(2.0, 4),
    }),
  );
  if (picked.szTop != null && picked.szBot != null) {
    layers.push(
      new PathLayer<WireSegment>({
        id: "picked-batter-strike-zone",
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        data: batterStrikeZoneSegments(picked.szTop, picked.szBot),
        getPath: getSegmentPath,
        getColor: [0, 220, 255],
        getWidth: 0.04,
        widthUnits: "meters",
        billboard: true,
        widthMinPixels: 2.0,
        opacity: 0.9,
      }),
    );
  }

  if (opts.showContactSim && picked.kinematics) {
    const col = computeCollision(picked.kinematics, opts.batSpeed ?? 75.0, opts.attackAngleDeg ?? 10.0);
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
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
          data: [battedTrajectory],
          getPath: (d: [number, number, number][]) => d,
          getColor: [...color, 240],
          getWidth: TRAJECTORY_WIDTH * 1.6,
          widthUnits: "meters",
          billboard: true,
          widthMinPixels: 2.5,
          opacity: 0.95,
        }),
        new ScatterplotLayer<[number, number, number]>({
          id: "simulated-landing-spot",
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
          data: [landingPt],
          getPosition: (p: [number, number, number]) => p,
          getRadius: 0.35,
          radiusUnits: "meters",
          stroked: true,
          filled: true,
          getFillColor: [...color, 180],
          getLineColor: [255, 255, 255, 240],
          ...markerStyle(1.5),
        }),
      );
    }
  }

  return layers;
}
