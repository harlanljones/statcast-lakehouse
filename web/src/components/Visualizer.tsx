import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { Deck, OrbitView } from "@deck.gl/core";
import type { OrbitViewState, PickingInfo } from "@deck.gl/core";
import type { PitchTable } from "../lib/arrow-loader";
import {
  INITIAL_VIEW,
  ORBIT_TARGET,
  buildLayers,
  effectiveViewState,
  type PitchDatum,
  type ZoneFilter,
  type OutcomeFilter,
} from "../lib/deck-layers";
import { pitchTooltip, pitchTooltipSummary, clampTooltipPos } from "../lib/pitch-tooltip";
import {
  clampViewState,
  controllerOptions,
  fitCanvas,
  fromCanvasView,
  toCanvasView,
  withLimits,
  type DragMode,
} from "../lib/camera";
import BreakChart from "./BreakChart";
import PlayerCard from "./PlayerCard";
import PairComparisonPanel from "./PairComparisonPanel";
import FatiguePanel from "./FatiguePanel";
import type { ArsenalCentroid } from "../lib/arsenal";
import type { FatigueBucket, ReleaseDispersion } from "../lib/dispersion";
import type { HeatmapCell } from "../lib/heatmap";
import type { PitcherStoryline } from "../lib/storylines";

export interface VisualizerProps {
  data: PitchTable | null;
  filter: [number, number];
  plateXRange?: [number, number];
  plateZRange?: [number, number];
  zoneFilter?: ZoneFilter;
  outcomeFilter?: OutcomeFilter;
  selectedTypes?: ReadonlySet<string> | null;
  viewState?: OrbitViewState | null;
  /** What a plain drag does; shift/right-drag does the other one. */
  dragMode?: DragMode;
  /** Bump to snap the camera back to the current preset. */
  resetKey?: number;
  /** Generated pitches have made-up players, so the card never links out for them. */
  synthetic?: boolean;
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
  storylines?: readonly PitcherStoryline[];
  storylineDate?: string;
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
  // Click pins a pitch to the player card; hover stays tooltip-only.
  const [pinned, setPinned] = createSignal<PitchDatum | null>(null);
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

  // Expose the live camera as data attributes: handy for debugging and lets
  // browser tests assert that scroll / drag really moved the view.
  const publishCamera = (vs: OrbitViewState) => {
    if (!container) return;
    container.dataset.zoom = vs.zoom.toFixed(2);
    container.dataset.rotationX = (vs.rotationX ?? 0).toFixed(1);
    container.dataset.rotationOrbit = (vs.rotationOrbit ?? 0).toFixed(1);
    container.dataset.target = vs.target.map((n) => n.toFixed(2)).join(",");
  };

  // The camera is kept canvas-independent (presets, clamping and the published
  // zoom all live in the reference framing); deck.gl gets it through the fit
  // for the current canvas (zoom shift plus field of view), so every screen
  // frames the same slice of the field from the same camera position.
  let view: OrbitViewState = withLimits(INITIAL_VIEW);
  let fit = fitCanvas(0, 0);
  const applyView = (vs: OrbitViewState) => {
    view = vs;
    deck?.setProps({ viewState: toCanvasView(vs, fit.zoomOffset) });
    publishCamera(vs);
  };

  onMount(() => {
    fit = fitCanvas(container.clientWidth, container.clientHeight);
    view = withLimits(effectiveViewState(props.viewState, props.showHeatmap) ?? INITIAL_VIEW);
    deck = new Deck({
      parent: container,
      views: new OrbitView({ fovy: fit.fovy }),
      viewState: toCanvasView(view, fit.zoomOffset),
      controller: controllerOptions(props.dragMode ?? "rotate"),
      // Refit on every canvas resize (window, rotation, panels) without losing
      // where the user has orbited or zoomed to.
      onResize: ({ width, height }: { width: number; height: number }) => {
        const next = fitCanvas(width, height);
        if (next.zoomOffset === fit.zoomOffset && next.fovy === fit.fovy) return;
        const fovyChanged = next.fovy !== fit.fovy;
        fit = next;
        if (fovyChanged) deck?.setProps({ views: new OrbitView({ fovy: fit.fovy }) });
        applyView(view);
      },
      // A click on a pitch pins it; a click on empty space unpins. deck.gl does
      // not fire click after a drag, so orbiting the camera never pins.
      onClick: (info: PickingInfo) => {
        const o = info.object as Partial<PitchDatum> | null | undefined;
        const isPitch = !!o && typeof o.releaseSpeed === "number" && typeof o.pitchType === "string";
        setPinned(isPitch ? (o as PitchDatum) : null);
      },
      // Controlled camera: deck.gl only reports what the user did; we apply it
      // (clamped so the field cannot be panned or zoomed out of reach).
      onViewStateChange: ({ viewState }: { viewState: any }) => {
        applyView(clampViewState(fromCanvasView(viewState as OrbitViewState, fit.zoomOffset)));
      },
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
            picked: picked() ?? pinned(),
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
  // `resetKey` re-applies the same preset after the user has moved the camera.
  createEffect(() => {
    void props.resetKey;
    const vs = effectiveViewState(props.viewState, props.showHeatmap);
    if (deck && vs) applyView(withLimits(vs));
  });

  createEffect(() => {
    const mode = props.dragMode ?? "rotate";
    deck?.setProps({ controller: controllerOptions(mode) });
  });

  // A new group of pitches invalidates the pinned one.
  createEffect(() => {
    void props.data;
    setPinned(null);
  });

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(null);
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const tooltip = () => pitchTooltip(picked(), props.batSpeed, props.attackAngleDeg, props.showContactSim);

  return (
    <div class="app-viz" style={{ position: "relative", flex: "1", width: "100%", overflow: "hidden" }}>
      <div
        ref={container}
        style={{ width: "100%", height: "100%", overflow: "hidden" }}
        aria-label={`orbit-target:${ORBIT_TARGET.join(",")}`}
      />
      <Show when={pinned()}>
        {(p) => (
          <PlayerCard
            pitch={p()}
            pitches={props.data?.pitches ?? []}
            synthetic={props.synthetic ?? true}
            storylines={props.storylines}
            storylineDate={props.storylineDate}
            onClose={() => setPinned(null)}
          />
        )}
      </Show>
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "12px",
          bottom: "10px",
          "z-index": "5",
          "pointer-events": "none",
          "font-size": "11px",
          color: "rgba(148, 163, 184, 0.85)",
        }}
      >
        {props.dragMode === "pan"
          ? "Scroll: zoom · Drag: pan · Shift+drag: rotate"
          : "Scroll: zoom · Drag: rotate · Shift+drag: pan"}
      </div>
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
        {picked() ? pitchTooltipSummary(picked()!, props.batSpeed, props.attackAngleDeg, props.showContactSim) : ""}
      </span>
      {/* keyed: capture the tooltip once, so a hover that ends cannot re-read null in the inner effects */}
      <Show when={tooltip()} keyed>
        {(t) => (
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
                background: `rgb(${t.color.join(",")})`,
              }}
            />
            {t.pitchType}
          </div>
          <div>{t.speed}</div>
          {t.spin && <div style={{ color: "#a0e0a0" }}>{t.spin}</div>}
          <div>{t.location}</div>
          {t.break && <div style={{ color: "#ffd700" }}>{t.break}</div>}
          {t.tunnel && <div style={{ color: "#ffd700" }}>{t.tunnel}</div>}
          {t.release && <div style={{ color: "#80d0ff" }}>{t.release}</div>}
          {t.extension && <div style={{ color: "#80d0ff" }}>{t.extension}</div>}
          {t.zoneBounds && <div style={{ color: "#a0e0ff" }}>{t.zoneBounds}</div>}
          <div>{t.zone}</div>
          {t.outcome && <div>{t.outcome}</div>}
          {t.simulatedContact && (
            <div style={{ color: "#ff99ff", "margin-top": "3px", "border-top": "1px solid #444", "padding-top": "2px" }}>
              {t.simulatedContact}
            </div>
          )}
        </div>
        )}
      </Show>
    </div>
  );
}
