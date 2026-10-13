import { For, Show, type JSX } from "solid-js";
import { pitchColor } from "../lib/deck-layers";
import type { CountRow } from "../lib/count-mix";
import { Panel, PanelHeader, THEME } from "./ui";

export interface CountPanelProps {
  rows: CountRow[];
  /** Whose pitches the breakdown covers: a count mix only means something for one arm. */
  pitcherLabel?: string;
  onClose?: () => void;
}

/**
 * Mix by count. The buckets are disjoint and complete, so the rows add up to the
 * pitches in view; an empty bucket is shown greyed rather than dropped, because
 * "he never gets to 3-0" is itself an answer.
 */
export default function CountPanel(props: CountPanelProps): JSX.Element {
  const th = { padding: "2px 4px", "font-weight": "500" } as const;
  const total = () => props.rows.reduce((n, r) => n + r.pitches, 0);
  const typeColor = (code: string) => {
    const [r, g, b] = pitchColor(code);
    return `rgb(${r}, ${g}, ${b})`;
  };

  return (
    <Panel label="pitch mix by count" width={340}>
      <PanelHeader
        title="Mix by Count"
        titleColor={THEME.gold}
        onClose={props.onClose}
        closeLabel="Close count panel"
      />

      <Show when={props.pitcherLabel}>
        <div style={{ color: THEME.muted, "margin-bottom": "6px" }}>{props.pitcherLabel}</div>
      </Show>

      <Show
        when={total() > 0}
        fallback={
          <div style={{ color: THEME.muted, "font-style": "italic" }}>No counted pitches in view</div>
        }
      >
        <table style={{ width: "100%", "border-collapse": "collapse", "text-align": "left" }}>
          <thead>
            <tr style={{ "border-bottom": `1px solid ${THEME.border}`, color: THEME.muted }}>
              <th style={th}>Count</th>
              <th style={th}>Pitches</th>
              <th style={th}>Swing</th>
              <th style={th}>Whiff</th>
              <th style={th}>Vel</th>
              <th style={th}>Mix</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.rows}>
              {(r) => (
                <tr
                  style={{
                    "border-bottom": "1px solid rgba(255, 255, 255, 0.08)",
                    opacity: r.pitches === 0 ? 0.45 : 1,
                  }}
                >
                  <td style={{ padding: "3px 4px" }}>{r.label}</td>
                  <td class="mono" style={{ padding: "3px 4px" }}>
                    {r.pitches}
                  </td>
                  <td class="mono" style={{ padding: "3px 4px" }}>
                    {r.swingRate == null ? "—" : `${Math.round(r.swingRate * 100)}%`}
                  </td>
                  <td class="mono" style={{ padding: "3px 4px" }}>
                    {r.whiffRate == null ? "—" : `${Math.round(r.whiffRate * 100)}%`}
                  </td>
                  <td class="mono" style={{ padding: "3px 4px" }}>
                    {r.pitches ? r.avgSpeed.toFixed(1) : "—"}
                  </td>
                  <td style={{ padding: "3px 4px" }}>
                    <For each={r.topTypes}>
                      {(t) => (
                        <span style={{ "margin-right": "6px", color: typeColor(t.type) }}>
                          {t.type} {Math.round(t.share * 100)}%
                        </span>
                      )}
                    </For>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>

      <div style={{ color: THEME.muted, "margin-top": "6px" }}>
        Buckets are disjoint, so the rows add up to the pitches in view.
      </div>
    </Panel>
  );
}
