/**
 * Coordinate transformations for 2D aerodynamic pitch break charts.
 * Pure math module for rendering IVB (Induced Vertical Break) vs HB (Horizontal Break).
 */

export interface BreakCoord {
  x: number;
  y: number;
}

export const DEFAULT_BREAK_RANGE_INCHES = 25;

/**
 * Map horizontal break (inches) and vertical break (inches) into SVG pixel coordinates.
 *
 * Horizontal break:
 *   -range -> padding (catcher's left / glove-side)
 *   +range -> width - padding (catcher's right / arm-side)
 *
 * Induced vertical break:
 *   +range -> padding (top / upward lift)
 *   -range -> height - padding (bottom / sink & drop)
 */
export function breakToSvgCoords(
  hBreakInches: number,
  vBreakInches: number,
  width: number,
  height: number,
  range: number = DEFAULT_BREAK_RANGE_INCHES,
  padding: number = 20,
): BreakCoord {
  const plotW = width - 2 * padding;
  const plotH = height - 2 * padding;

  // Clamp within display range
  const clampedH = Math.max(-range, Math.min(range, hBreakInches));
  const clampedV = Math.max(-range, Math.min(range, vBreakInches));

  const x = padding + ((clampedH + range) / (2 * range)) * plotW;
  const y = padding + ((range - clampedV) / (2 * range)) * plotH;

  return { x, y };
}

/**
 * Standard grid ticks in inches (e.g. -20, -10, 0, 10, 20).
 */
export function breakGridTicks(range: number = DEFAULT_BREAK_RANGE_INCHES, step: number = 10): number[] {
  const ticks: number[] = [];
  for (let t = -Math.floor(range / step) * step; t <= range; t += step) {
    ticks.push(t);
  }
  return ticks;
}
