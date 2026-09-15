import { Show, type JSX } from "solid-js";

/**
 * Slider panel. onChange writes Solid signals; Visualizer rebinds Deck.gl
 * filter uniforms from those signals. No array filtering happens here.
 */
export default function ControlPanel(props: {
  speed: [number, number];
  onSpeed: (v: [number, number]) => void;
  onLoad: () => void;
}): JSX.Element {
  return (
    <footer style={{ display: "flex", gap: "16px", padding: "8px" }}>
      <button onClick={props.onLoad}>Load sample day</button>
      <Show when={props.speed}>
        <label>
          min mph{" "}
          <input
            type="range"
            min={60}
            max={105}
            value={props.speed[0]}
            onInput={(e) => props.onSpeed([Number(e.currentTarget.value), props.speed[1]])}
          />
        </label>
        <label>
          max mph{" "}
          <input
            type="range"
            min={60}
            max={105}
            value={props.speed[1]}
            onInput={(e) => props.onSpeed([props.speed[0], Number(e.currentTarget.value)])}
          />
        </label>
      </Show>
    </footer>
  );
}
