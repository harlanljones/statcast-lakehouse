import { createEffect, onCleanup, onMount } from "solid-js";
import { Deck } from "@deck.gl/core";
import type { PitchTable } from "../lib/arrow-loader";
import { INITIAL_VIEW, dataFilterExtension, ORBIT_TARGET } from "../lib/deck-layers";

/**
 * Deck.gl canvas container. OrbitView in Cartesian space (z-up, feet).
 * The data prop is reactive; filter changes rebind uniforms without
 * touching CPU-side data (TDD §5.3 zero-latency filtering).
 */
export default function Visualizer(props: { data: PitchTable | null; filter: [number, number] }) {
  let container!: HTMLDivElement;
  let deck: Deck | null = null;

  onMount(() => {
    deck = new Deck({
      parent: container,
      views: { id: "orbit", type: "OrbitView", flipY: false },
      viewState: INITIAL_VIEW,
      controller: true,
      layers: [],
      getTooltip: () => null,
    });
    onCleanup(() => deck?.finalize());
  });

  createEffect(() => {
    const d = props.data;
    if (!deck || !d) return;
    deck.setProps({
      layers: [
        // TripsLayer-style trajectories; import kept dynamic in ROADMAP
        // until the full TripsLayer wiring lands (see docs/ROADMAP.md).
      ],
    });
  });

  return <div ref={container} style={{ flex: "1", width: "100%" }} aria-label={ORBIT_TARGET.join(",")} data-filter={dataFilterExtension ? "gpu" : "cpu"} />;
}
