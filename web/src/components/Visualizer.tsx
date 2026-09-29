import { Show, Suspense, createEffect, createMemo, createSignal, lazy, onCleanup, onMount, untrack } from "solid-js";
import { Deck, OrbitView } from "@deck.gl/core";
import type { Layer, OrbitViewState, PickingInfo } from "@deck.gl/core";
import type { PitchTable } from "../lib/arrow-loader";
import {
  INITIAL_VIEW,
  buildLayers,
  effectiveViewState,
  pickedLayers,
  type BuildLayersOpts,
  type PitchDatum,
  type ZoneFilter,
  type OutcomeFilter,
} from "../lib/deck-layers";
import { pitchTooltip, pitchTooltipSummary, clampTooltipPos, cursorFlight } from "../lib/pitch-tooltip";
import {
  clampViewState,
  controllerOptions,
  fitCanvas,
  fromCanvasView,
  toCanvasView,
  withLimits,
  type DragMode,
} from "../lib/camera";
import { keyboardCameraStep, stepPitch } from "../lib/keyboard";
import PlayerCard from "./PlayerCard";
import { THEME } from "./ui";
import type { ArsenalCentroid } from "../lib/arsenal";
import type { FatigueBucket, ReleaseDispersion } from "../lib/dispersion";
import type { HeatmapCell } from "../lib/heatmap";
import type { PitcherStoryline } from "../lib/storylines";

// Analysis panels are lazy chunks: they only load when their layer is switched on.
const BreakChart = lazy(() => import("./BreakChart"));
const PairComparisonPanel = lazy(() => import("./PairComparisonPanel"));
const FatiguePanel = lazy(() => import("./FatiguePanel"));

export interface VisualizerProps {
  data: PitchTable | null;
  /** The pitches passing the current filters (the CPU mirror of the GPU filter); feeds the 2D panels and keyboard stepping. */
  visiblePitches?: readonly PitchDatum[];
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
  /** Pitch pinned to the player card (click or arrow keys); owned by App so panels can follow it. */
  pinned?: PitchDatum | null;
  onPin?: (pitch: PitchDatum | null) => void;
  flightProgress?: number;
  isPlaying?: boolean;
  /** Called at most ~10 times a second while a flight plays, so the slider can follow. */
  onFlightProgress?: (v: number) => void;
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
  fatiguePitcherLabel?: string;
  fatiguePitcherCount?: number;
  onToggleFatigue?: (v: boolean) => void;
  showHeatmap?: boolean;
  heatmapCells?: HeatmapCell[] | null;
  storylines?: readonly PitcherStoryline[];
  storylineDate?: string;
}

/** Wall-clock length of one flight replay. */
const FLIGHT_SECONDS = 1.2;
/** How often the playing progress is published back to Solid (ms). */
const PROGRESS_PUBLISH_MS = 100;

/**
 * Deck.gl canvas container. OrbitView in Cartesian space (z-up, feet).
 * The data, filter, and camera viewState props are reactive; slider drags
 * and camera snaps rebind GPU filter uniforms / the view state only — no
 * CPU-side data filtering ever happens (TDD §5.3).
 *
 * Effects are split so each interaction touches as little as possible:
 *  - base layers rebuild when data, filters or layer toggles change;
 *  - the picked-highlight layers rebuild on hover/pin only;
 *  - while a flight plays, a rAF loop rebuilds the base layer list, in which
 *    only the TripsLayer's currentTime differs (everything else is
 *    reference-identical, see buildLayers).
 */
export default function Visualizer(props: VisualizerProps) {
  let container!: HTMLDivElement;
  let tipEl: HTMLDivElement | undefined;
  let deck: Deck<OrbitView> | null = null;
  const [picked, setPicked] = createSignal<PitchDatum | null>(null);
  // Raw pointer position of the hover (canvas-relative px); the tooltip clamps itself once measured.
  const [tipRaw, setTipRaw] = createSignal({ x: 0, y: 0 });
  // World y (ft from plate) of the hovered point on the path, from 3D picking.
  const [cursorY, setCursorY] = createSignal<number | null>(null);
  const pinned = () => props.pinned ?? null;
  const visible = () => props.visiblePitches ?? props.data?.pitches ?? [];
  const descId = "viz-desc";

  // ---- Hover: ignore while dragging, coalesce to one update per frame ----
  let dragging = false;
  let hoverFrame: number | null = null;
  let pendingHover: PickingInfo<PitchDatum> | null = null;

  const flushHover = () => {
    hoverFrame = null;
    const info = pendingHover;
    pendingHover = null;
    if (!info || dragging) return;
    const obj = info.object ?? null;
    // Identity guard: only notify Solid when the picked datum actually changed.
    if (obj !== picked()) setPicked(obj);
    if (obj) {
      const coord = info.coordinate;
      setCursorY(coord && coord.length >= 3 ? coord[1] : null);
      setTipRaw({ x: info.x ?? 0, y: info.y ?? 0 });
    }
  };

  const handleHover = (info: PickingInfo<PitchDatum>) => {
    if (dragging) return;
    pendingHover = info;
    if (hoverFrame === null) hoverFrame = requestAnimationFrame(flushHover);
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

  // ---- Layer state shared by the effects below ----
  let baseOpts: BuildLayersOpts | null = null;
  let baseLayers: Layer[] = [];
  let pickedList: Layer[] = [];
  const pushLayers = () => deck?.setProps({ layers: [...baseLayers, ...pickedList] });

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
        props.onPin?.(isPitch ? (o as PitchDatum) : null);
      },
      // Controlled camera: deck.gl only reports what the user did; we apply it
      // (clamped so the field cannot be panned or zoomed out of reach).
      onViewStateChange: ({ viewState }: { viewState: any }) => {
        applyView(clampViewState(fromCanvasView(viewState as OrbitViewState, fit.zoomOffset)));
      },
      layers: [],
    });

    // Track pointer drags so hover picking never runs during camera navigation.
    const down = () => { dragging = true; };
    const up = () => { dragging = false; };
    container.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);

    onCleanup(() => {
      container.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (hoverFrame !== null) cancelAnimationFrame(hoverFrame);
      deck?.finalize();
    });
  });

  // Base layers. Tracks data, filters and layer toggles: a slider drag or
  // filter toggle only rebinds DataFilterExtension uniforms (memoized filter
  // props, no array traversal). Hover/pin and playback frames are NOT tracked
  // here (flightProgress is read untracked while playing).
  createEffect(() => {
    if (!deck) return;
    const d = props.data;
    const playing = !!props.isPlaying;
    const flightProgress = playing ? untrack(() => props.flightProgress) : props.flightProgress;
    baseOpts = d
      ? {
          pitches: d.pitches,
          speedRange: props.filter,
          plateXRange: props.plateXRange,
          plateZRange: props.plateZRange,
          zoneFilter: props.zoneFilter,
          outcomeFilter: props.outcomeFilter,
          selectedTypes: props.selectedTypes ?? null,
          onHover: handleHover,
          flightProgress,
          isPlaying: playing,
          showTunneling: props.showTunneling,
          showGhostBreak: props.showGhostBreak,
          showReleasePoints: props.showReleasePoints,
          showPlateCrossings: props.showPlateCrossings,
          pairedTypes: props.pairedTypes,
          arsenalCentroids: props.arsenalCentroids,
          showDispersion: props.showDispersion,
          releaseDispersion: props.releaseDispersion,
          showHeatmap: props.showHeatmap,
          heatmapCells: props.heatmapCells,
        }
      : null;
    baseLayers = baseOpts ? buildLayers(baseOpts) : [];
    pushLayers();
  });

  // Picked-highlight layers: a hover or pin swaps only these few layers.
  createEffect(() => {
    const pk = picked() ?? pinned();
    pickedList = props.data
      ? pickedLayers(pk, {
          showContactSim: props.showContactSim,
          batSpeed: props.batSpeed,
          attackAngleDeg: props.attackAngleDeg,
        })
      : [];
    pushLayers();
  });

  // Flight playback: one rAF loop while playing. Each frame rebuilds the base
  // list with a new flightProgress; only the TripsLayer's currentTime uniform
  // differs, so deck.gl re-uploads nothing. Progress is published to Solid at
  // ~10 Hz so the slider follows without re-running the layer effects.
  createEffect(() => {
    if (!props.isPlaying) return;
    let progress = untrack(() => props.flightProgress) ?? 1;
    // The last value written to App's signal: anything else in props.flightProgress
    // is an external seek (the slider) that we adopt instead of overwriting.
    let lastPublished = progress;
    let last = performance.now();
    let lastPublishTime = last;
    let id = 0;
    const publish = () => {
      lastPublished = progress;
      props.onFlightProgress?.(progress);
    };
    const tick = (now: number) => {
      const external = props.flightProgress;
      if (external !== undefined && external !== lastPublished) {
        progress = external;
        lastPublished = external;
      }
      progress += (now - last) / 1000 / FLIGHT_SECONDS;
      last = now;
      if (progress >= 1) progress = 0;
      if (baseOpts && deck) {
        baseLayers = buildLayers({ ...baseOpts, flightProgress: progress, isPlaying: true });
        pushLayers();
      }
      if (now - lastPublishTime >= PROGRESS_PUBLISH_MS) {
        lastPublishTime = now;
        publish();
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    onCleanup(() => {
      cancelAnimationFrame(id);
      // Land the paused ball exactly where the animation stopped, unless
      // something else (a scenario switch, a slider seek) already moved it.
      const external = props.flightProgress;
      if (external !== undefined && external === lastPublished) publish();
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

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onPin?.(null);
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  // Keyboard on the focused canvas: arrows step the pinned pitch through the
  // visible set; Up/Down zoom, Shift+Up/Down orbit (through the clamped applyView).
  const onCanvasKey = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = stepPitch(visible(), pinned(), e.key === "ArrowRight" ? 1 : -1);
      if (next) props.onPin?.(next);
      return;
    }
    const step = keyboardCameraStep(view, e.key, e.shiftKey);
    if (step) {
      e.preventDefault();
      applyView(clampViewState(step));
    }
  };

  const tooltip = createMemo(() => pitchTooltip(picked(), props.batSpeed, props.attackAngleDeg, props.showContactSim));

  // A new group of pitches invalidates the hovered one (App clears the pinned one).
  createEffect(() => {
    void props.data;
    setPicked(null);
  });

  // Measure the tooltip element itself (no fixed card size) and clamp it inside the canvas.
  createEffect(() => {
    tooltip();
    const raw = tipRaw();
    if (!tipEl) return;
    const pos = clampTooltipPos(raw.x, raw.y, tipEl.offsetWidth, tipEl.offsetHeight, container.clientWidth, container.clientHeight);
    tipEl.style.left = `${pos.x}px`;
    tipEl.style.top = `${pos.y}px`;
  });

  const shownText = () => `${visible().length} of ${props.data?.pitches.length ?? 0} pitches shown; use left and right arrow keys to step through pitches`;

  return (
    <div class="app-viz">
      <div
        ref={container}
        class="viz-canvas"
        role="group"
        tabindex="0"
        aria-label="3D pitch trajectories"
        aria-describedby={descId}
        onKeyDown={onCanvasKey}
      />
      <span id={descId} class="sr-only">{shownText()}</span>

      <div class="viz-dock-left">
        <Suspense>
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
              pitcherLabel={props.fatiguePitcherLabel}
              pitcherCount={props.fatiguePitcherCount}
              onClose={() => props.onToggleFatigue?.(false)}
            />
          </Show>
        </Suspense>
      </div>

      <div class="viz-dock-right">
        <Suspense>
          <Show when={props.showBreakChart && props.data?.pitches}>
            <BreakChart pitches={visible() as PitchDatum[]} picked={picked() ?? pinned()} onPick={(p) => setPicked(p)} />
          </Show>
        </Suspense>
        <Show when={pinned()}>
          {(p) => (
            <PlayerCard
              pitch={p()}
              pitches={visible()}
              synthetic={props.synthetic ?? true}
              storylines={props.storylines}
              storylineDate={props.storylineDate}
              onClose={() => props.onPin?.(null)}
            />
          )}
        </Show>
      </div>

      <div
        class="viz-hint"
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
      {/* Announces the pinned pitch (not every hover). */}
      <span class="sr-only" aria-live="polite">
        {pinned() ? pitchTooltipSummary(pinned()!, props.batSpeed, props.attackAngleDeg, props.showContactSim) : ""}
      </span>
      {/* keyed: capture the tooltip once, so a hover that ends cannot re-read null in the inner effects */}
      <Show when={tooltip()} keyed>
        {(t) => (
          <div
            ref={(el) => { tipEl = el; }}
            role="presentation"
            style={{
              position: "absolute",
              top: `${tipRaw().y}px`,
              left: `${tipRaw().x}px`,
              width: "max-content",
              "max-width": "280px",
              "pointer-events": "none",
              "z-index": "15",
              background: "rgba(15, 15, 20, 0.92)",
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
            {t.break && <div style={{ color: THEME.gold }}>{t.break}</div>}
            {t.tunnel && <div style={{ color: THEME.gold }}>{t.tunnel}</div>}
            {t.release && <div style={{ color: "#80d0ff" }}>{t.release}</div>}
            {t.extension && <div style={{ color: "#80d0ff" }}>{t.extension}</div>}
            {t.zoneBounds && <div style={{ color: "#a0e0ff" }}>{t.zoneBounds}</div>}
            <div>{t.zone}</div>
            {t.outcome && <div>{t.outcome}</div>}
            <Show when={cursorFlight(picked(), cursorY())}>
              {(c) => (
                <div style={{ color: "#c8c8ff" }}>
                  {c().distance}
                  {"\n"}
                  {c().remaining}
                </div>
              )}
            </Show>
            {t.simulatedContact && (
              <div style={{ color: "#ff99ff", "margin-top": "3px", "border-top": `1px solid ${THEME.border}`, "padding-top": "2px" }}>
                {t.simulatedContact}
              </div>
            )}
          </div>
        )}
      </Show>
    </div>
  );
}
