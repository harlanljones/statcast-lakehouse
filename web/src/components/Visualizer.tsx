import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Deck, OrbitView } from "@deck.gl/core";
import type { OrbitViewState, PickingInfo } from "@deck.gl/core";
import type { PitchTable } from "../lib/arrow-loader";
import {
  INITIAL_VIEW,
  ORBIT_TARGET,
  buildLayers,
  type PitchDatum,
  type ZoneFilter,
  type OutcomeFilter,
} from "../lib/deck-layers";
import { pitchTooltip, pitchTooltipSummary, clampTooltipPos } from "../lib/pitch-tooltip";

export interface VisualizerProps {
  data: PitchTable | null;
  filter: [number, number];
  plateXRange?: [number, number];
  plateZRange?: [number, number];
  zoneFilter?: ZoneFilter;
  outcomeFilter?: OutcomeFilter;
  selectedTypes?: ReadonlySet<string> | null;
  viewState?: OrbitViewState | null;
  flightProgress?: number;
  showTunneling?: boolean;
  showGhostBreak?: boolean;
}

/**
 * Deck.gl canvas container. OrbitView in Cartesian space (z-up, feet).
 * The data, filter, and camera viewState props are reactive; slider drags
 * and camera snaps rebind GPU filter uniforms / the view state only — no
 * CPU-side data filtering ever happens (TDD §5.3).
 *
 * Hover/click picking is deck.gl GPU picking on the trajectory layer; the
 * picked object is pure tooltip state and never touches filter uniforms.
 */
export default function Visualizer(props: VisualizerProps) {
  let container!: HTMLDivElement;
  let deck: Deck<OrbitView> | null = null;
  const [picked, setPicked] = createSignal<PitchDatum | null>(null);
  // Cursor-anchored tooltip position (canvas-relative px, already clamped).
  const [tipPos, setTipPos] = createSignal({ x: 0, y: 0 });
  // Estimated rendered card size for clamping (matches the styled card below).
  const CARD_W = 160;
  const CARD_H = 120;

  const handlePick = (info: PickingInfo<PitchDatum>) => {
    const obj = info.object ?? null;
    // Identity guard: deck.gl fires onHover per pixel; only notify Solid
    // when the picked datum actually changed, so repeated hover events on
    // the same path never rebuild the layer (zero-JS interaction path).
    if (obj !== picked()) {
      setPicked(obj);
    }
    if (obj) {
      setTipPos(
        clampTooltipPos(
          info.x ?? 0,
          info.y ?? 0,
          CARD_W,
          CARD_H,
          container.clientWidth,
          container.clientHeight,
        ),
      );
    }
  };

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

  // Tracks props.data, props.filter, props.plateXRange, props.plateZRange,
  // props.zoneFilter, props.outcomeFilter, props.selectedTypes, and picked():
  // a slider drag or filter toggle only rebinds DataFilterExtension uniforms
  // — zero JavaScript array traversal on the interaction path — and a pick
  // only re-evaluates the per-datum getWidth accessor via updateTriggers.
  createEffect(() => {
    if (!deck) return;
    const d = props.data;
    deck.setProps({
      layers: d
        ? buildLayers({
            pitches: d.pitches,
            speedRange: props.filter,
            plateXRange: props.plateXRange,
            plateZRange: props.plateZRange,
            zoneFilter: props.zoneFilter,
            outcomeFilter: props.outcomeFilter,
            selectedTypes: props.selectedTypes ?? null,
            picked: picked(),
            onHover: handlePick,
            flightProgress: props.flightProgress,
            showTunneling: props.showTunneling,
            showGhostBreak: props.showGhostBreak,
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

  const tooltip = () => pitchTooltip(picked());

  return (
    <div style={{ position: "relative", flex: "1", width: "100%" }}>
      <div
        ref={container}
        style={{ flex: "1", width: "100%", height: "100%" }}
        aria-label={`orbit-target:${ORBIT_TARGET.join(",")}`}
      />
      {/* aria-live status: announces the hovered pitch for screen readers.
          Visually hidden via inline styles (no global CSS in this app). */}
      <span
        role="status"
        aria-live="polite"
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: "0",
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          "white-space": "nowrap",
          border: "0",
        }}
      >
        {picked() ? pitchTooltipSummary(picked()!) : ""}
      </span>
      {tooltip() && (
        <div
          role="presentation"
          style={{
            position: "absolute",
            top: `${tipPos().y}px`,
            left: `${tipPos().x}px`,
            width: "160px",
            "pointer-events": "none",
            background: "rgba(15, 15, 20, 0.88)",
            color: "#eee",
            padding: "6px 10px",
            "border-radius": "6px",
            "font-size": "12px",
            "font-family": "monospace",
            "white-space": "pre",
            "box-shadow": "0 4px 12px rgba(0,0,0,0.5)",
          }}
        >
          <div>
            <span
              style={{
                display: "inline-block",
                width: "10px",
                height: "10px",
                "border-radius": "2px",
                "margin-right": "6px",
                background: `rgb(${tooltip()!.color.join(",")})`,
              }}
            />
            {tooltip()!.pitchType}
          </div>
          <div>{tooltip()!.speed}</div>
          <div>{tooltip()!.location}</div>
          {tooltip()!.break && <div style={{ color: "#ffd700" }}>{tooltip()!.break}</div>}
          <div>{tooltip()!.zone}</div>
          {tooltip()!.outcome && <div>{tooltip()!.outcome}</div>}
        </div>
      )}
    </div>
  );
}

