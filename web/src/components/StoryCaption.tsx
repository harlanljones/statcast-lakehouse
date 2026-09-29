import { Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import type { Scenario } from "../lib/scenarios";
import type { WhiffRate } from "../lib/data-status";
import { THEME } from "./ui";

export interface StoryCaptionProps {
  scenario: Scenario | null;
  activeCount: number;
  totalCount: number;
  whiffRate?: WhiffRate;
  /** "1,234 rows · 2024-04-01" */
  dataStatus?: string;
  /** Re-apply the active scenario's preset filters (not its view or layers). */
  onResetFilters?: () => void;
}

/** Trailing-debounced copy of a value, so a slider drag does not spam a live region. */
function debounced<T>(source: () => T, ms: number): () => T {
  const [value, setValue] = createSignal<T>(source());
  createEffect(() => {
    const next = source();
    const id = setTimeout(() => setValue(() => next), ms);
    onCleanup(() => clearTimeout(id));
  });
  return value;
}

export default function StoryCaption(props: StoryCaptionProps): JSX.Element {
  const hidden = () => Math.max(0, props.totalCount - props.activeCount);
  const announcement = debounced(() => `${props.activeCount} of ${props.totalCount} pitches shown`, 500);
  const whiffText = () => {
    const w = props.whiffRate;
    if (!w) return null;
    return w.whiffPct != null ? `${w.whiffPct.toFixed(1)}% whiff` : "—% whiff";
  };

  return (
    <section
      aria-label="scenario story"
      class="story-caption"
    >
      <div class="story-text">
        <Show
          when={props.scenario}
          fallback={<div style={{ "font-size": "13px", color: THEME.muted }}>Live data: pick a date partition in the Live data card, or load the sample pitches.</div>}
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
      <div class="story-stats">
        <div class="mono" style={{ "font-size": "26px", "font-weight": "600", "line-height": "1.1" }}>{props.activeCount}</div>
        <div class="mono" style={{ "font-size": "11px", color: THEME.muted }}>of {props.totalCount} pitches shown</div>
        {/* Debounced live region: announces the count at most once the sliders settle. */}
        <span class="sr-only" aria-live="polite">{announcement()}</span>
        <Show when={hidden() > 0}>
          <div class="story-hidden">
            <span
              style={{
                "font-size": "11px",
                color: THEME.gold,
                border: `1px solid ${THEME.gold}`,
                "border-radius": "10px",
                padding: "1px 8px",
              }}
            >
              {hidden()} hidden by filters
            </span>
            <button class="ui-ctl ui-ghost" style={{ "font-size": "11px", padding: "1px 8px" }} onClick={() => props.onResetFilters?.()}>
              Reset filters
            </button>
          </div>
        </Show>
        <Show when={whiffText()}>
          <div title="Whiff rate: whiffs / swings" style={{ "font-size": "11px", color: THEME.muted, "margin-top": "4px" }}>{whiffText()}</div>
        </Show>
        <Show when={props.dataStatus}>
          <div class="mono" style={{ "font-size": "11px", color: THEME.muted }}>{props.dataStatus}</div>
        </Show>
      </div>
    </section>
  );
}
