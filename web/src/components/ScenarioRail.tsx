import { For, Show, type JSX } from "solid-js";
import type { Scenario, ScenarioId } from "../lib/scenarios";
import type { DatePartition } from "../lib/arrow-loader";
import { THEME, uid } from "./ui";

export interface ScenarioRailProps {
  scenarios: readonly Scenario[];
  activeId: ScenarioId | null;
  onSelect: (id: ScenarioId) => void;
  liveActive: boolean;
  onLive: () => void;
  /** Live data needs the API; the static (Cloudflare Pages) build hides it. */
  showLive?: boolean;
  /** Live-data date picker: shown when Live is active and partitions exist. */
  datePartitions?: readonly DatePartition[];
  selectedDate?: string;
  onSelectDate?: (date: string) => void;
  onLoadSample?: () => void;
  loading?: boolean;
}

export default function ScenarioRail(props: ScenarioRailProps): JSX.Element {
  const dateId = uid("live-date");
  return (
    <nav class="scenario-rail" aria-label="game stories">
      <For each={props.scenarios}>
        {(s) => (
          <button class="ui-ctl ui-card" aria-pressed={props.activeId === s.id} onClick={() => props.onSelect(s.id)}>
            <strong style={{ display: "block", "font-size": "14px" }}>{s.title}</strong>
            <span style={{ display: "block", "white-space": "nowrap", color: THEME.muted, "font-size": "11px", "margin-top": "1px" }}>
              {s.dateLabel}
            </span>
            <span style={{ display: "block", color: THEME.muted, "font-size": "12px", "margin-top": "4px", "line-height": "1.35" }}>{s.hook}</span>
          </button>
        )}
      </For>
      <Show when={props.showLive ?? true}>
        <div class="rail-live">
          <button class="ui-ctl ui-card" aria-pressed={props.liveActive} onClick={props.onLive}>
            <strong style={{ display: "block", "font-size": "13px" }}>Live data</strong>
            <span style={{ display: "block", color: THEME.muted, "font-size": "12px", "margin-top": "4px" }}>Browse real date partitions</span>
          </button>
          <Show when={props.liveActive}>
            <button class="ui-ctl ui-ghost" onClick={() => props.onLoadSample?.()} disabled={props.loading}>
              {props.loading ? "Loading…" : "Load sample pitches"}
            </button>
            <Show when={props.datePartitions && props.datePartitions.length > 0}>
              <label for={dateId} style={{ color: THEME.muted, "font-size": "11px" }}>Date partition</label>
              <select
                id={dateId}
                class="ui-select"
                value={props.selectedDate ?? ""}
                onChange={(e) => props.onSelectDate?.(e.currentTarget.value)}
              >
                <option value="">Select date partition…</option>
                <For each={props.datePartitions}>
                  {(p) => (
                    <option value={p.game_date} selected={p.game_date === props.selectedDate}>
                      {p.game_date} ({p.rows} rows)
                    </option>
                  )}
                </For>
              </select>
            </Show>
          </Show>
        </div>
      </Show>
    </nav>
  );
}
