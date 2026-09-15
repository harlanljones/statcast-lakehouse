import { createEffect, onCleanup, onMount } from "solid-js";
import { Deck, OrbitView } from "@deck.gl/core";
import type { OrbitViewState } from "@deck.gl/core";
import type { PitchTable } from "../lib/arrow-loader";
import { INITIAL_VIEW, ORBIT_TARGET, buildLayers } from "../lib/deck-layers";

/**
 * Deck.gl canvas container. OrbitView in Cartesian space (z-up, feet).
 * The data, filter, and camera viewState props are reactive; slider drags
 * and camera snaps rebind GPU filter uniforms / the view state only — no
 * CPU-side data filtering ever happens (TDD §5.3).
 */
export default function Visualizer(props: {
  data: PitchTable | null;
  filter: [number, number];
  selectedTypes?: ReadonlySet<string> | null;
  viewState?: OrbitViewState | null;
}) {
  let container!: HTMLDivElement;
  let deck: Deck<OrbitView> | null = null;

  onMount(() => {
    deck = new Deck({
      parent: container,
      views: new OrbitView({}),
      viewState: props.viewState ?? INITIAL_VIEW,
      controller: true,
      layers: [],
    });
    onCleanup(() => deck?.finalize());
  });

  // Tracks props.data, props.filter, and props.selectedTypes: a slider drag
  // or pitch-type toggle only rebinds DataFilterExtension uniforms — zero
  // JavaScript array traversal on the interaction path.
  createEffect(() => {
    if (!deck) return;
    const d = props.data;
    deck.setProps({
      layers: d
        ? buildLayers({
            pitches: d.pitches,
            speedRange: props.filter,
            selectedTypes: props.selectedTypes ?? null,
          })
        : [],
    });
  });

  // Camera preset snap: pushing a new viewState into the Deck viewState prop
  // re-targets OrbitView without touching layers or data.
  createEffect(() => {
    const vs = props.viewState;
    if (deck && vs) deck.setProps({ viewState: vs });
  });

  return <div ref={container} style={{ flex: "1", width: "100%" }} aria-label={`orbit-target:${ORBIT_TARGET.join(",")}`} />;
}
