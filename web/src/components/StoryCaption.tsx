import { Show, type JSX } from "solid-js";
import type { Scenario } from "../lib/scenarios";
import { THEME } from "./ui";

export interface StoryCaptionProps {
  scenario: Scenario | null;
  activeCount: number;
  totalCount: number;
}

export default function StoryCaption(props: StoryCaptionProps): JSX.Element {
  return (
    <section
      aria-label="scenario story"
      style={{
        padding: "8px 16px",
        background: THEME.panel,
        "border-bottom": `1px solid ${THEME.border}`,
        display: "flex",
        gap: "24px",
        "align-items": "flex-start",
      }}
    >
      <div style={{ flex: "1", "min-width": "0" }}>
        <Show
          when={props.scenario}
          fallback={<div style={{ "font-size": "13px", color: THEME.muted }}>Live data: explore any date partition with the controls below.</div>}
        >
          {(s) => (
            <>
              <h2 style={{ margin: "0 0 2px", "font-size": "16px", color: "var(--accent)" }}>{s().title}</h2>
              <p style={{ margin: "0 0 3px", "font-size": "13px", "line-height": "1.4", "max-width": "72ch" }}>{s().lookFor}</p>
              <p style={{ margin: "0", "font-size": "12px", color: THEME.gold }}>Try this: {s().tryThis}</p>
              <div style={{ display: "flex", gap: "14px", "margin-top": "5px", "font-size": "11px" }}>
                <a href={s().storyUrl} target="_blank" rel="noreferrer" style={{ color: THEME.muted }}>
                  Story: {s().gameLabel}
                </a>
                <a href={s().feedUrl} target="_blank" rel="noreferrer" style={{ color: THEME.muted }}>
                  Pitch data: MLB Stats API
                </a>
              </div>
            </>
          )}
        </Show>
      </div>
      <div aria-live="polite" style={{ "font-variant-numeric": "tabular-nums", "text-align": "right", "white-space": "nowrap" }}>
        <div style={{ "font-size": "26px", "font-weight": "600", "line-height": "1.1" }}>{props.activeCount}</div>
        <div style={{ "font-size": "11px", color: THEME.muted }}>of {props.totalCount} pitches shown</div>
      </div>
    </section>
  );
}
