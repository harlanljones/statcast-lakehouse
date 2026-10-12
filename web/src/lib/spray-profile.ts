/**
 * A pitcher's spray profile: where the contact he allowed actually went.
 *
 * Sectors come from `sprayDirection`, so the field names rest on the same
 * fielder-code grounding the layer and the card use, and rows are never dropped:
 * an empty sector ("nothing to the opposite field") is information.
 */
import type { PitchDatum } from "./deck-layers";
import { sprayDirection } from "./spray";

/** The five sectors in display order, from the left-field line to the right. */
export const SPRAY_SECTORS: readonly string[] = [
  "left field",
  "left-centre",
  "centre field",
  "right-centre",
  "right field",
];

export interface SpraySectorRow {
  sector: string;
  /** Batted balls in this sector with both a measured distance and chart coordinates. */
  count: number;
  share: number;
  /** Mean measured distance (ft); 0 for an empty sector. */
  avgDistance: number;
  /** Share of those batted balls at or above the hard-hit line; null when empty. */
  hardHitShare: number | null;
}

export interface SprayProfile {
  /** Every placeable batted ball for the pitcher in view. */
  total: number;
  sectors: SpraySectorRow[];
  /** Balls with chart coordinates but no measured distance: counted nowhere. */
  unplaced: number;
}

/**
 * One row per sector for one pitcher (or every pitcher when no id is given).
 * Returns null when there is nothing to place at all.
 */
export function sprayProfile(
  pitches: readonly PitchDatum[],
  pitcherId?: number,
  hardHitMph = 95,
): SprayProfile | null {
  const acc = new Map<string, { count: number; distance: number; hardHit: number }>();
  for (const sector of SPRAY_SECTORS) acc.set(sector, { count: 0, distance: 0, hardHit: 0 });
  let total = 0;
  let unplaced = 0;
  for (const p of pitches) {
    if (pitcherId != null && p.pitcherId !== pitcherId) continue;
    if (p.hcX == null || p.hcY == null) continue;
    const sector = sprayDirection(p.hcX, p.hcY);
    if (sector == null) continue;
    if (p.hitDistance == null || !(p.hitDistance > 0)) {
      unplaced++;
      continue;
    }
    const row = acc.get(sector) ?? acc.get(SPRAY_SECTORS[2])!;
    row.count++;
    row.distance += p.hitDistance;
    if (p.launchSpeed != null && p.launchSpeed >= hardHitMph) row.hardHit++;
    total++;
  }
  if (total === 0) return null;
  return {
    total,
    unplaced,
    sectors: SPRAY_SECTORS.map((sector) => {
      const row = acc.get(sector)!;
      return {
        sector,
        count: row.count,
        share: total ? row.count / total : 0,
        avgDistance: row.count ? row.distance / row.count : 0,
        hardHitShare: row.count ? row.hardHit / row.count : null,
      };
    }),
  };
}
