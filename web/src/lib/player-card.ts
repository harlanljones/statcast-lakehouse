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

/** The stats both player cards share: a pitcher's pitches, or a batter's seen. */
export interface RoleStats {
  count: number;
  /** Average release speed of those pitches (mph). */
  avgSpeed: number;
  swings: number;
  /** Swings per pitch seen; null when the data has no swing flag at all. */
  swingRate: number | null;
  /** Whiffs per swing; null when none of those pitches drew a swing. */
  whiffRate: number | null;
  mix: { type: string; count: number; share: number }[];
  /** Contact on those pitches; null when none was measured. */
  contact: ContactSummary | null;
}

export interface PitcherSummary extends RoleStats {
  pitcherId: number;
}

/** What a batter saw in the loaded group, over the same accumulation. */
export interface BatterSummary extends RoleStats {
  batterId: number;
}

interface Tally {
  count: number;
  speed: number;
  swings: number;
  whiffs: number;
  measured: number;
  exitVelocity: number;
  hardHit: number;
  byType: Map<string, number>;
  byBattedBall: Map<string, number>;
}

/** One pass over the corpus for whichever role the caller is summarising. */
function tallyFor(pitches: readonly PitchDatum[], matches: (p: PitchDatum) => boolean): Tally | null {
  const t: Tally = {
    count: 0,
    speed: 0,
    swings: 0,
    whiffs: 0,
    measured: 0,
    exitVelocity: 0,
    hardHit: 0,
    byType: new Map(),
    byBattedBall: new Map(),
  };
  for (const p of pitches) {
    if (!matches(p)) continue;
    t.count++;
    t.speed += p.releaseSpeed;
    if (p.isSwing) {
      t.swings++;
      if (p.isWhiff) t.whiffs++;
    }
    t.byType.set(p.pitchType, (t.byType.get(p.pitchType) ?? 0) + 1);
    if (p.launchSpeed != null) {
      t.measured++;
      t.exitVelocity += p.launchSpeed;
      if (p.launchSpeed >= HARD_HIT_MPH) t.hardHit++;
      if (p.bbType) t.byBattedBall.set(p.bbType, (t.byBattedBall.get(p.bbType) ?? 0) + 1);
    }
  }
  return t.count === 0 ? null : t;
}

function finish(t: Tally): RoleStats {
  const contact: ContactSummary | null =
    t.measured === 0
      ? null
      : {
          measured: t.measured,
          avgExitVelocity: t.exitVelocity / t.measured,
          hardHitRate: t.hardHit / t.measured,
          mix: [...t.byBattedBall.entries()]
            .map(([type, n]) => ({
              label: BATTED_BALL_LABELS[type] ?? type,
              count: n,
              share: n / t.measured,
            }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
        };
  return {
    count: t.count,
    avgSpeed: t.speed / t.count,
    swings: t.swings,
    swingRate: t.swings ? t.swings / t.count : null,
    whiffRate: t.swings ? t.whiffs / t.swings : null,
    mix: [...t.byType.entries()]
      .map(([type, n]) => ({ type, count: n, share: n / t.count }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    contact,
  };
}

export function summarizePitcher(pitches: readonly PitchDatum[], pitcherId: number): PitcherSummary | null {
  const t = tallyFor(pitches, (p) => p.pitcherId === pitcherId);
  return t && { pitcherId, ...finish(t) };
}

/**
 * The same stats for every OTHER player of that role in the loaded group.
 *
 * This is the yardstick the card compares a player against, and it is labelled
 * that way on screen: the loaded slices are a handful of real games chosen for
 * their stories, so they are not a league baseline and must never be shown as
 * one. Returns null when the group holds nobody else.
 */
export function summarizeOthers(
  pitches: readonly PitchDatum[],
  role: "pitcher" | "batter",
  id: number,
): RoleStats | null {
  const t = tallyFor(pitches, (p) => (role === "pitcher" ? p.pitcherId : p.batterId) !== id);
  return t && finish(t);
}

export function summarizeBatter(pitches: readonly PitchDatum[], batterId: number): BatterSummary | null {
  const t = tallyFor(pitches, (p) => p.batterId === batterId);
  return t && { batterId, ...finish(t) };
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

/**
 * A rate difference in percentage points, or a plain "even" when it is zero.
 *
 * Taken between the *displayed* whole percentages, not the underlying rates:
 * the card shows each side rounded, so a delta computed from unrounded rates
 * would not add up against what the reader can see ("36% … -10 vs 45%").
 * A difference that rounds to zero reads as "even" rather than a misleading "+0".
 */
export function formatRateDelta(rate: number | null, other: number | null): string | null {
  if (rate == null || other == null) return null;
  const points = Math.round(rate * 100) - Math.round(other * 100);
  if (points === 0) return "even";
  return `${points > 0 ? "+" : "−"}${Math.abs(points)} pts`;
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
