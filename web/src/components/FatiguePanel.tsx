import { For, Show, type JSX } from "solid-js";
import type { FatigueBucket, ReleaseDispersion } from "../lib/dispersion";

export interface FatiguePanelProps {
  buckets: FatigueBucket[];
  dispersion?: ReleaseDispersion | null;
  onClose?: () => void;
}

/**
 * Pitcher Fatigue & Release Dispersion Panel (Sprint 11).
 * Displays arm slot repeatability and velocity/release degradation across pitch count buckets.
 */
export default function FatiguePanel(props: FatiguePanelProps): JSX.Element {
  const formatDelta = (val: number, unit = "") => {
    const sign = val > 0 ? "+" : "";
    return `${sign}${val.toFixed(1)}${unit}`;
  };

  const deltaColor = (val: number, inverse = false) => {
    // For velocity, drop (negative) is bad (red), gain is good (green)
    // For drop, negative is arm dropping (orange/red)
    if (Math.abs(val) < 0.3) return "#aaa";
    const positiveGood = !inverse;
    if (val > 0) return positiveGood ? "#66ff66" : "#ff6666";
    return positiveGood ? "#ff6666" : "#66ff66";
  };

  return (
    <div
      role="region"
      aria-label="pitcher fatigue and release dispersion analysis"
      style={{
        position: "absolute",
        top: "14px",
        left: "280px",
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
        width: "270px",
      }}
    >
      <div
        style={{
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center",
          "margin-bottom": "8px",
        }}
      >
        <span style={{ "font-weight": "bold", color: "#ffd700" }}>
          Arm Slot & Fatigue Analysis
        </span>
        <Show when={props.onClose}>
          <button
            aria-label="Close fatigue panel"
            onClick={() => props.onClose?.()}
            style={{
              background: "transparent",
              border: "none",
              color: "#888",
              cursor: "pointer",
              "font-size": "13px",
              padding: "0 4px",
            }}
          >
            ✕
          </button>
        </Show>
      </div>

      <Show when={props.dispersion && props.dispersion.count >= 2}>
        <div
          style={{
            background: "rgba(255, 255, 255, 0.05)",
            padding: "6px 8px",
            "border-radius": "4px",
            "margin-bottom": "10px",
            border: "1px solid rgba(255, 215, 0, 0.25)",
          }}
        >
          <div style={{ "font-weight": "bold", color: "#ffd700", "margin-bottom": "3px" }}>
            Release Repeatability (1.5σ)
          </div>
          <div style={{ display: "flex", "justify-content": "space-between" }}>
            <span>σX (horizontal):</span>
            <span style={{ color: "#fff" }}>
              ±{(props.dispersion!.stdX * 12.0).toFixed(1)}"
            </span>
          </div>
          <div style={{ display: "flex", "justify-content": "space-between" }}>
            <span>σZ (vertical):</span>
            <span style={{ color: "#fff" }}>
              ±{(props.dispersion!.stdZ * 12.0).toFixed(1)}"
            </span>
          </div>
          <div style={{ display: "flex", "justify-content": "space-between" }}>
            <span>Ellipsoid Volume:</span>
            <span style={{ color: "#fff" }}>
              {props.dispersion!.volumeCuFt.toFixed(2)} ft³
            </span>
          </div>
        </div>
      </Show>

      <div style={{ "font-weight": "bold", color: "#ddd", "margin-bottom": "4px" }}>
        Degradation by Pitch Count
      </div>

      <Show
        when={props.buckets.length > 0}
        fallback={<div style={{ color: "#777", "font-style": "italic" }}>No pitch data available</div>}
      >
        <div style={{ "max-height": "160px", "overflow-y": "auto" }}>
          <table style={{ width: "100%", "border-collapse": "collapse", "text-align": "left" }}>
            <thead>
              <tr style={{ "border-bottom": "1px solid rgba(255, 255, 255, 0.15)", color: "#888" }}>
                <th style={{ padding: "2px 4px" }}>Pitches</th>
                <th style={{ padding: "2px 4px" }}>Vel (Δ)</th>
                <th style={{ padding: "2px 4px" }}>Arm Slot (Δ)</th>
                <th style={{ padding: "2px 4px" }}>Whiff</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.buckets}>
                {(b) => (
                  <tr style={{ "border-bottom": "1px solid rgba(255, 255, 255, 0.05)" }}>
                    <td style={{ padding: "3px 4px" }}>
                      {b.pitchCountStart}–{b.pitchCountEnd}
                    </td>
                    <td style={{ padding: "3px 4px" }}>
                      <span>{b.avgReleaseSpeed.toFixed(1)}</span>{" "}
                      <span style={{ color: deltaColor(b.deltaVelocityMph) }}>
                        ({formatDelta(b.deltaVelocityMph)})
                      </span>
                    </td>
                    <td style={{ padding: "3px 4px" }}>
                      <span>{b.avgReleaseZ.toFixed(1)}'</span>{" "}
                      <span style={{ color: deltaColor(b.deltaReleaseZInches) }}>
                        ({formatDelta(b.deltaReleaseZInches, '"')})
                      </span>
                    </td>
                    <td style={{ padding: "3px 4px", color: "#ffd700" }}>
                      {b.whiffPct.toFixed(0)}%
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
}
