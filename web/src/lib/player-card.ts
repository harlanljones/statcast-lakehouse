/**
 * Player / pitch card logic: pitcher summary, outcome wording and the MLB links.
 * Pure helpers so the rules are testable without a canvas.
 *
 * Links are only ever built from real identifiers. Synthetic scenario pitches
 * have made-up pitchers, so every link is disabled for them with a reason.
 */
import type { PitchDatum } from "./deck-layers";
import { HARD_HIT_MPH } from "./heatmap";

/** Statcast batted-ball codes as a card should read them. */
const BATTED_BALL_LABELS: Record<string, string> = {
  ground_ball: "ground ball",
  fly_ball: "fly ball",
  line_drive: "line drive",
  popup: "popup",
  bunt_grounder: "bunt grounder",
  bunt_line_drive: "bunt line drive",
  bunt_popup: "bunt popup",
};

/**
 * The contact a pitcher allowed, over the pitches with a measured launch speed.
 *
 * Only measured batted balls count: `launchSpeed` is null for every pitch that
 * was not put in play and for the in-play pitches Statcast did not measure, so
 * the sample size is carried alongside the rates. Barrel rate is deliberately
 * absent — Savant's barrel is a fitted two-dimensional lookup of exit velocity
 * against launch angle, and a simplified rule would put a number on the card
 * that does not mean what its name says.
 */
export interface ContactSummary {
  measured: number;
  avgExitVelocity: number;
  /** Share of measured batted balls at HARD_HIT_MPH or above (Savant's line). */
  hardHitRate: number;
  mix: { label: string; count: number; share: number }[];
}

export interface PitcherSummary {
  pitcherId: number;
  count: number;
  avgSpeed: number;
  swings: number;
  /** Whiffs per swing; null when the pitcher drew no swings. */
  whiffRate: number | null;
  mix: { type: string; count: number; share: number }[];
  /** Contact allowed; null when none of the pitcher's pitches was measured. */
  contact: ContactSummary | null;
}

export function summarizePitcher(pitches: readonly PitchDatum[], pitcherId: number): PitcherSummary | null {
  let count = 0;
  let speed = 0;
  let swings = 0;
  let whiffs = 0;
  let measured = 0;
  let exitVelocity = 0;
  let hardHit = 0;
  const byType = new Map<string, number>();
  const byBattedBall = new Map<string, number>();
  for (const p of pitches) {
    if (p.pitcherId !== pitcherId) continue;
    count++;
    speed += p.releaseSpeed;
    if (p.isSwing) {
      swings++;
      if (p.isWhiff) whiffs++;
    }
    byType.set(p.pitchType, (byType.get(p.pitchType) ?? 0) + 1);
    if (p.launchSpeed != null) {
      measured++;
      exitVelocity += p.launchSpeed;
      if (p.launchSpeed >= HARD_HIT_MPH) hardHit++;
      if (p.bbType) byBattedBall.set(p.bbType, (byBattedBall.get(p.bbType) ?? 0) + 1);
    }
  }
  if (count === 0) return null;
  const mix = [...byType.entries()]
    .map(([type, n]) => ({ type, count: n, share: n / count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  const contact: ContactSummary | null =
    measured === 0
      ? null
      : {
          measured,
          avgExitVelocity: exitVelocity / measured,
          hardHitRate: hardHit / measured,
          mix: [...byBattedBall.entries()]
            .map(([type, n]) => ({
              label: BATTED_BALL_LABELS[type] ?? type,
              count: n,
              share: n / measured,
            }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
        };
  return {
    pitcherId,
    count,
    avgSpeed: speed / count,
    swings,
    whiffRate: swings ? whiffs / swings : null,
    mix,
    contact,
  };
}

export interface CardLink {
  label: string;
  /** null when the link cannot be built; `reason` then says why. */
  href: string | null;
  reason?: string;
}

export interface LinkInput {
  synthetic: boolean;
  pitcherId?: number;
  batterId?: number;
  gameId?: number;
  /** MLB's per-pitch video id (StatsAPI `playId`), when the data carries one. */
  playId?: string;
}

const SAVANT = "https://baseballsavant.mlb.com";
const SYNTHETIC_REASON = "Synthetic pitch: no real player or video exists for it.";

export function mlbLinks(i: LinkInput): CardLink[] {
  const gate = (label: string, build: () => string | null, missing: string): CardLink => {
    if (i.synthetic) return { label, href: null, reason: SYNTHETIC_REASON };
    const href = build();
    return href ? { label, href } : { label, href: null, reason: missing };
  };
  return [
    gate(
      "Watch pitch",
      () => (i.playId ? `${SAVANT}/sporty-videos?playId=${encodeURIComponent(i.playId)}` : null),
      "This pitch has no video id in the data; use the game feed.",
    ),
    gate(
      "Game feed",
      () => (i.gameId != null ? `${SAVANT}/gamefeed?game_pk=${i.gameId}` : null),
      "This pitch has no game id in the data.",
    ),
    gate(
      "Pitcher on Savant",
      () => (i.pitcherId != null ? `${SAVANT}/savant-player/${i.pitcherId}` : null),
      "This pitch has no pitcher id in the data.",
    ),
    gate(
      "Batter on Savant",
      () => (i.batterId != null ? `${SAVANT}/savant-player/${i.batterId}` : null),
      "This pitch has no batter id in the data.",
    ),
  ];
}

export function pitchResult(p: Pick<PitchDatum, "isSwing" | "isWhiff">): string {
  if (p.isSwing === undefined) return "Unknown";
  if (!p.isSwing) return "Take";
  return p.isWhiff ? "Swinging strike" : "Contact";
}

export function playerLabel(
  role: "Pitcher",
  id: number | undefined,
  synthetic: boolean,
  name?: string,
): string;
export function playerLabel(
  role: "Batter",
  id: number | undefined,
  synthetic: boolean,
  name?: string,
): string;
export function playerLabel(
  role: "Pitcher" | "Batter",
  id: number | undefined,
  synthetic: boolean,
  name?: string,
): string {
  if (synthetic) return id == null ? `Synthetic ${role.toLowerCase()} unknown` : `Synthetic ${role.toLowerCase()} #${id}`;
  if (name) return name;
  return id == null ? `${role} unknown` : `${role} #${id}`;
}

/** Where the loaded pitches came from; decides whether the card may link to MLB. */
export type DataSource =
  | { kind: "scenario"; synthetic: boolean }
  | { kind: "sample" }
  | { kind: "partition"; date: string };

/** The sample and warehouse partitions are real MLB pitches; scenarios follow their catalog flag. */
export function isSyntheticSource(source: DataSource): boolean {
  return source.kind === "scenario" && source.synthetic;
}
