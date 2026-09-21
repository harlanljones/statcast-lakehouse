/**
 * Data-status helpers for the ControlPanel: distinct pitch-type derivation,
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

/** en-US thousands grouping: 1234 -> "1,234". */
export function formatRowCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** "1,234 rows · 2024-04-01", or "1,234 rows" when no date is available. */
export function formatDataStatus(rowCount: number, gameDate: string | null): string {
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
