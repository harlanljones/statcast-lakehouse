import { For, Show, type JSX } from "solid-js";
import { pitchColor, type PitchDatum } from "../lib/deck-layers";
import {
  comparisonAgainst,
  formatRateDelta,
  mlbLinks,
  pitchResult,
  playerLabel,
  summarizeBatter,
  summarizeOthers,
  summarizePitcher,
} from "../lib/player-card";
import type { PlayerFilter } from "../lib/deck-layers";
import { sprayDirection } from "../lib/spray";
import { storylinesForPitcher, type PitcherStoryline } from "../lib/storylines";
import { CloseButton, THEME } from "./ui";

export interface PlayerCardProps {
  pitch: PitchDatum;
  /** Set by the isolate buttons; the same player pressed again clears it. */
  playerFilter?: PlayerFilter | null;
  onPlayerFilter?: (f: PlayerFilter | null) => void;
  /** Pinned comparison players, per role: the yardstick this card's deltas use instead of "the rest". */
  benchmark?: PlayerFilter | null;
  onBenchmark?: (b: PlayerFilter | null) => void;
  /** The pitches currently visible (after filters), for the pitcher summary. */
  pitches: readonly PitchDatum[];
  synthetic: boolean;
  storylines?: readonly PitcherStoryline[];
  storylineDate?: string;
  onClose: () => void;
}

const signed = (n: number) => `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(1)}"`;

const muted: JSX.CSSProperties = { color: THEME.muted };

/**
 * Pinned card for the clicked pitch: who threw it, how that pitcher's mix looks
 * across the loaded group, the pitch itself, and MLB links. Links are disabled
 * (with a reason) whenever the pitch is synthetic or an id is missing.
 */
export default function PlayerCard(props: PlayerCardProps): JSX.Element {
  const summary = () => (props.pitch.pitcherId != null ? summarizePitcher(props.pitches, props.pitch.pitcherId) : null);
  const atBat = () => (props.pitch.batterId != null ? summarizeBatter(props.pitches, props.pitch.batterId) : null);
  /**
   * The yardstick each role's deltas use: every OTHER pitcher (or batter) in the
   * loaded pitches, labelled "vs rest" on screen and never as a league baseline —
   * the loaded slices are a handful of real games picked for their stories — or
   * the player the user pinned as the comparison, labelled with their name.
   */
  const pitcherAgainst = () => comparisonAgainst(props.pitches, "pitcher", props.pitch.pitcherId, props.benchmark);
  const batterAgainst = () => comparisonAgainst(props.pitches, "batter", props.pitch.batterId, props.benchmark);
  const restValue = (rate: number | null, other: number | null) =>
    rate == null || other == null ? undefined : `${Math.round(other * 100)}%`;

  /** Where this batted ball landed, when the data carries both halves of it. */
  const sprayLine = () => {
    const direction = sprayDirection(props.pitch.hcX, props.pitch.hcY);
    const distance = props.pitch.hitDistance;
    if (!direction || distance == null || !(distance > 0)) return null;
    return `Spray: ${Math.round(distance)} ft to ${direction}`;
  };
  /** Setting one role never clears the other, so both together is the matchup. */
  const toggleIsolate = (role: "pitcher" | "batter", id: number) => {
    const next: PlayerFilter = { ...(props.playerFilter ?? {}) };
    if (next[role] === id) delete next[role];
    else next[role] = id;
    props.onPlayerFilter?.(next.pitcher == null && next.batter == null ? null : next);
  };
  const matchup = () =>
    props.playerFilter?.pitcher != null && props.playerFilter.batter != null;
  const isolated = (role: "pitcher" | "batter", id: number | undefined) =>
    id != null && props.playerFilter?.[role] === id;
  const ctlStyle = (on: boolean): JSX.CSSProperties => ({
    "margin-top": "4px",
    padding: "2px 8px",
    "font-size": "11px",
    color: on ? THEME.accent : THEME.muted,
    background: "transparent",
    border: `1px ${on ? "solid" : "dashed"} ${on ? THEME.accent : THEME.border}`,
    "border-radius": "4px",
    cursor: "pointer",
  });
  const isolateButton = (role: "pitcher" | "batter", id: number | undefined) => (
    <Show when={id != null}>
      <button
        class="ui-ctl"
        type="button"
        aria-pressed={isolated(role, id)}
        title={
          isolated(role, id)
            ? matchup()
              ? `Showing only this ${role} to the isolated ${role === "pitcher" ? "batter" : "pitcher"} — press to clear`
              : "Show every player again"
            : matchup()
              ? `Add this ${role} to the matchup`
              : "Filter the scene to this player's pitches"
        }
        onClick={() => toggleIsolate(role, id as number)}
        style={ctlStyle(isolated(role, id))}
      >
        {isolated(role, id) ? "Isolated — show all" : `Only this ${role}`}
      </button>
    </Show>
  );
  /** Pins this player as the yardstick the deltas read against, for their role. */
  const benchmarked = (role: "pitcher" | "batter", id: number | undefined) =>
    id != null && props.benchmark?.[role] === id;
  const toggleBenchmark = (role: "pitcher" | "batter", id: number) => {
    const next: PlayerFilter = { ...(props.benchmark ?? {}) };
    if (next[role] === id) delete next[role];
    else next[role] = id;
    props.onBenchmark?.(next.pitcher == null && next.batter == null ? null : next);
  };
  const benchmarkButton = (role: "pitcher" | "batter", id: number | undefined) => (
    <Show when={id != null}>
      <button
        class="ui-ctl"
        type="button"
        aria-pressed={benchmarked(role, id)}
        title={
          benchmarked(role, id)
            ? `Read this ${role}'s deltas against the rest of the loaded pitches again`
            : `Read this ${role}'s deltas against this player instead of the rest`
        }
        onClick={() => toggleBenchmark(role, id as number)}
        style={{ ...ctlStyle(benchmarked(role, id)), "margin-left": "6px" }}
      >
        {benchmarked(role, id) ? "Comparing — clear" : "Compare with"}
      </button>
    </Show>
  );
  const links = () =>
    mlbLinks({
      synthetic: props.synthetic,
      pitcherId: props.pitch.pitcherId,
      batterId: props.pitch.batterId,
      gameId: props.pitch.gameId,
      playId: props.pitch.playId,
    });
  const notes = () => [...new Set(links().filter((l) => !l.href && l.reason).map((l) => l.reason as string))];
  const rgb = (code: string) => {
    const [r, g, b] = pitchColor(code);
    return `rgb(${r}, ${g}, ${b})`;
  };
  const stories = () => storylinesForPitcher(props.storylines ?? [], props.pitch.pitcherId, props.storylineDate);

  return (
    <aside
      role="complementary"
      aria-label="Pitch and player card"
      class="ui-panel viz-dock-bottom"
      style={{
        "--panel-w": "272px",
        background: THEME.panel,
        border: `1px solid ${THEME.border}`,
        "border-radius": "8px",
        padding: "12px 14px",
        "font-size": "12px",
        "line-height": "1.45",
        color: THEME.text,
        "box-shadow": "0 8px 24px rgba(0, 0, 0, 0.55)",
      }}
    >
      <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "8px" }}>
        <span
          style={{
            "font-size": "11px",
            "letter-spacing": "0.08em",
            padding: "2px 6px",
            "border-radius": "3px",
            border: `1px solid ${props.synthetic ? THEME.gold : THEME.good}`,
            color: props.synthetic ? THEME.gold : THEME.good,
          }}
        >
          {props.synthetic ? "SYNTHETIC DATA" : "REAL DATA"}
        </span>
        <CloseButton label="Close player card" onClick={props.onClose} />
      </div>

      <h3 style={{ margin: "0 0 2px", "font-size": "14px" }}>
        {playerLabel("Pitcher", props.pitch.pitcherId, props.synthetic, props.pitch.pitcherName)}
      </h3>
      <Show when={summary()} fallback={<div style={muted}>No pitcher id in this data.</div>}>
        {(s) => (
          <>
            <div style={muted}>
              {s().count} pitches · avg {s().avgSpeed.toFixed(1)} mph ·{" "}
              {s().whiffRate == null ? "no swings" : `${Math.round(s().whiffRate! * 100)}% whiff`}
              <Show
                when={formatRateDelta(s().whiffRate, pitcherAgainst().stats?.whiffRate ?? null)}
              >
                {(delta) => (
                  <span
                    title={`${pitcherAgainst().label}: ${restValue(
                      s().whiffRate,
                      pitcherAgainst().stats?.whiffRate ?? null,
                    ) ?? "—"} whiff`}
                  >
                    {" "}
                    · {delta()} vs {pitcherAgainst().short}
                  </span>
                )}
              </Show>
            </div>
            <div aria-label="pitch mix" style={{ margin: "6px 0 10px" }}>
              <For each={s().mix}>
                {(m) => (
                  <div style={{ display: "flex", "align-items": "center", gap: "6px", "margin-bottom": "2px" }}>
                    <span style={{ width: "22px" }}>{m.type}</span>
                    <span style={{ flex: "1", height: "6px", background: "rgba(255,255,255,0.08)", "border-radius": "3px" }}>
                      <span
                        style={{ display: "block", height: "100%", width: `${Math.max(m.share * 100, 2)}%`, background: rgb(m.type), "border-radius": "3px" }}
                      />
                    </span>
                    <span style={{ width: "76px", "text-align": "right", "white-space": "nowrap", ...muted }}>
                      {Math.round(m.share * 100)}% ({m.count})
                    </span>
                  </div>
                )}
              </For>
            </div>
            <Show when={s().contact}>
              {(c) => (
                <div aria-label="contact allowed" style={{ "margin-bottom": "10px" }}>
                  <div style={muted}>
                    Contact · avg {c().avgExitVelocity.toFixed(1)} mph · hard-hit{" "}
                    {Math.round(c().hardHitRate * 100)}% of {c().measured}
                    <Show
                      when={formatRateDelta(
                        c().hardHitRate,
                        pitcherAgainst().stats?.contact?.hardHitRate ?? null,
                      )}
                    >
                      {(delta) => (
                        <span
                          title={`${pitcherAgainst().label}: ${restValue(
                            c().hardHitRate,
                            pitcherAgainst().stats?.contact?.hardHitRate ?? null,
                          ) ?? "—"} hard-hit`}
                        >
                          {" "}
                          · {delta()} vs {pitcherAgainst().short}
                        </span>
                      )}
                    </Show>
                  </div>
                  <For each={c().mix}>
                    {(m) => (
                      <div style={{ display: "flex", gap: "6px", "margin-top": "2px" }}>
                        <span style={{ flex: "1" }}>{m.label}</span>
                        <span style={{ ...muted, "white-space": "nowrap" }}>
                          {Math.round(m.share * 100)}% ({m.count})
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              )}
            </Show>
            {isolateButton("pitcher", props.pitch.pitcherId)}
            {benchmarkButton("pitcher", props.pitch.pitcherId)}
          </>
        )}
      </Show>

      <Show
        when={atBat()}
        fallback={
          <div style={{ ...muted, "margin-bottom": "8px" }}>
            {playerLabel("Batter", props.pitch.batterId, props.synthetic, props.pitch.batterName)}
          </div>
        }
      >
        {(b) => (
          <div aria-label="batter summary" style={{ "margin-bottom": "8px" }}>
            <div>{playerLabel("Batter", props.pitch.batterId, props.synthetic, props.pitch.batterName)}</div>
            <div style={muted}>
              {b().count} seen ·{" "}
              {b().swingRate == null ? "no swing data" : `${Math.round(b().swingRate! * 100)}% swings`} ·{" "}
              {b().whiffRate == null ? "no swings" : `${Math.round(b().whiffRate! * 100)}% whiff`}
              <Show
                when={formatRateDelta(b().whiffRate, batterAgainst().stats?.whiffRate ?? null)}
              >
                {(delta) => (
                  <span
                    title={`${batterAgainst().label}: ${restValue(
                      b().whiffRate,
                      batterAgainst().stats?.whiffRate ?? null,
                    ) ?? "—"} whiff`}
                  >
                    {" "}
                    · {delta()} vs {batterAgainst().short}
                  </span>
                )}
              </Show>{" "}
              · avg {b().avgSpeed.toFixed(1)} mph faced
            </div>
            <Show when={b().contact}>
              {(c) => (
                <div style={muted}>
                  Contact · avg {c().avgExitVelocity.toFixed(1)} mph · hard-hit{" "}
                  {Math.round(c().hardHitRate * 100)}% of {c().measured}
                  <Show
                    when={formatRateDelta(
                      c().hardHitRate,
                      batterAgainst().stats?.contact?.hardHitRate ?? null,
                    )}
                  >
                    {(delta) => (
                      <span
                        title={`${batterAgainst().label}: ${restValue(
                          c().hardHitRate,
                          batterAgainst().stats?.contact?.hardHitRate ?? null,
                        ) ?? "—"} hard-hit`}
                      >
                        {" "}
                        · {delta()} vs {batterAgainst().short}
                      </span>
                    )}
                  </Show>
                </div>
              )}
            </Show>
            {isolateButton("batter", props.pitch.batterId)}
            {benchmarkButton("batter", props.pitch.batterId)}
          </div>
        )}
      </Show>

      <Show when={!props.synthetic && stories().length > 0}>
        <section
          aria-label="Pitcher storylines"
          style={{ "border-top": `1px solid ${THEME.border}`, padding: "8px 0", "margin-bottom": "2px" }}
        >
          <div style={{ color: THEME.gold, "font-size": "11px", "letter-spacing": "0.04em", "margin-bottom": "4px" }}>
            PITCHER STORYLINE
          </div>
          <For each={stories()}>
            {(story) => (
              <article style={{ "margin-bottom": "7px" }}>
                <a
                  href={story.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: THEME.text, "font-weight": "600", "text-decoration": "none" }}
                >
                  {story.title} ↗
                </a>
                <div style={{ ...muted, "font-size": "11px" }}>Event: {story.eventDate}</div>
                <div style={{ ...muted, "margin-top": "1px" }}>{story.summary}</div>
              </article>
            )}
          </For>
        </section>
      </Show>

      <div style={{ "border-top": `1px solid ${THEME.border}`, "padding-top": "8px", "margin-bottom": "8px" }}>
        <div>
          <strong style={{ color: rgb(props.pitch.pitchType) }}>{props.pitch.pitchType}</strong> · {props.pitch.releaseSpeed.toFixed(1)} mph
          <Show when={props.pitch.spinRate}> · {Math.round(props.pitch.spinRate!)} rpm</Show>
        </div>
        <Show when={props.pitch.breakVector}>
          {(b) => (
            <div style={muted}>
              IVB {signed(b().vBreakInches)} · HB {signed(b().hBreakInches)}
            </div>
          )}
        </Show>
        <div style={muted}>
          {pitchResult(props.pitch)} · plate ({props.pitch.plateX.toFixed(2)}, {props.pitch.plateZ.toFixed(2)}) ft
          <Show when={props.pitch.spinDirection != null}>
            {/*
              * The feed's spin-direction field, printed verbatim. The tooltip says only
              * what is verified: the field's provenance and the fact that its relation
              * to the break is NOT a simple one (measured, and it did not hold).
              */}
            <span
              title={
                "MLB's spinDirection for this pitch: the direction the spin axis points, in degrees, "
                + "exactly as the feed reports it. Its relation to the break is not a fixed offset — "
                + "measured across eight games, the gap's median is -99.8 degrees and only 35% of pitches "
                + "fall within 10 of 180 — so the angle is shown and not interpreted."
              }
              style={muted}
            >
              {" · "}Spin axis {Math.round(props.pitch.spinDirection!)}°
            </span>
          </Show>
          <Show when={props.pitch.playEvent}>
            {/* The appearance's outcome, verbatim: "At-bat", never "Result". */}
            <span style={muted}> · At-bat: {props.pitch.playEvent}</span>
          </Show>
        </div>
        <Show when={sprayLine()}>
          <div style={muted}>{sprayLine()}</div>
        </Show>
      </div>

      <div role="group" aria-label="MLB links" style={{ display: "flex", "flex-wrap": "wrap", gap: "6px" }}>
        <For each={links()}>
          {(l) =>
            l.href ? (
              <a
                class="ui-ctl"
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: THEME.accent, border: `1px solid ${THEME.accent}`, padding: "3px 8px", "text-decoration": "none" }}
              >
                {l.label} ↗
              </a>
            ) : (
              <span
                aria-disabled="true"
                title={l.reason}
                style={{ color: THEME.muted, border: `1px dashed ${THEME.border}`, padding: "3px 8px", cursor: "not-allowed" }}
              >
                {l.label}
              </span>
            )
          }
        </For>
      </div>
      <For each={notes()}>{(n) => <div style={{ ...muted, "font-size": "11px", "margin-top": "6px" }}>{n}</div>}</For>
    </aside>
  );
}
