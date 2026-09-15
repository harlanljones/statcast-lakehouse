import { createEffect, onCleanup, onMount } from "solid-js";
import { Deck, OrbitView } from "@deck.gl/core";
import type { PitchTable } from "../lib/arrow-loader";
import { INITIAL_VIEW, ORBIT_TARGET, buildLayers } from "../lib/deck-layers";

/**
 * Deck.gl canvas container. OrbitView in Cartesian space (z-up, feet).
 * The data and filter props are reactive; slider ranges rebind GPU filter
 * uniforms only — no CPU-side data filtering ever happens (TDD §5.3).
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

  // Tracks both props.data and props.filter: a slider drag only rebinds
  // DataFilterExtension uniforms — zero JavaScript array traversal.
  createEffect(() => {
    if (!deck) return;
    const d = props.data;
    deck.setProps({
      layers: d ? buildLayers({ pitches: d.pitches, speedRange: props.filter }) : [],
    });
  });

  return <div ref={container} style={{ flex: "1", width: "100%" }} aria-label={`orbit-target:${ORBIT_TARGET.join(",")}`} />;
}
