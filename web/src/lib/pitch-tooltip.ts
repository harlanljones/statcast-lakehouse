/**
 * Hover-tooltip formatting for a picked pitch trajectory.
 * Pure logic only — the deck.gl picking and DOM rendering live in
 * Visualizer.tsx; this module is unit-tested in pitch-tooltip.test.ts.
 */
import { isInsideStrikeZone, pitchColor, type PitchDatum } from "./deck-layers";

export interface PitchTooltipInfo {
  pitchType: string;
  /** Palette RGB triple from the single source of truth in deck-layers. */
  color: readonly [number, number, number];
  /** e.g. "94.5 mph" */
  speed: string;
  /** e.g. "0.1 ft, 2.3 ft" */
  location: string;
  /** "In Zone" vs "Ball" */
  zone: string;
  /** "Whiff", "Swing", "Take", or undefined if not available */
  outcome?: string;
}

/** Round half away from zero, then fix to one decimal (deterministic sign handling). */
function round1(value: number): string {
  const rounded = Math.sign(value) * Math.round(Math.abs(value) * 10) / 10;
  return rounded.toFixed(1);
}

/** Format a hovered pitch into tooltip fields; null when nothing is picked. */
export function pitchTooltip(d: PitchDatum | null | undefined): PitchTooltipInfo | null {
  if (!d) return null;
  const px = d.plateX ?? d.pfxX ?? 0;
  const pz = d.plateZ ?? d.pfxZ ?? 0;
  const inZone = isInsideStrikeZone(px, pz);
  const zone = inZone ? "In Zone" : "Ball";

  let outcome: string | undefined;
  if (d.isWhiff) {
    outcome = "Whiff";
  } else if (d.isSwing) {
    outcome = "Swing";
  } else if (d.isSwing === 0) {
    outcome = "Take";
  }

  return {
    pitchType: d.pitchType,
    color: pitchColor(d.pitchType),
    speed: `${round1(d.releaseSpeed)} mph`,
    location: `${round1(px)} ft, ${round1(pz)} ft`,
    zone,
    outcome,
  };
}

/** Gap in pixels between the pointer and the tooltip card's top-left corner. */
export const TOOLTIP_OFFSET = { x: 12, y: 12 } as const;

/**
 * Anchor a tooltip card at the pointer (plus a small offset), clamped so the
 * card stays fully inside the canvas. Pure — rendering lives in Visualizer.
 */
export function clampTooltipPos(
  x: number,
  y: number,
  cardW: number,
  cardH: number,
  canvasW: number,
  canvasH: number,
): { x: number; y: number } {
  const clamp = (pos: number, size: number, total: number) =>
    Math.min(Math.max(pos, 0), Math.max(total - size, 0));
  return {
    x: clamp(x + TOOLTIP_OFFSET.x, cardW, canvasW),
    y: clamp(y + TOOLTIP_OFFSET.y, cardH, canvasH),
  };
}

/** One-line accessible summary for the aria-live region. */
export function pitchTooltipSummary(d: PitchDatum | null | undefined): string {
  const info = pitchTooltip(d);
  if (!info) return "";
  const parts = [`${info.pitchType}: ${info.speed}`, info.location, info.zone];
  if (info.outcome) parts.push(info.outcome);
  return parts.join(", ");
}
