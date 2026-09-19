import { For, Show, createMemo, type JSX } from "solid-js";
import {
  computePitchPairMetrics,
  type ArsenalCentroid,
  type PitchPairMetrics,
} from "../lib/arsenal";
import { pitchColor } from "../lib/deck-layers";

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

  const metrics = createMemo<PitchPairMetrics | null>(() => {
    const a = typeA();
    const b = typeB();
    if (!a || !b || a === b) return null;
    const c1 = props.centroids.get(a);
    const c2 = props.centroids.get(b);
    if (!c1 || !c2) return null;
    return computePitchPairMetrics(c1, c2);
  });

  const handleSelectA = (val: string) => {
    props.onSelectPairedTypes([val, typeB()]);
  };

  const handleSelectB = (val: string) => {
    props.onSelectPairedTypes([typeA(), val]);
  };

  const ratioBadgeColor = (ratio: number) => {
    if (ratio >= 2.5) return { bg: "rgba(50, 205, 50, 0.2)", border: "#32cd32", text: "#98fb98" };
    if (ratio >= 1.5) return { bg: "rgba(0, 200, 255, 0.2)", border: "#00c8ff", text: "#80e5ff" };
    return { bg: "rgba(180, 180, 180, 0.2)", border: "#888", text: "#ccc" };
  };

  return (
    <div
      role="region"
      aria-label="pitch pair tunneling comparison"
      style={{
        position: "absolute",
        top: "14px",
        left: "14px",
        background: "rgba(15, 15, 22, 0.94)",
        border: "1px solid rgba(255, 255, 255, 0.2)",
        "border-radius": "8px",
        padding: "10px 14px",
        "box-shadow": "0 6px 20px rgba(0, 0, 0, 0.65)",
        "backdrop-filter": "blur(5px)",
        color: "#ccc",
        "font-family": "monospace",
        "font-size": "11px",
        "z-index": "10",
        width: "250px",
      }}
    >
      <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center", "margin-bottom": "8px" }}>
        <span style={{ "font-weight": "bold", color: "#eee", "font-size": "12px" }}>
          Pitch-Pair Tunneling
        </span>
        <button
          style={{
            background: "none",
            border: "none",
            color: "#888",
            cursor: "pointer",
            "font-size": "13px",
            padding: "0 4px",
          }}
          onClick={() => props.onClose?.()}
          aria-label="close pair comparison"
        >
          ✕
        </button>
      </div>

      <div style={{ display: "flex", gap: "8px", "margin-bottom": "10px" }}>
        <div style={{ flex: "1" }}>
          <label style={{ display: "block", color: "#888", "margin-bottom": "2px" }}>Pitch A</label>
          <select
            value={typeA()}
            onChange={(e) => handleSelectA(e.currentTarget.value)}
            style={{
              width: "100%",
              background: "#222",
              color: "#eee",
              border: "1px solid #444",
              "border-radius": "4px",
              padding: "3px 6px",
            }}
          >
            <For each={props.availableTypes}>
              {(code) => <option value={code}>{code}</option>}
            </For>
          </select>
        </div>

        <div style={{ flex: "1" }}>
          <label style={{ display: "block", color: "#888", "margin-bottom": "2px" }}>Pitch B</label>
          <select
            value={typeB()}
            onChange={(e) => handleSelectB(e.currentTarget.value)}
            style={{
              width: "100%",
              background: "#222",
              color: "#eee",
              border: "1px solid #444",
              "border-radius": "4px",
              padding: "3px 6px",
            }}
          >
            <For each={props.availableTypes}>
              {(code) => <option value={code}>{code}</option>}
            </For>
          </select>
        </div>
      </div>

      <Show when={metrics()} fallback={<div style={{ color: "#777" }}>Select two distinct pitch types</div>}>
        {(m) => {
          const badge = ratioBadgeColor(m().tunnelRatio);
          const [rA, gA, bA] = pitchColor(m().typeA);
          const [rB, gB, bB] = pitchColor(m().typeB);

          return (
            <div>
              <div style={{ display: "flex", "align-items": "center", gap: "6px", "margin-bottom": "8px" }}>
                <span style={{ display: "inline-flex", "align-items": "center", gap: "3px" }}>
                  <span style={{ width: "8px", height: "8px", "border-radius": "2px", background: `rgb(${rA},${gA},${bA})` }} />
                  {m().typeA}
                </span>
                <span style={{ color: "#666" }}>vs</span>
                <span style={{ display: "inline-flex", "align-items": "center", gap: "3px" }}>
                  <span style={{ width: "8px", height: "8px", "border-radius": "2px", background: `rgb(${rB},${gB},${bB})` }} />
                  {m().typeB}
                </span>
              </div>

              <div style={{ display: "grid", "grid-template-columns": "1fr auto", gap: "4px", "margin-bottom": "8px" }}>
                <span style={{ color: "#888" }}>Velocity Delta:</span>
                <span style={{ color: "#eee" }}>{m().velocityDeltaMph.toFixed(1)} mph</span>

                <span style={{ color: "#888" }}>Release Gap:</span>
                <span style={{ color: "#eee" }}>{m().releaseSeparationInches.toFixed(1)}"</span>

                <span style={{ color: "#888" }}>Tunnel @ 23.8 ft:</span>
                <span style={{ color: "#ffd700" }}>{m().tunnelingSeparationInches.toFixed(1)}"</span>

                <span style={{ color: "#888" }}>Plate Divergence:</span>
                <span style={{ color: "#ff8080" }}>{m().plateDivergenceInches.toFixed(1)}"</span>

                <span style={{ color: "#888" }}>Break Divergence:</span>
                <span style={{ color: "#eee" }}>{m().breakDivergenceInches.toFixed(1)}"</span>
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
                <span style={{ "font-weight": "bold", color: badge.text }}>Tunnel Ratio:</span>
                <span style={{ "font-weight": "bold", "font-size": "13px", color: badge.text }}>
                  {m().tunnelRatio.toFixed(2)}x
                </span>
              </div>
            </div>
          );
        }}
      </Show>
    </div>
  );
}
