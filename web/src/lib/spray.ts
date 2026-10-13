/**
 * Where batted balls landed, for the spray layer.
 *
 * Savant publishes hit coordinates in a 250x250 image space: home plate sits at
 * about (125, 205), x grows toward right field and y grows back toward the
 * plate, so the outfield sits at low y. Both conventions were checked against
 * the corpus rather than assumed — grouping by the feed's fielder code puts
 * left field at a mean x of 66, centre field at 124 and right field at 187, and
 * batters' pull-side skew falls the right way too (right-handed batters mean
 * 121, left-handed 133).
 *
 * The chart is a projection, not a scale drawing, so the landing point keeps
 * the *direction* from the chart and takes the *radius* from MLB's measured hit
 * distance in feet rather than trusting a chart-to-feet factor. Scene
 * coordinates match the rest of the app: x is the horizontal axis and y is
 * distance from the plate growing toward the mound, so the outfield is at
 * negative y.
 */
export const HIT_CHART_PLATE_X = 125;
export const HIT_CHART_PLATE_Y = 205;

export interface SprayPoint {
  /** Feet along the app's horizontal axis, positive toward right field. */
  x: number;
  /** Feet from the plate, negative beyond it (the outfield). */
  y: number;
}

/**
 * Landing point in scene feet, or null when the data cannot place it: a pitch
 * that was not put in play has no chart coordinates, and a handful of in-play
 * pitches were never measured for distance.
 */
export function sprayPoint(
  hcX?: number,
  hcY?: number,
  distanceFt?: number,
): SprayPoint | null {
  if (hcX == null || hcY == null || distanceFt == null || !(distanceFt > 0)) return null;
  const dx = hcX - HIT_CHART_PLATE_X;
  const dy = HIT_CHART_PLATE_Y - hcY;
  const r = Math.hypot(dx, dy);
  if (!(r > 0)) return null;
  return { x: (distanceFt * dx) / r, y: (-distanceFt * dy) / r };
}

/**
 * Field direction of a batted ball, or null without chart coordinates.
 *
 * The sectors are stated as field names because the chart's orientation was
 * grounded rather than assumed: grouping the corpus by the feed's fielder code
 * puts left field at a mean chart x of 66, centre field at 124 and right field
 * at 187, so a larger x really is further toward right field. Centred on the
 * line from home through second base (x = 125), the sectors are within 10°,
 * 10-25° and beyond 25° either way.
 */
export function sprayDirection(hcX?: number, hcY?: number): string | null {
  if (hcX == null || hcY == null) return null;
  const dx = hcX - HIT_CHART_PLATE_X;
  const dy = HIT_CHART_PLATE_Y - hcY;
  // Only the outfield side of the plate has a field direction; a ball recorded
  // behind home (a popup into the backstop) does not.
  if (!(dy > 0)) return null;
  const degrees = (Math.atan2(dx, dy) * 180) / Math.PI;
  const side = Math.abs(degrees) <= 10 ? "centre" : degrees < 0 ? "left" : "right";
  if (side === "centre") return "centre field";
  const depth = Math.abs(degrees) < 25 ? "-centre" : " field";
  return `${side}${depth}`;
}

/** Dot colours by batted-ball class — the same classes the player card reports. */
const SPRAY_COLORS: Record<string, [number, number, number]> = {
  ground_ball: [110, 200, 120],
  line_drive: [250, 204, 21],
  fly_ball: [96, 165, 250],
  popup: [203, 213, 225],
};
const BUNT_COLOR: [number, number, number] = [148, 163, 184];
const UNKNOWN_COLOR: [number, number, number] = [148, 163, 184];

/** Colour for a Statcast batted-ball code (bunts share one grey). */
export function sprayColor(bbType?: string): [number, number, number] {
  if (!bbType) return UNKNOWN_COLOR;
  if (bbType.startsWith("bunt_")) return BUNT_COLOR;
  return SPRAY_COLORS[bbType] ?? UNKNOWN_COLOR;
}
