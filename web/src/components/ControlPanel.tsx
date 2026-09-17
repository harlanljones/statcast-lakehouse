import { For, Show, type JSX } from "solid-js";
import {
  CAMERA_VIEWS,
  type CameraViewName,
  type ZoneFilter,
  type OutcomeFilter,
  pitchColor,
} from "../lib/deck-layers";
import { pitchTypeColor } from "../lib/pitch-type-color";
import { formatDataStatus, type WhiffRate } from "../lib/data-status";
import type { DatePartition } from "../lib/arrow-loader";

export interface ControlPanelProps {
  speed: [number, number];
  onSpeed: (v: [number, number]) => void;
  plateX?: [number, number];
  onPlateX?: (v: [number, number]) => void;
  plateZ?: [number, number];
  onPlateZ?: (v: [number, number]) => void;
  onLoad: () => void;
  datePartitions?: DatePartition[];
  selectedDate?: string;
  onSelectDate?: (date: string) => void;
  view: CameraViewName;
  onView: (v: CameraViewName) => void;
  activeCount: number;
  totalCount: number;
  gameDate: string | null;
  availableTypes: string[];
  selectedTypes: ReadonlySet<string>;
  onToggleType: (code: string) => void;
  zoneFilter?: ZoneFilter;
  onZoneFilter?: (v: ZoneFilter) => void;
  outcomeFilter?: OutcomeFilter;
  onOutcomeFilter?: (v: OutcomeFilter) => void;
  whiffRate?: WhiffRate;
  flightProgress?: number;
  onFlightProgress?: (v: number) => void;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  showTunneling?: boolean;
  onToggleTunneling?: (v: boolean) => void;
}

/**
 * Control panel. Every control writes Solid signals; Visualizer rebinds
 * Deck.gl filter uniforms / view state from those signals. No array
 * filtering happens here (TDD §5.3).
 *
 * Controls:
 * - Load button / Date Selector (partition dates or sample day)
 * - Camera view preset buttons (Catcher / Pitcher / Overhead / Side)
 * - Strike Zone filter buttons (All / In Zone / Chase)
 * - Outcome filter buttons (All / Swings / Whiffs) + Whiff Rate badge
 * - Pitch count badge (active / total)
 * - Data-status line (row count + game_date)
 * - Pitch-type chips with color dots matching PITCH_COLORS; toggling a chip
 *   updates the GPU filter's 4th channel, never the data array.
 * - Pitch-type legend (swatch + label per distinct type); hidden when no
 *   data is loaded. Colors come from pitchTypeColor, deterministic per code.
 * - Release speed sliders (GPU uniform bound)
 * - Plate X and Plate Z sliders (GPU uniform bound)
 */
export default function ControlPanel(props: ControlPanelProps): JSX.Element {
  const setSpeedMin = (v: number) => {
    props.onSpeed([Math.min(v, props.speed[1]), props.speed[1]]);
  };
  const setSpeedMax = (v: number) => {
    props.onSpeed([props.speed[0], Math.max(v, props.speed[0])]);
  };
  const setPlateXMin = (v: number) => {
    if (!props.plateX || !props.onPlateX) return;
    props.onPlateX([Math.min(v, props.plateX[1]), props.plateX[1]]);
  };
  const setPlateXMax = (v: number) => {
    if (!props.plateX || !props.onPlateX) return;
    props.onPlateX([props.plateX[0], Math.max(v, props.plateX[0])]);
  };
  const setPlateZMin = (v: number) => {
    if (!props.plateZ || !props.onPlateZ) return;
    props.onPlateZ([Math.min(v, props.plateZ[1]), props.plateZ[1]]);
  };
  const setPlateZMax = (v: number) => {
    if (!props.plateZ || !props.onPlateZ) return;
    props.onPlateZ([props.plateZ[0], Math.max(v, props.plateZ[0])]);
  };
  const chipStyle = (code: string) => {
    const [r, g, b] = pitchColor(code);
    return { "background-color": `rgba(${r}, ${g}, ${b}, 0.18)`, border: `1px solid rgb(${r}, ${g}, ${b})` };
  };

  return (
    <footer
      role="contentinfo"
      style={{ display: "flex", "align-items": "center", "flex-wrap": "wrap", gap: "16px", padding: "8px" }}
    >
      <div role="group" aria-label="date selector" style={{ display: "flex", "align-items": "center", gap: "6px" }}>
        <button onClick={props.onLoad}>Load sample day</button>
        <Show when={props.datePartitions && props.datePartitions.length > 0}>
          <select
            aria-label="date partition selector"
            value={props.selectedDate ?? ""}
            onChange={(e) => props.onSelectDate?.(e.currentTarget.value)}
          >
            <option value="">Select date partition...</option>
            <For each={props.datePartitions}>
              {(p) => (
                <option value={p.game_date}>
                  {p.game_date} ({p.rows} rows)
                </option>
              )}
            </For>
          </select>
        </Show>
      </div>

      <Show when={props.availableDates.length > 0}>
        <label>
          game date{" "}
          <select
            aria-label="game date"
            value={props.selectedDate ?? ""}
            onChange={(e) => props.onSelectDate(e.currentTarget.value)}
          >
            <option value="" disabled>
              select a date
            </option>
            <For each={props.availableDates}>
              {(date) => <option value={date}>{date}</option>}
            </For>
          </select>
        </label>
      </Show>

      <Show when={props.loading}>
        <span role="status" aria-label="loading">
          loading…
        </span>
      </Show>
      <Show when={props.loadError}>
        <span role="alert" aria-label="load error">
          {props.loadError}
        </span>
      </Show>

      <div role="group" aria-label="camera view presets" style={{ display: "flex", gap: "4px" }}>
        <For each={Object.keys(CAMERA_VIEWS) as CameraViewName[]}>
          {(name) => (
            <button
              aria-pressed={props.view === name}
              style={{ "font-weight": props.view === name ? "bold" : "normal" }}
              onClick={() => props.onView(name)}
            >
              {name}
            </button>
          )}
        </For>
      </div>

      <div role="group" aria-label="flight animation controls" style={{ display: "flex", "align-items": "center", gap: "8px" }}>
        <button
          aria-label={props.isPlaying ? "Pause flight animation" : "Play flight animation"}
          style={{ "font-weight": props.isPlaying ? "bold" : "normal" }}
          onClick={() => props.onTogglePlay?.()}
        >
          {props.isPlaying ? "Pause" : "Play"}
        </button>
        <label>
          flight <strong>{Math.round((props.flightProgress ?? 1) * 100)}%</strong>{" "}
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={props.flightProgress ?? 1}
            aria-label="flight progress"
            onInput={(e) => props.onFlightProgress?.(Number(e.currentTarget.value))}
          />
        </label>
        <label style={{ display: "inline-flex", "align-items": "center", gap: "4px" }}>
          <input
            type="checkbox"
            checked={props.showTunneling ?? false}
            aria-label="toggle tunneling plane"
            onChange={(e) => props.onToggleTunneling?.(e.currentTarget.checked)}
          />
          Tunneling Plane
        </label>
      </div>

      <div role="group" aria-label="strike zone filter" style={{ display: "flex", gap: "4px" }}>
        <button
          aria-pressed={props.zoneFilter === "all" || !props.zoneFilter}
          style={{ "font-weight": (props.zoneFilter === "all" || !props.zoneFilter) ? "bold" : "normal" }}
          onClick={() => props.onZoneFilter?.("all")}
        >
          All
        </button>
        <button
          aria-pressed={props.zoneFilter === "in_zone"}
          style={{ "font-weight": props.zoneFilter === "in_zone" ? "bold" : "normal" }}
          onClick={() => props.onZoneFilter?.("in_zone")}
        >
          In Zone
        </button>
        <button
          aria-pressed={props.zoneFilter === "out_of_zone"}
          style={{ "font-weight": props.zoneFilter === "out_of_zone" ? "bold" : "normal" }}
          onClick={() => props.onZoneFilter?.("out_of_zone")}
        >
          Chase
        </button>
      </div>

      <div role="group" aria-label="outcome filter" style={{ display: "flex", gap: "4px", "align-items": "center" }}>
        <button
          aria-pressed={props.outcomeFilter === "all" || !props.outcomeFilter}
          style={{ "font-weight": (props.outcomeFilter === "all" || !props.outcomeFilter) ? "bold" : "normal" }}
          onClick={() => props.onOutcomeFilter?.("all")}
        >
          All
        </button>
        <button
          aria-pressed={props.outcomeFilter === "swings"}
          style={{ "font-weight": props.outcomeFilter === "swings" ? "bold" : "normal" }}
          onClick={() => props.onOutcomeFilter?.("swings")}
        >
          Swings
        </button>
        <button
          aria-pressed={props.outcomeFilter === "whiffs"}
          style={{ "font-weight": props.outcomeFilter === "whiffs" ? "bold" : "normal" }}
          onClick={() => props.onOutcomeFilter?.("whiffs")}
        >
          Whiffs
        </button>
        <Show when={props.whiffRate}>
          <span
            role="status"
            aria-label="whiff rate badge"
            title="Whiff rate: whiffs / swings"
            style={{
              padding: "2px 6px",
              "border-radius": "4px",
              background: "rgba(255, 100, 100, 0.18)",
              border: "1px solid rgba(255, 100, 100, 0.5)",
              "font-size": "0.85em",
              "font-weight": "bold",
            }}
          >
            {props.whiffRate!.whiffPct != null
              ? `${props.whiffRate!.whiffPct.toFixed(1)}% whiff`
              : "—% whiff"}
          </span>
        </Show>
      </div>

      <span
        role="status"
        aria-label="pitch count"
        title="pitches passing current filters / total loaded"
      >
        {props.activeCount}/{props.totalCount} pitches
      </span>

      <span
        role="status"
        aria-label="data status"
        title="rows loaded and game_date being viewed"
      >
        {formatDataStatus(props.totalCount, props.gameDate)}
      </span>

      <Show when={props.availableTypes.length > 0}>
        <div role="group" aria-label="pitch type legend" style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
          <For each={props.availableTypes}>
            {(code) => {
              const [r, g, b] = pitchTypeColor(code);
              return (
                <span aria-label={`legend pitch type ${code}`} style={{ display: "inline-flex", "align-items": "center", gap: "4px", "font-size": "0.85em" }}>
                  <span
                    aria-hidden="true"
                    style={{ width: "10px", height: "10px", "border-radius": "2px", display: "inline-block", "background-color": `rgb(${r}, ${g}, ${b})` }}
                  />
                  {code}
                </span>
              );
            }}
          </For>
        </div>
      </Show>

      <div role="group" aria-label="pitch types" style={{ display: "flex", gap: "4px" }}>
        <For each={props.availableTypes}>
          {(code) => (
            <button
              aria-pressed={props.selectedTypes.has(code)}
              aria-label={`pitch type ${code}`}
              style={chipStyle(code)}
              onClick={() => props.onToggleType(code)}
            >
              {code}
            </button>
          )}
        </For>
      </div>

      <Show when={props.speed}>
        <label>
          min mph <strong>{Math.round(props.speed[0])}</strong>{" "}
          <input
            type="range"
            min={60}
            max={105}
            step={0.5}
            value={props.speed[0]}
            aria-label="minimum release speed mph"
            onInput={(e) => setSpeedMin(Number(e.currentTarget.value))}
          />
        </label>
        <label>
          max mph <strong>{Math.round(props.speed[1])}</strong>{" "}
          <input
            type="range"
            min={60}
            max={105}
            step={0.5}
            value={props.speed[1]}
            aria-label="maximum release speed mph"
            onInput={(e) => setSpeedMax(Number(e.currentTarget.value))}
          />
        </label>
      </Show>

      <Show when={props.plateX}>
        <label>
          min X <strong>{props.plateX![0].toFixed(1)}</strong>{" "}
          <input
            type="range"
            min={-2.5}
            max={2.5}
            step={0.1}
            value={props.plateX![0]}
            aria-label="minimum plate x feet"
            onInput={(e) => setPlateXMin(Number(e.currentTarget.value))}
          />
        </label>
        <label>
          max X <strong>{props.plateX![1].toFixed(1)}</strong>{" "}
          <input
            type="range"
            min={-2.5}
            max={2.5}
            step={0.1}
            value={props.plateX![1]}
            aria-label="maximum plate x feet"
            onInput={(e) => setPlateXMax(Number(e.currentTarget.value))}
          />
        </label>
      </Show>

      <Show when={props.plateZ}>
        <label>
          min Z <strong>{props.plateZ![0].toFixed(1)}</strong>{" "}
          <input
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={props.plateZ![0]}
            aria-label="minimum plate z feet"
            onInput={(e) => setPlateZMin(Number(e.currentTarget.value))}
          />
        </label>
        <label>
          max Z <strong>{props.plateZ![1].toFixed(1)}</strong>{" "}
          <input
            type="range"
            min={0}
            max={5}
            step={0.1}
            value={props.plateZ![1]}
            aria-label="maximum plate z feet"
            onInput={(e) => setPlateZMax(Number(e.currentTarget.value))}
          />
        </label>
      </Show>
    </footer>
  );
}
