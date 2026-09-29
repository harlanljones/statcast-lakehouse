import { For, Show, type JSX } from "solid-js";
import { fatigueNote, type FatigueBucket, type ReleaseDispersion } from "../lib/dispersion";
import { Panel, PanelHeader, THEME } from "./ui";

export interface FatiguePanelProps {
  buckets: FatigueBucket[];
  dispersion?: ReleaseDispersion | null;
  /** Whose pitches the buckets cover (a fatigue curve is per pitcher). */
  pitcherLabel?: string;
  /** Distinct pitchers in the visible set; more than one triggers the "pin a pitch" note. */
  pitcherCount?: number;
  onClose?: () => void;
}

const CU_IN_PER_CU_FT = 1728;

/**
 * Pitcher Fatigue & Release Dispersion Panel (Sprint 11).
 * Displays arm slot repeatability and velocity/release degradation across pitch count buckets.
 */
export default function FatiguePanel(props: FatiguePanelProps): JSX.Element {
  const formatDelta = (val: number, unit = "") => `${val > 0 ? "+" : ""}${val.toFixed(1)}${unit}`;

  /** Direction glyph as well as color, so the change never depends on color alone. */
  const glyph = (val: number) => (Math.abs(val) < 0.05 ? "" : val > 0 ? "▲ " : "▼ ");

  const deltaColor = (val: number, inverse = false) => {
    // Velocity: a gain is good, a drop bad. Negligible changes stay neutral.
    if (Math.abs(val) < 0.3) return THEME.muted;
    const positiveGood = !inverse;
    if (val > 0) return positiveGood ? THEME.good : THEME.bad;
    return positiveGood ? THEME.bad : THEME.good;
  };

  const delta = (val: number, unit = "") => (
    <span class="mono" style={{ color: deltaColor(val) }}>
      ({glyph(val)}{formatDelta(val, unit)})
    </span>
  );

  const note = () => fatigueNote(props.pitcherLabel, props.pitcherCount);
  const th = { padding: "2px 4px", "font-weight": "500" } as const;

  return (
    <Panel label="pitcher fatigue and release dispersion analysis" width={320}>
      <PanelHeader title="Arm Slot & Fatigue Analysis" titleColor={THEME.gold} onClose={props.onClose} closeLabel="Close fatigue panel" />

      <Show when={note()}>
        <div style={{ color: THEME.muted, "margin-bottom": "8px" }}>{note()}</div>
      </Show>

      <Show when={props.dispersion && props.dispersion.count >= 2}>
        <div
          style={{
            background: "rgba(255, 255, 255, 0.05)",
            padding: "6px 8px",
            "border-radius": "4px",
            "margin-bottom": "10px",
            border: `1px solid ${THEME.border}`,
          }}
        >
          <div style={{ "font-weight": "600", color: THEME.gold, "margin-bottom": "3px" }}>Release repeatability (1σ)</div>
          <div style={{ display: "flex", "justify-content": "space-between" }}>
            <span>σX (horizontal):</span>
            <span class="mono">±{(props.dispersion!.stdX * 12.0).toFixed(1)}"</span>
          </div>
          <div style={{ display: "flex", "justify-content": "space-between" }}>
            <span>σZ (vertical):</span>
            <span class="mono">±{(props.dispersion!.stdZ * 12.0).toFixed(1)}"</span>
          </div>
          <div style={{ display: "flex", "justify-content": "space-between" }}>
            <span>Ellipsoid volume:</span>
            <span class="mono">{(props.dispersion!.volumeCuFt * CU_IN_PER_CU_FT).toFixed(1)} in³</span>
          </div>
          <div style={{ color: THEME.muted, "margin-top": "3px" }}>Ellipsoid drawn at 1.5σ</div>
        </div>
      </Show>

      <div style={{ "font-weight": "600", "margin-bottom": "4px" }}>Degradation by pitch count</div>

      <Show
        when={props.buckets.length > 0}
        fallback={<div style={{ color: THEME.muted, "font-style": "italic" }}>No pitch data available</div>}
      >
        <table style={{ width: "100%", "border-collapse": "collapse", "text-align": "left" }}>
          <thead>
            <tr style={{ "border-bottom": `1px solid ${THEME.border}`, color: THEME.muted }}>
              <th style={th}>Pitches</th>
              <th style={th}>Vel (Δ)</th>
              <th style={th}>Arm slot (Δ)</th>
              <th style={th}>Ext</th>
              <th style={th}>Whiff</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.buckets}>
              {(b) => (
                <tr style={{ "border-bottom": "1px solid rgba(255, 255, 255, 0.08)" }}>
                  <td class="mono" style={{ padding: "3px 4px" }}>
                    {b.pitchCountStart}–{b.pitchCountEnd}
                  </td>
                  <td style={{ padding: "3px 4px" }}>
                    <span class="mono">{b.avgReleaseSpeed.toFixed(1)}</span> {delta(b.deltaVelocityMph)}
                  </td>
                  <td style={{ padding: "3px 4px" }}>
                    <span class="mono">{b.avgReleaseZ.toFixed(1)}'</span> {delta(b.deltaReleaseZInches, '"')}
                  </td>
                  <td class="mono" style={{ padding: "3px 4px" }}>
                    {b.avgExtension == null ? "—" : `${b.avgExtension.toFixed(1)}'`}
                  </td>
                  <td class="mono" style={{ padding: "3px 4px", color: THEME.gold }}>
                    {b.whiffPct.toFixed(0)}%
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </Panel>
  );
}
