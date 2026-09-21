import { For, type JSX } from "solid-js";
import type { Scenario, ScenarioId } from "../lib/scenarios";
import { THEME } from "./ui";

export interface ScenarioRailProps {
  scenarios: readonly Scenario[];
  activeId: ScenarioId | null;
  onSelect: (id: ScenarioId) => void;
  liveActive: boolean;
  onLive: () => void;
}

const card = (active: boolean): JSX.CSSProperties => ({
  display: "block",
  width: "100%",
  "text-align": "left",
  padding: "10px 12px",
  color: THEME.text,
  background: active ? "rgba(96, 165, 250, 0.14)" : "transparent",
  border: `1px solid ${active ? THEME.accent : THEME.border}`,
  "border-left-width": "3px",
  cursor: "pointer",
});

export default function ScenarioRail(props: ScenarioRailProps): JSX.Element {
  return (
    <nav
      aria-label="demo scenarios"
      style={{
        width: "248px",
        "flex-shrink": "0",
        display: "flex",
        "flex-direction": "column",
        gap: "8px",
        padding: "12px",
        background: THEME.panel,
        "border-right": `1px solid ${THEME.border}`,
        "overflow-y": "auto",
      }}
    >
      <For each={props.scenarios}>
        {(s) => (
          <button aria-pressed={props.activeId === s.id} onClick={() => props.onSelect(s.id)} style={card(props.activeId === s.id)}>
            <div style={{ display: "flex", "justify-content": "space-between", "align-items": "baseline" }}>
              <strong style={{ "font-size": "14px" }}>{s.title}</strong>
              <span style={{ color: THEME.muted, "font-size": "11px" }}>{s.sprint}</span>
            </div>
            <div style={{ color: THEME.muted, "font-size": "12px", "margin-top": "4px", "line-height": "1.35" }}>{s.hook}</div>
          </button>
        )}
      </For>
      <button aria-pressed={props.liveActive} onClick={props.onLive} style={{ ...card(props.liveActive), "margin-top": "auto" }}>
        <strong style={{ "font-size": "13px" }}>Live data</strong>
        <div style={{ color: THEME.muted, "font-size": "12px", "margin-top": "4px" }}>Browse real date partitions</div>
      </button>
    </nav>
  );
}
