import { For, Show, type JSX } from "solid-js";
import { CAMERA_VIEWS, pitchColor, type CameraViewName, type OutcomeFilter, type ZoneFilter } from "../lib/deck-layers";
import type { HeatmapMode } from "../lib/heatmap";
import { LAYER_TOGGLES, type LayerKey, type LensId } from "../lib/scenarios";
import type { DragMode } from "../lib/camera";
import { pitchName } from "../lib/pitch-type-color";
import { RangeField, Segmented, THEME, Toggle } from "./ui";

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
  /** "All controls": adds the layer-toggle row (the caller also passes every lens). */
  showLayers?: boolean;
  layers?: Readonly<Record<LayerKey, boolean>>;
  onLayer?: (key: LayerKey, on: boolean) => void;
}

const VIEWS = (Object.keys(CAMERA_VIEWS) as CameraViewName[]).map((v) => ({ value: v, label: v }));

/**
 * The one control surface. A scenario picks which lenses to show; the header's
 * "All controls" shows every lens plus the layer toggles. Every control writes
 * a Solid signal that Visualizer binds to DataFilterExtension uniforms or the
 * camera; nothing here filters an array (TDD §5.3).
 */
export default function LensPanel(props: LensPanelProps): JSX.Element {
  const has = (id: LensId) => props.lens.includes(id);
  const setSpeedMin = (v: number) => props.onSpeed([Math.min(v, props.speed[1]), props.speed[1]]);
  const setSpeedMax = (v: number) => props.onSpeed([props.speed[0], Math.max(v, props.speed[0])]);
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
        "max-height": "45vh",
        "overflow-y": "auto",
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
          {/* The visible text is the accessible name; aria-pressed carries the state. */}
          <button class="ui-ctl ui-ghost" onClick={props.onTogglePlay} aria-pressed={props.isPlaying}>
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
        <div role="group" aria-label="pitch types" style={{ display: "flex", "flex-wrap": "wrap", gap: "4px", "align-items": "center" }}>
          <For each={props.availableTypes}>
            {(code) => {
              const [r, g, b] = pitchColor(code);
              const name = pitchName(code);
              // Pressed means visible: with nothing selected every type is shown.
              const on = () => props.selectedTypes.size === 0 || props.selectedTypes.has(code);
              return (
                <button
                  class="ui-ctl ui-chip"
                  aria-pressed={on()}
                  title={name}
                  aria-label={name ? `${code} ${name}` : code}
                  onClick={() => props.onToggleType(code)}
                  style={{ "--chip": `${r}, ${g}, ${b}` }}
                >
                  {code}
                </button>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={has("speed")}>
        <RangeField label="Min speed" value={props.speed[0]} min={40} max={105} step={1} unit=" mph" onChange={setSpeedMin} />
        <RangeField label="Max speed" value={props.speed[1]} min={40} max={105} step={1} unit=" mph" onChange={setSpeedMax} />
      </Show>

      <Show when={has("plate")}>
        <RangeField
          label="Plate height min"
          value={props.plateZ[0]}
          min={-1}
          max={6}
          step={0.1}
          unit=" ft"
          onChange={(v) => props.onPlateZ([Math.min(v, props.plateZ[1]), props.plateZ[1]])}
        />
        <RangeField
          label="Plate height max"
          value={props.plateZ[1]}
          min={-1}
          max={6}
          step={0.1}
          unit=" ft"
          onChange={(v) => props.onPlateZ([props.plateZ[0], Math.max(v, props.plateZ[0])])}
        />
        <RangeField
          label="Plate width min"
          value={props.plateX[0]}
          min={-3}
          max={3}
          step={0.1}
          unit=" ft"
          onChange={(v) => props.onPlateX([Math.min(v, props.plateX[1]), props.plateX[1]])}
        />
        <RangeField
          label="Plate width max"
          value={props.plateX[1]}
          min={-3}
          max={3}
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

      <Show when={props.showLayers && props.layers}>
        <div role="group" aria-label="layers" style={{ display: "flex", "flex-wrap": "wrap", "align-items": "center", gap: "2px 12px", width: "100%" }}>
          <span style={{ color: THEME.muted, "font-size": "11px", "letter-spacing": "0.02em" }}>Layers</span>
          <For each={LAYER_TOGGLES}>
            {(t) => <Toggle label={t.label} checked={props.layers![t.key]} onChange={(on) => props.onLayer?.(t.key, on)} />}
          </For>
        </div>
      </Show>
    </div>
  );
}
