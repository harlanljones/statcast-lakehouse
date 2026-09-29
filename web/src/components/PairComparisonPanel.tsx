import { For, Show, createMemo, type JSX } from "solid-js";
import {
  computePitchPairMetrics,
  type ArsenalCentroid,
  type PitchPairMetrics,
} from "../lib/arsenal";
import { pitchColor } from "../lib/deck-layers";
import { Panel, PanelHeader, THEME, uid } from "./ui";

export interface PairComparisonPanelProps {
  availableTypes: string[];
  pairedTypes: [string, string] | null;
  onSelectPairedTypes: (pair: [string, string] | null) => void;
  centroids: Map<string, ArsenalCentroid>;
  onClose?: () => void;
}

/**
 * Pitch Arsenal Pairing & Tunneling Deception Analysis Panel (Sprint 9).
 * Computes and renders pairwise separation and Deception Tunnel Ratio metrics.
 */
export default function PairComparisonPanel(props: PairComparisonPanelProps): JSX.Element {
  const typeA = () => props.pairedTypes?.[0] ?? props.availableTypes[0] ?? "";
  const typeB = () => props.pairedTypes?.[1] ?? props.availableTypes[1] ?? "";
  const idA = uid("pair-a");
  const idB = uid("pair-b");

  const metrics = createMemo<PitchPairMetrics | null>(() => {
    const a = typeA();
    const b = typeB();
    if (!a || !b || a === b) return null;
    const c1 = props.centroids.get(a);
    const c2 = props.centroids.get(b);
    if (!c1 || !c2) return null;
    return computePitchPairMetrics(c1, c2);
  });

  const handleSelectA = (val: string) => props.onSelectPairedTypes([val, typeB()]);
  const handleSelectB = (val: string) => props.onSelectPairedTypes([typeA(), val]);

  // Text and border tones come from the theme; the badge tint marks the tier.
  const ratioBadge = (ratio: number) => {
    if (ratio >= 2.5) return { bg: "rgba(74, 222, 128, 0.16)", border: THEME.good, text: THEME.good };
    if (ratio >= 1.5) return { bg: "rgba(96, 165, 250, 0.16)", border: THEME.accent, text: THEME.accent };
    return { bg: "rgba(148, 163, 184, 0.16)", border: THEME.muted, text: THEME.text };
  };

  const select = (id: string, label: string, value: () => string, onChange: (v: string) => void) => (
    <div style={{ flex: "1" }}>
      <label for={id} style={{ display: "block", color: THEME.muted, "margin-bottom": "2px" }}>
        {label}
      </label>
      <select id={id} class="ui-select" style={{ width: "100%" }} value={value()} onChange={(e) => onChange(e.currentTarget.value)}>
        <For each={props.availableTypes}>
          {(code) => (
            <option value={code} selected={code === value()}>
              {code}
            </option>
          )}
        </For>
      </select>
    </div>
  );

  const row = (label: string, value: string, color: string = THEME.text) => (
    <>
      <span style={{ color: THEME.muted }}>{label}</span>
      <span class="mono" style={{ color }}>{value}</span>
    </>
  );

  return (
    <Panel label="pitch pair tunneling comparison" width={250}>
      <PanelHeader title="Pitch-Pair Tunneling" onClose={props.onClose} closeLabel="close pair comparison" />

      <div style={{ display: "flex", gap: "8px", "margin-bottom": "10px" }}>
        {select(idA, "Pitch A", typeA, handleSelectA)}
        {select(idB, "Pitch B", typeB, handleSelectB)}
      </div>

      <Show when={metrics()} fallback={<div style={{ color: THEME.muted }}>Select two distinct pitch types</div>}>
        {(m) => {
          const badge = ratioBadge(m().tunnelRatio);
          const [rA, gA, bA] = pitchColor(m().typeA);
          const [rB, gB, bB] = pitchColor(m().typeB);

          return (
            <div>
              <div style={{ display: "flex", "align-items": "center", gap: "6px", "margin-bottom": "8px" }}>
                <span style={{ display: "inline-flex", "align-items": "center", gap: "4px" }}>
                  <span style={{ width: "8px", height: "8px", "border-radius": "2px", background: `rgb(${rA},${gA},${bA})` }} />
                  {m().typeA}
                </span>
                <span style={{ color: THEME.muted }}>vs</span>
                <span style={{ display: "inline-flex", "align-items": "center", gap: "4px" }}>
                  <span style={{ width: "8px", height: "8px", "border-radius": "2px", background: `rgb(${rB},${gB},${bB})` }} />
                  {m().typeB}
                </span>
              </div>

              <div style={{ display: "grid", "grid-template-columns": "1fr auto", gap: "4px", "margin-bottom": "8px" }}>
                {row("Velocity Delta:", `${m().velocityDeltaMph.toFixed(1)} mph`)}
                {row("Release Gap:", `${m().releaseSeparationInches.toFixed(1)}"`)}
                {row("Tunnel @ 23.8 ft:", `${m().tunnelingSeparationInches.toFixed(1)}"`, THEME.gold)}
                {row("Plate Divergence:", `${m().plateDivergenceInches.toFixed(1)}"`, THEME.bad)}
                {row("Break Divergence:", `${m().breakDivergenceInches.toFixed(1)}"`)}
              </div>

              <div
                style={{
                  display: "flex",
                  "justify-content": "space-between",
                  "align-items": "center",
                  padding: "5px 8px",
                  "border-radius": "4px",
                  background: badge.bg,
                  border: `1px solid ${badge.border}`,
                }}
              >
                <span style={{ "font-weight": "600", color: badge.text }}>Tunnel Ratio:</span>
                <span class="mono" style={{ "font-weight": "600", "font-size": "13px", color: badge.text }}>
                  {m().tunnelRatio.toFixed(2)}x
                </span>
              </div>
            </div>
          );
        }}
      </Show>
    </Panel>
  );
}
