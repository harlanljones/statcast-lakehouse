import { For, Show, type JSX } from "solid-js";
import { CAMERA_VIEWS, pitchColor, type CameraViewName, type OutcomeFilter, type ZoneFilter } from "../lib/deck-layers";
import type { HeatmapMode } from "../lib/heatmap";
import type { LensId } from "../lib/scenarios";
import type { DragMode } from "../lib/camera";
import { RangeField, Segmented, THEME } from "./ui";

export interface LensPanelProps {
  lens: readonly LensId[];
  view: CameraViewName;
  onView: (v: CameraViewName) => void;
  dragMode: DragMode;
  onDragMode: (m: DragMode) => void;
  onResetView: () => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  flightProgress: number;
  onFlightProgress: (v: number) => void;
  availableTypes: string[];
  selectedTypes: ReadonlySet<string>;
  onToggleType: (code: string) => void;
  speed: [number, number];
  onSpeed: (v: [number, number]) => void;
  plateX: [number, number];
  onPlateX: (v: [number, number]) => void;
  plateZ: [number, number];
  onPlateZ: (v: [number, number]) => void;
  zoneFilter: ZoneFilter;
  onZoneFilter: (v: ZoneFilter) => void;
  outcomeFilter: OutcomeFilter;
  onOutcomeFilter: (v: OutcomeFilter) => void;
  heatmapMode: HeatmapMode;
  onHeatmapMode: (m: HeatmapMode) => void;
  batSpeed: number;
  onBatSpeed: (v: number) => void;
  attackAngleDeg: number;
  onAttackAngleDeg: (v: number) => void;
}

const VIEWS = (Object.keys(CAMERA_VIEWS) as CameraViewName[]).map((v) => ({ value: v, label: v }));

export default function LensPanel(props: LensPanelProps): JSX.Element {
  const has = (id: LensId) => props.lens.includes(id);
  return (
    <div
      role="region"
      aria-label="scenario controls"
      style={{
        display: "flex",
        "flex-wrap": "wrap",
        "align-items": "center",
        gap: "8px 20px",
        padding: "8px 16px",
        background: THEME.panel,
        "border-top": `1px solid ${THEME.border}`,
      }}
    >
      <Show when={has("camera")}>
        <Segmented label="View" value={props.view} options={VIEWS} onChange={props.onView} />
        <Segmented
          label="Drag"
          value={props.dragMode}
          options={[
            { value: "rotate", label: "Rotate" },
            { value: "pan", label: "Pan" },
          ]}
          onChange={props.onDragMode}
        />
        <button class="ui-ctl ui-ghost" onClick={props.onResetView} aria-label="Reset camera to the current view">
          Reset view
        </button>
      </Show>

      <Show when={has("flight")}>
        <div style={{ display: "flex", "align-items": "center", gap: "8px", "font-size": "12px" }}>
          <button class="ui-ctl ui-ghost" onClick={props.onTogglePlay} aria-label="Play flight" aria-pressed={props.isPlaying}>
            {props.isPlaying ? "Pause" : "Play"}
          </button>
          <RangeField
            label="Flight"
            value={Math.round(props.flightProgress * 100)}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(v) => props.onFlightProgress(v / 100)}
          />
        </div>
      </Show>

      <Show when={has("types") && props.availableTypes.length > 0}>
        <div role="group" aria-label="pitch types" style={{ display: "flex", gap: "4px", "align-items": "center" }}>
          <For each={props.availableTypes}>
            {(code) => {
              const [r, g, b] = pitchColor(code);
              const on = () => props.selectedTypes.size === 0 || props.selectedTypes.has(code);
              return (
                <button
                  class="ui-ctl"
                  aria-pressed={on()}
                  onClick={() => props.onToggleType(code)}
                  style={{
                    padding: "3px 9px",
                    "font-size": "12px",
                    color: THEME.text,
                    opacity: on() ? "1" : "0.4",
                    background: `rgba(${r}, ${g}, ${b}, 0.18)`,
                    border: `1px solid rgb(${r}, ${g}, ${b})`,
                  }}
                >
                  {code}
                </button>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={has("speed")}>
        <RangeField
          label="Min speed"
          value={props.speed[0]}
          min={60}
          max={105}
          step={1}
          unit=" mph"
          onChange={(v) => props.onSpeed([Math.min(v, props.speed[1]), props.speed[1]])}
        />
      </Show>

      <Show when={has("plate")}>
        <RangeField
          label="Plate height min"
          value={props.plateZ[0]}
          min={0}
          max={5}
          step={0.1}
          unit=" ft"
          onChange={(v) => props.onPlateZ([Math.min(v, props.plateZ[1]), props.plateZ[1]])}
        />
        <RangeField
          label="Plate width max"
          value={props.plateX[1]}
          min={-2.5}
          max={2.5}
          step={0.1}
          unit=" ft"
          onChange={(v) => props.onPlateX([props.plateX[0], Math.max(v, props.plateX[0])])}
        />
      </Show>

      <Show when={has("zone")}>
        <Segmented
          label="Zone"
          value={props.zoneFilter}
          options={[
            { value: "all", label: "All" },
            { value: "in_zone", label: "In zone" },
            { value: "out_of_zone", label: "Chase" },
          ]}
          onChange={props.onZoneFilter}
        />
      </Show>

      <Show when={has("outcome")}>
        <Segmented
          label="Outcome"
          value={props.outcomeFilter}
          options={[
            { value: "all", label: "All" },
            { value: "swings", label: "Swings" },
            { value: "whiffs", label: "Whiffs" },
          ]}
          onChange={props.onOutcomeFilter}
        />
      </Show>

      <Show when={has("heatmapMode")}>
        <Segmented
          label="Heatmap"
          value={props.heatmapMode}
          options={[
            { value: "density", label: "Density" },
            { value: "whiff_rate", label: "Whiff %" },
          ]}
          onChange={props.onHeatmapMode}
        />
      </Show>

      <Show when={has("contact")}>
        <RangeField label="Bat speed" value={props.batSpeed} min={55} max={85} step={1} unit=" mph" onChange={props.onBatSpeed} />
        <RangeField label="Attack angle" value={props.attackAngleDeg} min={0} max={30} step={1} unit="°" onChange={props.onAttackAngleDeg} />
      </Show>
    </div>
  );
}
