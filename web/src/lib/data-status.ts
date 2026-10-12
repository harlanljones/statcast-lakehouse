/**
 * Data-status helpers for the story caption (data-status line, whiff badge) and pitch-type chips: distinct pitch-type derivation,
 * game_date extraction from the loaded Arrow table, and status formatting.
 * All pure functions — no Solid, no deck.gl, no DOM.
 */
import type { Table } from "apache-arrow";
import type { PitchDatum } from "./deck-layers";

/** Distinct non-empty pitch-type codes, most frequent first, ties alphabetical. */
export function distinctPitchTypes(pitches: { pitchType: string }[]): string[] {
  const counts = new Map<string, number>();
  for (const p of pitches) {
    if (!p.pitchType) continue;
    counts.set(p.pitchType, (counts.get(p.pitchType) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([code]) => code);
}

/** First game_date value in the table, or null when absent/empty. */
export function extractGameDate(table: Table): string | null {
  const col = table.getChild("game_date");
  if (!col || table.numRows === 0) return null;
  const v = col.get(0);
  if (v == null) return null;
  if (typeof v === "number") {
    const ms = v > 1e11 ? v : v * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (v instanceof Date) {
    return v.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Distinct game dates in the table (0 when the column is absent or empty).
 * Slices can span several games, so the caption cannot assume one date.
 */
export function countGameDates(table: Table): number {
  const col = table.getChild("game_date");
  if (!col || table.numRows === 0) return 0;
  const seen = new Set<number | string>();
  for (let i = 0; i < table.numRows; i++) {
    const v = col.get(i);
    if (v == null) continue;
    if (typeof v === "number") {
      // Days since epoch (date32) or milliseconds since epoch (date64/timestamp).
      seen.add(v > 1e11 ? Math.floor(v / 86400000) : Math.floor(v));
    } else if (v instanceof Date) {
      seen.add(Math.floor(v.getTime() / 86400000));
    } else {
      seen.add(String(v).trim().slice(0, 10));
    }
  }
  return seen.size;
}

/** en-US thousands grouping: 1234 -> "1,234". */
export function formatRowCount(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * "1,234 rows · 2024-04-01", "1,234 rows · 3 game days" for a slice that spans
 * several games, or "1,234 rows" when no date is available.
 */
export function formatDataStatus(rowCount: number, gameDate: string | null, gameDays = 1): string {
  if (gameDays > 1) return `${formatRowCount(rowCount)} rows · ${gameDays} game days`;
  return gameDate ? `${formatRowCount(rowCount)} rows · ${gameDate}` : `${formatRowCount(rowCount)} rows`;
}

export interface WhiffRate {
  swings: number;
  whiffs: number;
  whiffPct: number | null;
}

/**
 * Compute whiff statistics across an array of pitches.
 * Whiff rate = (whiffs / swings) * 100, or null when swings is 0.
 */
export function computeWhiffRate(pitches: PitchDatum[]): WhiffRate {
  let swings = 0;
  let whiffs = 0;
  for (const p of pitches) {
    if (p.isSwing) swings++;
    if (p.isWhiff) whiffs++;
  }
  const whiffPct = swings > 0 ? (whiffs / swings) * 100 : null;
  return { swings, whiffs, whiffPct };
}
