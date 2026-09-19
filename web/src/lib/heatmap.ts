/**
 * Strike Zone Spatial Density & Plate Plane Heatmaps (Sprint 12).
 *
 * Computes 2D/3D spatial density and swing/whiff frequency across an NxM
 * grid on the plate plane (y = 1.417 ft), rendering GPU-accelerated
 * color-mapped polygon cells matching BigQuery GIS spatial aggregations.
 */

import type { PitchDatum } from "./deck-layers";
import { PLATE_Y } from "./kinematics";

export type HeatmapMode = "density" | "whiff_rate";

export interface HeatmapCell {
  cellId: number;
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
  polygon: Array<[number, number, number]>;
  pitchCount: number;
  swingCount: number;
  whiffCount: number;
  value: number; // Normalized [0, 1] for density, [0, 100] for whiff_rate
  color: [number, number, number, number]; // RGBA
}

/**
 * Plate plane spatial bounding box in feet.
 * Encompasses the 17-inch strike zone [-0.708, +0.708] ft and vertical zone [1.5, 3.5] ft
 * plus shadow / chase margins out to [-1.4, +1.4] ft and [1.0, 4.0] ft.
 */
export const HEATMAP_BOUNDS = {
  xMin: -1.4,
  xMax: 1.4,
  zMin: 1.0,
  zMax: 4.0,
} as const;

/**
 * Interpolate RGBA color from a multi-stop color gradient.
 */
export function interpolateColor(
  t: number,
  stops: Array<{ pos: number; color: [number, number, number, number] }>
): [number, number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped <= stops[0].pos) return stops[0].color;
  if (clamped >= stops[stops.length - 1].pos) return stops[stops.length - 1].color;

  for (let i = 0; i < stops.length - 1; i++) {
    const s1 = stops[i];
    const s2 = stops[i + 1];
    if (clamped >= s1.pos && clamped <= s2.pos) {
      const f = (clamped - s1.pos) / (s2.pos - s1.pos);
      return [
        Math.round(s1.color[0] + f * (s2.color[0] - s1.color[0])),
        Math.round(s1.color[1] + f * (s2.color[1] - s1.color[1])),
        Math.round(s1.color[2] + f * (s2.color[2] - s1.color[2])),
        Math.round(s1.color[3] + f * (s2.color[3] - s1.color[3])),
      ];
    }
  }
  return stops[stops.length - 1].color;
}

export const DENSITY_COLOR_STOPS: Array<{
  pos: number;
  color: [number, number, number, number];
}> = [
  { pos: 0.0, color: [20, 25, 45, 40] },
  { pos: 0.25, color: [30, 110, 210, 120] },
  { pos: 0.5, color: [30, 200, 150, 170] },
  { pos: 0.75, color: [245, 200, 30, 210] },
  { pos: 1.0, color: [255, 50, 30, 240] },
];

export const WHIFF_COLOR_STOPS: Array<{
  pos: number;
  color: [number, number, number, number];
}> = [
  { pos: 0.0, color: [25, 25, 40, 40] },
  { pos: 0.2, color: [80, 50, 180, 110] },
  { pos: 0.4, color: [160, 40, 200, 160] },
  { pos: 0.6, color: [225, 40, 160, 200] },
  { pos: 1.0, color: [255, 30, 70, 240] },
];

/**
 * Compute spatial strike zone density or whiff frequency grid.
 *
 * @param pitches Set of pitch events to aggregate
 * @param mode "density" (pitch concentration) or "whiff_rate" (whiffs / swings)
 * @param nx Number of horizontal divisions (default: 6)
 * @param nz Number of vertical divisions (default: 6)
 */
export function computeStrikeZoneHeatmap(
  pitches: PitchDatum[],
  mode: HeatmapMode = "density",
  nx = 6,
  nz = 6
): HeatmapCell[] {
  const { xMin, xMax, zMin, zMax } = HEATMAP_BOUNDS;
  const dx = (xMax - xMin) / nx;
  const dz = (zMax - zMin) / nz;

  // Initialize cells
  const cells: HeatmapCell[] = [];
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const cellId = iz * nx + ix;
      const cXMin = xMin + ix * dx;
      const cXMax = cXMin + dx;
      const cZMin = zMin + iz * dz;
      const cZMax = cZMin + dz;

      // 4-point closed quad at the plate plane y = PLATE_Y
      const polygon: Array<[number, number, number]> = [
        [cXMin, PLATE_Y, cZMin],
        [cXMax, PLATE_Y, cZMin],
        [cXMax, PLATE_Y, cZMax],
        [cXMin, PLATE_Y, cZMax],
      ];

      cells.push({
        cellId,
        xMin: cXMin,
        xMax: cXMax,
        zMin: cZMin,
        zMax: cZMax,
        polygon,
        pitchCount: 0,
        swingCount: 0,
        whiffCount: 0,
        value: 0,
        color: [0, 0, 0, 0],
      });
    }
  }

  // Populate counts from pitches
  for (const p of pitches) {
    const px = p.plateX ?? p.pfxX ?? 0;
    const pz = p.plateZ ?? p.pfxZ ?? 0;

    if (px < xMin || px >= xMax || pz < zMin || pz >= zMax) {
      continue;
    }

    const ix = Math.min(nx - 1, Math.max(0, Math.floor((px - xMin) / dx)));
    const iz = Math.min(nz - 1, Math.max(0, Math.floor((pz - zMin) / dz)));
    const idx = iz * nx + ix;
    const cell = cells[idx];

    cell.pitchCount++;
    if (p.isSwing) cell.swingCount++;
    if (p.isWhiff) cell.whiffCount++;
  }

  // Normalize values and assign colors
  let maxCount = 0;
  for (const c of cells) {
    if (c.pitchCount > maxCount) maxCount = c.pitchCount;
  }

  for (const cell of cells) {
    if (mode === "density") {
      const norm = maxCount > 0 ? cell.pitchCount / maxCount : 0;
      cell.value = norm;
      cell.color = interpolateColor(norm, DENSITY_COLOR_STOPS);
    } else {
      const rate = cell.swingCount > 0 ? (cell.whiffCount / cell.swingCount) : 0;
      cell.value = rate * 100.0;
      cell.color = interpolateColor(rate, WHIFF_COLOR_STOPS);
    }
  }

  return cells;
}
