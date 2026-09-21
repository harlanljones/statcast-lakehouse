import { render } from "solid-js/web";
import { batch, createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";
import Visualizer from "./components/Visualizer";
import ControlPanel from "./components/ControlPanel";
import {
  fetchDatePartitions,
  fetchPitches,
  type DatePartition,
  type PitchTable,
} from "./lib/arrow-loader";
import { extractGameDate, distinctPitchTypes, computeWhiffRate } from "./lib/data-status";
import {
  CAMERA_VIEWS,
  type CameraViewName,
  type ZoneFilter,
  type OutcomeFilter,
  isInsideStrikeZone,
} from "./lib/deck-layers";
import { computeArsenalCentroids } from "./lib/arsenal";
import { computeReleaseDispersion, computeFatigueBuckets } from "./lib/dispersion";
import { computeStrikeZoneHeatmap, type HeatmapMode } from "./lib/heatmap";

import ScenarioRail from "./components/ScenarioRail";
import StoryCaption from "./components/StoryCaption";
import { SCENE_ACCENT } from "./components/ui";
import LensPanel from "./components/LensPanel";
import {
  DEFAULT_SCENARIO_ID,
  LIVE_PRESET,
  SCENARIOS,
  STATIC_SCENARIOS,
  parseScenarioParam,
  scenarioById,
  scenarioSearch,
  scenarioUrl,
  type ScenarioId,
  type LayerKey,
  type ScenarioPreset,
} from "./lib/scenarios";
import { applyPresetTo } from "./lib/scenario-state";
import type { DragMode } from "./lib/camera";
export default function App() {
  const [pitchData, setPitchData] = createSignal<PitchTable | null>(null);
  const [speedRange, setSpeedRange] = createSignal<[number, number]>([70, 105]);
  const [plateXRange, setPlateXRange] = createSignal<[number, number]>([-2.5, 2.5]);
  const [plateZRange, setPlateZRange] = createSignal<[number, number]>([0, 5]);
  const [zoneFilter, setZoneFilter] = createSignal<ZoneFilter>("all");
  const [outcomeFilter, setOutcomeFilter] = createSignal<OutcomeFilter>("all");
  const [view, setView] = createSignal<CameraViewName>("Catcher");
  const [dragMode, setDragMode] = createSignal<DragMode>("rotate");
  // Bumped to snap the camera back to the current preset, even when the preset
  // did not change (the user may have moved the camera by hand).
  const [resetKey, setResetKey] = createSignal(0);
  const resetView = () => setResetKey((k) => k + 1);
  const selectView = (v: CameraViewName) => {
    setView(v);
    resetView();
  };
  const [selectedTypes, setSelectedTypes] = createSignal<ReadonlySet<string>>(new Set());
  const [datePartitions, setDatePartitions] = createSignal<DatePartition[]>([]);
  const [selectedDate, setSelectedDate] = createSignal<string>("");
  const [flightProgress, setFlightProgress] = createSignal<number>(1.0);
  const [isPlaying, setIsPlaying] = createSignal<boolean>(false);
  const [isLoading, setIsLoading] = createSignal<boolean>(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [showTunneling, setShowTunneling] = createSignal<boolean>(false);
  const [showGhostBreak, setShowGhostBreak] = createSignal<boolean>(false);
  const [showReleasePoints, setShowReleasePoints] = createSignal<boolean>(false);
  const [showPlateCrossings, setShowPlateCrossings] = createSignal<boolean>(false);
  const [showBreakChart, setShowBreakChart] = createSignal<boolean>(false);
  const [showPairComparison, setShowPairComparison] = createSignal<boolean>(false);
  const [pairedTypes, setPairedTypes] = createSignal<[string, string] | null>(null);
  const [showContactSim, setShowContactSim] = createSignal<boolean>(false);
  const [batSpeed, setBatSpeed] = createSignal<number>(75.0);
  const [attackAngleDeg, setAttackAngleDeg] = createSignal<number>(10.0);
  const [showDispersion, setShowDispersion] = createSignal<boolean>(false);
  const [showFatigue, setShowFatigue] = createSignal<boolean>(false);
  const [showHeatmap, setShowHeatmap] = createSignal<boolean>(false);
  const [heatmapMode, setHeatmapMode] = createSignal<HeatmapMode>("density");
  const [activeScenarioId, setActiveScenarioId] = createSignal<ScenarioId | null>(null);
  const [showAllControls, setShowAllControls] = createSignal<boolean>(false);
  const activeScenario = createMemo(() => {
    const id = activeScenarioId();
    return id ? scenarioById(id) ?? null : null;
  });

  // Display-only derived values (badge + chips). These run once per signal
  // change, never per frame; the layer data itself is never filtered in JS.
  const availableTypes = createMemo(() => distinctPitchTypes(pitchData()?.pitches ?? []));
  const gameDate = createMemo(() => {
    const d = pitchData();
    return d ? extractGameDate(d.table) : null;
  });
  const whiffRate = createMemo(() => {
    const pitches = pitchData()?.pitches ?? [];
    return computeWhiffRate(pitches);
  });
  const arsenalCentroids = createMemo(() => {
    if (!showPairComparison() && !pairedTypes()) return null;
    const pitches = pitchData()?.pitches ?? [];
    return computeArsenalCentroids(pitches);
  });
  const releaseDispersion = createMemo(() => {
    if (!showDispersion()) return null;
    const pitches = pitchData()?.pitches ?? [];
    return computeReleaseDispersion(pitches, 1.5);
  });
  const fatigueBuckets = createMemo(() => {
    if (!showFatigue()) return [];
    const pitches = pitchData()?.pitches ?? [];
    return computeFatigueBuckets(pitches, 25);
  });
  const heatmapCells = createMemo(() => {
    if (!showHeatmap()) return null;
    const pitches = pitchData()?.pitches ?? [];
    return computeStrikeZoneHeatmap(pitches, heatmapMode());
  });

  const activeCount = createMemo(() => {
    const pitches = pitchData()?.pitches ?? [];
    const sel = selectedTypes();
    const [speedLo, speedHi] = speedRange();
    const [xLo, xHi] = plateXRange();
    const [zLo, zHi] = plateZRange();
    const zf = zoneFilter();
    const of = outcomeFilter();

    return pitches.filter((p) => {
      if (p.releaseSpeed < speedLo || p.releaseSpeed > speedHi) return false;
      const x = p.plateX ?? p.pfxX ?? 0;
      const z = p.plateZ ?? p.pfxZ ?? 0;
      if (x < xLo || x > xHi) return false;
      if (z < zLo || z > zHi) return false;
      if (sel.size > 0 && !sel.has(p.pitchType)) return false;
      if (zf === "in_zone" && !isInsideStrikeZone(x, z)) return false;
      if (zf === "out_of_zone" && isInsideStrikeZone(x, z)) return false;
      if (of === "swings" && !p.isSwing) return false;
      if (of === "whiffs" && !p.isWhiff) return false;
      return true;
    }).length;
  });

  const toggleType = (code: string) => {
    const next = new Set(selectedTypes());
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setSelectedTypes(next);
  };

  // Latest-request-wins token shared by every loader.
  let loadSeq = 0;

  const exitScenarioMode = () => {
    setActiveScenarioId(null);
    try {
      history.replaceState(null, "", location.pathname);
    } catch {
      /* non-browser test env */
    }
  };

  const handleSelectDate = (date: string) => {
    setSelectedDate(date);
    if (!date) return;
    exitScenarioMode();
    setPitchData(null);
    const seq = ++loadSeq;
    setIsLoading(true);
    setErrorMessage(null);
    fetchPitches(`/pitches?date=${date}`)
      .then((data) => {
        if (seq === loadSeq) setPitchData(data);
      })
      .catch((err) => {
        console.error("Failed to load date partition:", err);
        if (seq === loadSeq) setErrorMessage(`Failed to load ${date}: ${err.message}`);
      })
      .finally(() => {
        if (seq === loadSeq) setIsLoading(false);
      });
  };

  const handleLoadSample = () => {
    const seq = ++loadSeq;
    setIsLoading(true);
    setErrorMessage(null);
    fetchPitches("/pitches/sample")
      .then((data) => {
        if (seq !== loadSeq) return;
        setSelectedDate("");
        setPitchData(data);
      })
      .catch((err) => {
        console.error("Failed to load sample day:", err);
        if (seq === loadSeq) setErrorMessage(`Failed to load sample day: ${err.message}`);
      })
      .finally(() => {
        if (seq === loadSeq) setIsLoading(false);
      });
  };

  const layerSetters: Record<LayerKey, (on: boolean) => void> = {
    tunneling: setShowTunneling,
    ghostBreak: setShowGhostBreak,
    releasePoints: setShowReleasePoints,
    plateCrossings: setShowPlateCrossings,
    breakChart: setShowBreakChart,
    pairComparison: setShowPairComparison,
    contactSim: setShowContactSim,
    dispersion: setShowDispersion,
    fatigue: setShowFatigue,
    heatmap: setShowHeatmap,
  };

  const applyPreset = (p: ScenarioPreset) =>
    applyPresetTo(p, {
      setView,
      setSpeedRange,
      setPlateXRange,
      setPlateZRange,
      setZoneFilter,
      setOutcomeFilter,
      setSelectedTypes,
      setLayer: (key, on) => layerSetters[key](on),
      setHeatmapMode,
      setBatSpeed,
      setAttackAngleDeg,
      setPairedTypes,
    });

  const selectScenario = (id: ScenarioId) => {
    const sc = scenarioById(id);
    if (!sc) return;
    const seq = ++loadSeq;
    batch(() => {
      setActiveScenarioId(id);
      applyPreset(sc.preset);
      resetView();
      setPitchData(null);
      setIsPlaying(false);
      setFlightProgress(1.0);
      setSelectedDate("");
      setErrorMessage(null);
      setIsLoading(true);
    });
    try {
      history.replaceState(null, "", scenarioSearch(id));
    } catch {
      /* non-browser test env */
    }
    fetchPitches(scenarioUrl(id))
      .then((data) => {
        if (seq === loadSeq) setPitchData(data);
      })
      .catch((err) => {
        console.error("Failed to load scenario:", err);
        if (seq === loadSeq) setErrorMessage(`Failed to load ${sc.title}: ${err.message}`);
      })
      .finally(() => {
        if (seq === loadSeq) setIsLoading(false);
      });
  };

  const selectLive = () => {
    batch(() => {
      exitScenarioMode();
      applyPreset(LIVE_PRESET);
      setPitchData(null);
      setShowAllControls(true);
    });
    handleLoadSample();
  };


  const togglePlay = () => {
    setIsPlaying((prev) => !prev);
  };

  onMount(() => {
    // Date partitions only feed the Live data drawer; failure is non-fatal.
    if (!STATIC_SCENARIOS) fetchDatePartitions().then(setDatePartitions).catch(() => {});
    selectScenario(parseScenarioParam(location.search) ?? DEFAULT_SCENARIO_ID);
  });

  createEffect(() => {
    if (!isPlaying()) return;

    let lastTime = performance.now();
    let animId: number;

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      setFlightProgress((prev) => {
        const next = prev + dt / 1.2;
        return next >= 1.0 ? 0.0 : next;
      });
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    onCleanup(() => {
      cancelAnimationFrame(animId);
    });
  });

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", "flex-direction": "column", overflow: "hidden", "--accent": SCENE_ACCENT[activeScenarioId() ?? ""] ?? "#60a5fa" }}>
      <header
        style={{
          position: "relative",
          "z-index": "20",
          background: "rgba(10, 15, 30, 0.95)",
          "border-bottom": "1px solid rgba(255, 255, 255, 0.12)",
          padding: "8px 16px",
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
        }}
      >
        <div style={{ display: "flex", "align-items": "baseline", gap: "12px" }}>
          <strong style={{ "font-size": "15px" }}>Statcast Lakehouse</strong>
          <span style={{ "font-size": "12px", color: "#94a3b8" }}>GPU-filtered 3D pitch exploration</span>
          <Show when={isLoading()}>
            <span role="status" style={{ color: "#60a5fa", "font-size": "12px" }}>Loading…</span>
          </Show>
          <Show when={errorMessage()}>
            <span role="alert" style={{ color: "#f87171", "font-size": "12px" }}>{errorMessage()}</span>
          </Show>
        </div>
        <button class="ui-ctl ui-ghost" aria-pressed={showAllControls()} onClick={() => setShowAllControls((v) => !v)}>
          {showAllControls() ? "Hide all controls" : "All controls"}
        </button>
      </header>

      <div style={{ flex: "1", display: "flex", "min-height": "0" }}>
        <ScenarioRail
          scenarios={SCENARIOS}
          activeId={activeScenarioId()}
          onSelect={selectScenario}
          liveActive={activeScenarioId() === null}
          onLive={selectLive}
          showLive={!STATIC_SCENARIOS}
        />
        <main style={{ flex: "1", display: "flex", "flex-direction": "column", "min-width": "0" }}>
          <StoryCaption
            scenario={activeScenario()}
            activeCount={activeCount()}
            totalCount={pitchData()?.pitches.length ?? 0}
          />
          <Visualizer
            data={pitchData()}
            filter={speedRange()}
            plateXRange={plateXRange()}
            plateZRange={plateZRange()}
            zoneFilter={zoneFilter()}
            outcomeFilter={outcomeFilter()}
            selectedTypes={selectedTypes()}
            viewState={CAMERA_VIEWS[view()]}
            dragMode={dragMode()}
            resetKey={resetKey()}
            flightProgress={isPlaying() || flightProgress() < 1.0 ? flightProgress() : undefined}
            showTunneling={showTunneling()}
            showGhostBreak={showGhostBreak()}
            showReleasePoints={showReleasePoints()}
            showPlateCrossings={showPlateCrossings()}
            showBreakChart={showBreakChart()}
            showPairComparison={showPairComparison()}
            pairedTypes={pairedTypes()}
            onSelectPairedTypes={setPairedTypes}
            arsenalCentroids={arsenalCentroids()}
            availableTypes={availableTypes()}
            onTogglePairComparison={setShowPairComparison}
            showContactSim={showContactSim()}
            batSpeed={batSpeed()}
            attackAngleDeg={attackAngleDeg()}
            showDispersion={showDispersion()}
            releaseDispersion={releaseDispersion()}
            showFatigue={showFatigue()}
            fatigueBuckets={fatigueBuckets()}
            onToggleFatigue={setShowFatigue}
            showHeatmap={showHeatmap()}
            heatmapCells={heatmapCells()}
          />
          <Show when={activeScenario()}>
            {(s) => (
              <LensPanel
                lens={s().lens}
                view={view()}
                onView={selectView}
                dragMode={dragMode()}
                onDragMode={setDragMode}
                onResetView={resetView}
                isPlaying={isPlaying()}
                onTogglePlay={togglePlay}
                flightProgress={flightProgress()}
                onFlightProgress={setFlightProgress}
                availableTypes={availableTypes()}
                selectedTypes={selectedTypes()}
                onToggleType={toggleType}
                speed={speedRange()}
                onSpeed={setSpeedRange}
                plateX={plateXRange()}
                onPlateX={setPlateXRange}
                plateZ={plateZRange()}
                onPlateZ={setPlateZRange}
                zoneFilter={zoneFilter()}
                onZoneFilter={setZoneFilter}
                outcomeFilter={outcomeFilter()}
                onOutcomeFilter={setOutcomeFilter}
                heatmapMode={heatmapMode()}
                onHeatmapMode={setHeatmapMode}
                batSpeed={batSpeed()}
                onBatSpeed={setBatSpeed}
                attackAngleDeg={attackAngleDeg()}
                onAttackAngleDeg={setAttackAngleDeg}
              />
            )}
          </Show>
        </main>
      </div>

      <Show when={showAllControls()}>
        <div style={{ "max-height": "45vh", "overflow-y": "auto" }}>
          <ControlPanel
            speed={speedRange()}
            onSpeed={setSpeedRange}
            plateX={plateXRange()}
            onPlateX={setPlateXRange}
            plateZ={plateZRange()}
            onPlateZ={setPlateZRange}
            // Static build has no /pitches/sample: the drawer's load button reloads the active scenario.
            onLoad={STATIC_SCENARIOS ? () => selectScenario(activeScenarioId() ?? DEFAULT_SCENARIO_ID) : handleLoadSample}
            loading={isLoading()}
            datePartitions={datePartitions()}
            selectedDate={selectedDate()}
            onSelectDate={handleSelectDate}
            view={view()}
            onView={selectView}
            zoneFilter={zoneFilter()}
            onZoneFilter={setZoneFilter}
            outcomeFilter={outcomeFilter()}
            onOutcomeFilter={setOutcomeFilter}
            whiffRate={whiffRate()}
            activeCount={activeCount()}
            totalCount={pitchData()?.pitches.length ?? 0}
            gameDate={gameDate()}
            availableTypes={availableTypes()}
            selectedTypes={selectedTypes()}
            onToggleType={toggleType}
            flightProgress={flightProgress()}
            onFlightProgress={setFlightProgress}
            isPlaying={isPlaying()}
            onTogglePlay={togglePlay}
            showTunneling={showTunneling()}
            onToggleTunneling={setShowTunneling}
            showGhostBreak={showGhostBreak()}
            onToggleGhostBreak={setShowGhostBreak}
            showReleasePoints={showReleasePoints()}
            onToggleReleasePoints={setShowReleasePoints}
            showPlateCrossings={showPlateCrossings()}
            onTogglePlateCrossings={setShowPlateCrossings}
            showBreakChart={showBreakChart()}
            onToggleBreakChart={setShowBreakChart}
            showPairComparison={showPairComparison()}
            onTogglePairComparison={setShowPairComparison}
            showContactSim={showContactSim()}
            onToggleContactSim={setShowContactSim}
            batSpeed={batSpeed()}
            onBatSpeed={setBatSpeed}
            attackAngleDeg={attackAngleDeg()}
            onAttackAngleDeg={setAttackAngleDeg}
            showDispersion={showDispersion()}
            onToggleDispersion={setShowDispersion}
            showFatigue={showFatigue()}
            onToggleFatigue={setShowFatigue}
            showHeatmap={showHeatmap()}
            onToggleHeatmap={setShowHeatmap}
            heatmapMode={heatmapMode()}
            onHeatmapMode={setHeatmapMode}
          />
        </div>
      </Show>
    </div>
  );
}

render(() => <App />, document.getElementById("root")!);
