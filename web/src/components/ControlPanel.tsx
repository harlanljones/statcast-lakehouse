import { For, Show, type JSX } from "solid-js";
import { CAMERA_VIEWS, type CameraViewName, pitchColor } from "../lib/deck-layers";

/**
 * Control panel. Every control writes Solid signals; Visualizer rebinds
 * Deck.gl filter uniforms / view state from those signals. No array
 * filtering happens here (TDD §5.3).
 *
 * Controls:
 * - Load button
 * - Camera view preset buttons (Catcher / Pitcher / Overhead / Side)
 * - Pitch count badge (active / total)
 * - Pitch-type chips with color dots matching PITCH_COLORS; toggling a chip
 *   updates the GPU filter's 4th channel, never the data array.
 */
export default function ControlPanel(props: {
  speed: [number, number];
  onSpeed: (v: [number, number]) => void;
  onLoad: () => void;
  view: CameraViewName;
  onView: (v: CameraViewName) => void;
  activeCount: number;
  totalCount: number;
  availableTypes: string[];
  selectedTypes: ReadonlySet<string>;
  onToggleType: (code: string) => void;
}): JSX.Element {
  const setMin = (v: number) => {
    props.onSpeed([Math.min(v, props.speed[1]), props.speed[1]]);
  };
  const setMax = (v: number) => {
    props.onSpeed([props.speed[0], Math.max(v, props.speed[0])]);
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
      <button onClick={props.onLoad}>Load sample day</button>

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

      <span
        role="status"
        aria-label="pitch count"
        title="pitches passing current filters / total loaded"
      >
        {props.activeCount}/{props.totalCount} pitches
      </span>

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
            onInput={(e) => setMin(Number(e.currentTarget.value))}
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
            onInput={(e) => setMax(Number(e.currentTarget.value))}
          />
        </label>
      </Show>
    </footer>
  );
}
