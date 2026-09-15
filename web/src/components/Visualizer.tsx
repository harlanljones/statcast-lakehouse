import { createEffect, onCleanup, onMount } from "solid-js";
import { Deck, OrbitView } from "@deck.gl/core";
import type { PitchTable } from "../lib/arrow-loader";
import { INITIAL_VIEW, ORBIT_TARGET } from "../lib/deck-layers";

/**
 * Deck.gl canvas container. OrbitView in Cartesian space (z-up, feet).
 * The data prop is reactive; layer updates rebind GPU attributes without
 * touching CPU-side data (TDD §5.3 zero-latency filtering).
 */
export default function Visualizer(props: { data: PitchTable | null; filter: [number, number] }) {
  let container!: HTMLDivElement;
  let deck: Deck<OrbitView> | null = null;

  onMount(() => {
    deck = new Deck({
      parent: container,
      views: new OrbitView({}),
      viewState: INITIAL_VIEW,
      controller: true,
      layers: [],
    });
    onCleanup(() => deck?.finalize());
  });

  createEffect(() => {
    const d = props.data;
    if (!deck || !d) return;
    deck.setProps({
      layers: [
        // Trajectory layers land in Sprint 3 (docs/ROADMAP.md item 4);
        // wiring TripsLayer here without data styling would be a stub.
      ],
    });
  });

  return <div ref={container} style={{ flex: "1", width: "100%" }} aria-label={`orbit-target:${ORBIT_TARGET.join(",")}`} />;
}
