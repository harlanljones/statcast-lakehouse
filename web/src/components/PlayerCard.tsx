import { For, Show, type JSX } from "solid-js";
import { pitchColor, type PitchDatum } from "../lib/deck-layers";
import { mlbLinks, pitchResult, playerLabel, summarizePitcher } from "../lib/player-card";
import { THEME } from "./ui";

export interface PlayerCardProps {
  pitch: PitchDatum;
  /** Every pitch in the loaded group, for the pitcher summary. */
  pitches: readonly PitchDatum[];
  synthetic: boolean;
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

  return (
    <aside
      role="complementary"
      aria-label="Pitch and player card"
      style={{
        position: "absolute",
        right: "12px",
        bottom: "12px",
        width: "272px",
        "max-height": "calc(100% - 24px)",
        "overflow-y": "auto",
        "z-index": "12",
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
            "font-size": "10px",
            "letter-spacing": "0.08em",
            padding: "2px 6px",
            "border-radius": "3px",
            border: `1px solid ${props.synthetic ? THEME.gold : "#4ade80"}`,
            color: props.synthetic ? THEME.gold : "#4ade80",
          }}
        >
          {props.synthetic ? "SYNTHETIC DATA" : "REAL DATA"}
        </span>
        <button class="ui-ctl ui-ghost" onClick={props.onClose} aria-label="Close player card" style={{ padding: "0 6px" }}>
          ✕
        </button>
      </div>

      <h3 style={{ margin: "0 0 2px", "font-size": "14px" }}>{playerLabel("Pitcher", props.pitch.pitcherId, props.synthetic)}</h3>
      <Show when={summary()} fallback={<div style={muted}>No pitcher id in this data.</div>}>
        {(s) => (
          <>
            <div style={muted}>
              {s().count} pitches · avg {s().avgSpeed.toFixed(1)} mph ·{" "}
              {s().whiffRate == null ? "no swings" : `${Math.round(s().whiffRate! * 100)}% whiff`}
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
          </>
        )}
      </Show>

      <div style={{ ...muted, "margin-bottom": "8px" }}>{playerLabel("Batter", props.pitch.batterId, props.synthetic)}</div>

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
        </div>
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
