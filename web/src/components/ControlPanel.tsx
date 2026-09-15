import { Show, type JSX } from "solid-js";

/**
 * Slider panel. onChange writes Solid signals; Visualizer rebinds Deck.gl
 * filter uniforms from those signals. No array filtering happens here.
 *
 * The min/max sliders clamp against each other so the GPU filterRange is
 * always well-formed, and both expose a live numeric readout.
 */
export default function ControlPanel(props: {
  speed: [number, number];
  onSpeed: (v: [number, number]) => void;
  onLoad: () => void;
}): JSX.Element {
  const setMin = (v: number) => {
    props.onSpeed([Math.min(v, props.speed[1]), props.speed[1]]);
  };
  const setMax = (v: number) => {
    props.onSpeed([props.speed[0], Math.max(v, props.speed[0])]);
  };

  return (
    <footer
      role="contentinfo"
      style={{ display: "flex", "align-items": "center", gap: "16px", padding: "8px" }}
    >
      <button onClick={props.onLoad}>Load sample day</button>
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
