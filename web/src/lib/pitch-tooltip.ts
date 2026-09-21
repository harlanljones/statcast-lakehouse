/**
 * Hover-tooltip formatting for a picked pitch trajectory.
 * Pure logic only — the deck.gl picking and DOM rendering live in
 * Visualizer.tsx; this module is unit-tested in pitch-tooltip.test.ts.
 */
import { isInsideStrikeZone, pitchColor, type PitchDatum } from "./deck-layers";
import { commitmentPosition } from "./kinematics";
import { computeCollision } from "./collision";

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
  /** Aerodynamic break displacement, e.g. "IVB +16.2\"  HB -14.1\"" */
  break?: string;
  /** Spin rate in RPM, e.g. "2350 rpm" */
  spin?: string;
  /** Release coordinates, e.g. "Rel (+1.5, 5.8) ft" */
  release?: string;
  /** Extension from rubber, e.g. "Ext 6.2 ft" */
  extension?: string;
  /** Batter-specific strike zone bounds, e.g. "Zone [1.5, 3.4] ft" */
  zoneBounds?: string;
  /** Tunneling point at commitment plane (y = 23.8 ft), e.g. "Tunnel (+0.3, 3.2) ft" */
  tunnel?: string;
  /** Simulated ball-bat contact quality and distance, e.g. "Sim: 106.5 mph (Barrel) • 375.7 ft" */
  simulatedContact?: string;
}

/** Round half away from zero, then fix to one decimal (deterministic sign handling). */
function round1(value: number): string {
  const rounded = Math.sign(value) * Math.round(Math.abs(value) * 10) / 10;
  return rounded.toFixed(1);
}

/** Format a hovered pitch into tooltip fields; null when nothing is picked. */
export function pitchTooltip(
  d: PitchDatum | null | undefined,
  batSpeed?: number,
  attackAngleDeg?: number,
  /** Include the simulated-contact line (default true; Visualizer passes the Contact Sim layer state). */
  includeContactSim: boolean = true,
): PitchTooltipInfo | null {
  if (!d) return null;
  const px = d.plateX ?? d.pfxX ?? 0;
  const pz = d.plateZ ?? d.pfxZ ?? 0;
  const inZone = isInsideStrikeZone(px, pz, d.szTop, d.szBot);
  const zone = inZone ? "In Zone" : "Ball";

  let outcome: string | undefined;
  if (d.isWhiff) {
    outcome = "Whiff";
  } else if (d.isSwing) {
    outcome = "Swing";
  } else if (d.isSwing === 0) {
    outcome = "Take";
  }

  let breakStr: string | undefined;
  if (d.breakVector) {
    const ivb = d.breakVector.vBreakInches;
    const hb = d.breakVector.hBreakInches;
    const ivbSign = ivb >= 0 ? "+" : "";
    const hbSign = hb >= 0 ? "+" : "";
    breakStr = `IVB ${ivbSign}${round1(ivb)}"  HB ${hbSign}${round1(hb)}"`;
  }

  let spin: string | undefined;
  if (d.spinRate != null && !isNaN(d.spinRate)) {
    spin = `${Math.round(d.spinRate)} rpm`;
  }

  let release: string | undefined;
  let extension: string | undefined;
  if (d.kinematics) {
    const k = d.kinematics;
    const signX = k.x0 >= 0 ? "+" : "";
    release = `Rel (${signX}${round1(k.x0)}, ${round1(k.z0)}) ft`;
    const ext = d.extension ?? (60.5 - k.y0);
    extension = `Ext ${round1(ext)} ft`;
  }

  let zoneBounds: string | undefined;
  if (d.szTop != null && d.szBot != null && !isNaN(d.szTop) && !isNaN(d.szBot)) {
    zoneBounds = `Zone [${round1(d.szBot)}, ${round1(d.szTop)}] ft`;
  }

  let tunnel: string | undefined;
  if (d.commitmentPoint || d.kinematics) {
    const cp = d.commitmentPoint ?? (d.kinematics ? commitmentPosition(d.kinematics) : null);
    if (cp) {
      const signX = cp[0] >= 0 ? "+" : "";
      tunnel = `Tunnel (${signX}${round1(cp[0])}, ${round1(cp[2])}) ft`;
    }
  }

  let simulatedContact: string | undefined;
  if (includeContactSim && d.kinematics) {
    const col = computeCollision(d.kinematics, batSpeed, attackAngleDeg);
    if (col.contactQuality === "Whiff") {
      simulatedContact = "Sim: Whiff";
    } else {
      simulatedContact = `Sim: ${round1(col.exitSpeedMph)} mph (${col.contactQuality}) • ${round1(col.distanceFt)} ft`;
    }
  }

  return {
    pitchType: d.pitchType,
    color: pitchColor(d.pitchType),
    speed: `${round1(d.releaseSpeed)} mph`,
    location: `${round1(px)} ft, ${round1(pz)} ft`,
    zone,
    outcome,
    break: breakStr,
    spin,
    release,
    extension,
    zoneBounds,
    tunnel,
    simulatedContact,
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
export function pitchTooltipSummary(
  d: PitchDatum | null | undefined,
  batSpeed?: number,
  attackAngleDeg?: number,
  includeContactSim: boolean = true,
): string {
  const info = pitchTooltip(d, batSpeed, attackAngleDeg, includeContactSim);
  if (!info) return "";
  const parts = [`${info.pitchType}: ${info.speed}`];
  if (info.spin) parts.push(info.spin);
  parts.push(info.location, info.zone);
  if (info.zoneBounds) parts.push(info.zoneBounds);
  if (info.break) parts.push(info.break);
  if (info.release) parts.push(info.release);
  if (info.extension) parts.push(info.extension);
  if (info.tunnel) parts.push(info.tunnel);
  if (info.simulatedContact) parts.push(info.simulatedContact);
  if (info.outcome) parts.push(info.outcome);
  return parts.join(", ");
}

