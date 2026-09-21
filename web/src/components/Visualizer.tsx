import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
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
import BreakChart from "./BreakChart";
import PairComparisonPanel from "./PairComparisonPanel";
import FatiguePanel from "./FatiguePanel";
import type { ArsenalCentroid } from "../lib/arsenal";
import type { FatigueBucket, ReleaseDispersion } from "../lib/dispersion";
import type { HeatmapCell } from "../lib/heatmap";

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
  showReleasePoints?: boolean;
  showPlateCrossings?: boolean;
  showBreakChart?: boolean;
  pairedTypes?: [string, string] | null;
  arsenalCentroids?: Map<string, ArsenalCentroid> | null;
  showPairComparison?: boolean;
  onSelectPairedTypes?: (pair: [string, string] | null) => void;
  availableTypes?: string[];
  onTogglePairComparison?: (v: boolean) => void;
  showContactSim?: boolean;
  batSpeed?: number;
  attackAngleDeg?: number;
  showDispersion?: boolean;
  releaseDispersion?: ReleaseDispersion | null;
  showFatigue?: boolean;
  fatigueBuckets?: FatigueBucket[];
  onToggleFatigue?: (v: boolean) => void;
  showHeatmap?: boolean;
  heatmapCells?: HeatmapCell[] | null;
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
  const CARD_W = 180;
  const CARD_H = 240;

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

    // Debounce hover picking pass to eliminate pointermove micro-stalls
    // during continuous mouse movement or camera orbiting (gl.readPixels GPU flush).
    let hoverTimer: ReturnType<typeof setTimeout> | null = null;
    // deck.gl's picking pass is a private API: only patch it when present, so a
    // deck.gl upgrade that renames it degrades to un-debounced hover instead of
    // failing the whole mount.
    const rawPick = (deck as any)._pickAndCallback;
    if (typeof rawPick === "function") {
      const origPick = rawPick.bind(deck);

      (deck as any)._pickAndCallback = function () {
        const req = (this as any)._pickRequest;
        if (!req || !req.event) return;

        // Pointer left canvas — clear hover immediately
        if (req.event.type === "pointerleave" || req.x === -1) {
          if (hoverTimer) {
            clearTimeout(hoverTimer);
            hoverTimer = null;
          }
          origPick();
          return;
        }

        // Drag / orbit active — never pick during camera navigation
        if (req.event.leftButton || req.event.rightButton) {
          if (hoverTimer) {
            clearTimeout(hoverTimer);
            hoverTimer = null;
          }
          req.event = null;
          return;
        }

        const savedX = req.x;
        const savedY = req.y;
        const savedRadius = req.radius;
        const savedCanvasId = req.canvasId;
        const savedEvent = req.event;
        req.event = null;

        if (hoverTimer) clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
          hoverTimer = null;
          const currentReq = (this as any)._pickRequest;
          if (currentReq) {
            currentReq.x = savedX;
            currentReq.y = savedY;
            currentReq.radius = savedRadius;
            currentReq.canvasId = savedCanvasId;
            currentReq.event = savedEvent;
            origPick();
            (deck as any)?.redraw();
          }
        }, 75);
      };
    }

    onCleanup(() => {
      if (hoverTimer) clearTimeout(hoverTimer);
      deck?.finalize();
    });
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
            showReleasePoints: props.showReleasePoints,
            showPlateCrossings: props.showPlateCrossings,
            pairedTypes: props.pairedTypes,
            arsenalCentroids: props.arsenalCentroids,
            showContactSim: props.showContactSim,
            batSpeed: props.batSpeed,
            attackAngleDeg: props.attackAngleDeg,
            showDispersion: props.showDispersion,
            releaseDispersion: props.releaseDispersion,
            showHeatmap: props.showHeatmap,
            heatmapCells: props.heatmapCells,
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

  const tooltip = () => pitchTooltip(picked(), props.batSpeed, props.attackAngleDeg);

  return (
    <div style={{ position: "relative", flex: "1", width: "100%", overflow: "hidden" }}>
      <div
        ref={container}
        style={{ width: "100%", height: "100%", overflow: "hidden" }}
        aria-label={`orbit-target:${ORBIT_TARGET.join(",")}`}
      />
      <Show when={props.showBreakChart && props.data?.pitches}>
        <BreakChart
          pitches={props.data!.pitches}
          picked={picked()}
          onPick={(p) => setPicked(p)}
        />
      </Show>
      <Show when={props.showPairComparison && props.arsenalCentroids}>
        <PairComparisonPanel
          availableTypes={props.availableTypes ?? []}
          pairedTypes={props.pairedTypes ?? null}
          onSelectPairedTypes={(pair) => props.onSelectPairedTypes?.(pair)}
          centroids={props.arsenalCentroids!}
          onClose={() => props.onTogglePairComparison?.(false)}
        />
      </Show>
      <Show when={props.showFatigue && props.fatigueBuckets}>
        <FatiguePanel
          buckets={props.fatigueBuckets!}
          dispersion={props.releaseDispersion}
          onClose={() => props.onToggleFatigue?.(false)}
        />
      </Show>
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
        {picked() ? pitchTooltipSummary(picked()!, props.batSpeed, props.attackAngleDeg) : ""}
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
          {tooltip()!.spin && <div style={{ color: "#a0e0a0" }}>{tooltip()!.spin}</div>}
          <div>{tooltip()!.location}</div>
          {tooltip()!.break && <div style={{ color: "#ffd700" }}>{tooltip()!.break}</div>}
          {tooltip()!.tunnel && <div style={{ color: "#ffd700" }}>{tooltip()!.tunnel}</div>}
          {tooltip()!.release && <div style={{ color: "#80d0ff" }}>{tooltip()!.release}</div>}
          {tooltip()!.extension && <div style={{ color: "#80d0ff" }}>{tooltip()!.extension}</div>}
          {tooltip()!.zoneBounds && <div style={{ color: "#a0e0ff" }}>{tooltip()!.zoneBounds}</div>}
          <div>{tooltip()!.zone}</div>
          {tooltip()!.outcome && <div>{tooltip()!.outcome}</div>}
          {tooltip()!.simulatedContact && (
            <div style={{ color: "#ff99ff", "margin-top": "3px", "border-top": "1px solid #444", "padding-top": "2px" }}>
              {tooltip()!.simulatedContact}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

