import { render } from "solid-js/web";
import { batch, createEffect, createMemo, createSignal, onMount, Show } from "solid-js";
import "./app.css";
import Visualizer from "./components/Visualizer";
import {
  fetchDatePartitions,
  fetchPitches,
  type DatePartition,
  type PitchTable,
} from "./lib/arrow-loader";
import { fetchPitcherStorylines, type PitcherStoryline } from "./lib/storylines";
import { extractGameDate, distinctPitchTypes, computeWhiffRate, formatDataStatus } from "./lib/data-status";
import {
  CAMERA_VIEWS,
  type CameraViewName,
  type ZoneFilter,
  type OutcomeFilter,
  type PitchDatum,
  passesFilters,
} from "./lib/deck-layers";
import { computeArsenalCentroids } from "./lib/arsenal";
import {
  computeReleaseDispersion,
  computeFatigueBuckets,
  distinctPitcherCount,
  fatiguePitcher,
} from "./lib/dispersion";
import { computeStrikeZoneHeatmap, type HeatmapMode } from "./lib/heatmap";

import ScenarioRail from "./components/ScenarioRail";
import StoryCaption from "./components/StoryCaption";
import { SCENE_ACCENT } from "./lib/theme";
import LensPanel from "./components/LensPanel";
import {
  ALL_LENSES,
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
import { applyPresetFiltersTo, applyPresetTo } from "./lib/scenario-state";
import { nextPlayState, prefersReducedMotion } from "./lib/playback";
import type { DragMode } from "./lib/camera";
import { isSyntheticSource, playerLabel, type DataSource } from "./lib/player-card";
export default function App() {
  const [pitchData, setPitchData] = createSignal<PitchTable | null>(null);
  const [speedRange, setSpeedRange] = createSignal<[number, number]>([70, 105]);
  const [plateXRange, setPlateXRange] = createSignal<[number, number]>([-3, 3]);
  const [plateZRange, setPlateZRange] = createSignal<[number, number]>([-1, 6]);
  const [zoneFilter, setZoneFilter] = createSignal<ZoneFilter>("all");
  const [outcomeFilter, setOutcomeFilter] = createSignal<OutcomeFilter>("all");
  const [view, setView] = createSignal<CameraViewName>("Catcher");
  const [dragMode, setDragMode] = createSignal<DragMode>("rotate");
  // Where the loaded pitches came from; the player card links out only for real data.
  // Starts as synthetic so a missing source can never imply a real player.
  const [dataSource, setDataSource] = createSignal<DataSource>({ kind: "scenario", synthetic: true });
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
  const [storylines, setStorylines] = createSignal<PitcherStoryline[]>([]);
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
  // Pitch pinned to the player card (click or arrow keys); the fatigue panel follows its pitcher.
  const [pinned, setPinned] = createSignal<PitchDatum | null>(null);
  const activeScenario = createMemo(() => {
    const id = activeScenarioId();
    return id ? scenarioById(id) ?? null : null;
  });

  // The pitches the GPU filter lets through, mirrored on the CPU with the same
  // predicate (passesFilters) for counts and the 2D analysis panels. Memoized on
  // state change, not per frame; the 3D layers always receive the full array and
  // filter on the GPU.
  const visiblePitches = createMemo<PitchDatum[]>(() => {
    const all = pitchData()?.pitches ?? [];
    const opts = {
      speedRange: speedRange(),
      plateXRange: plateXRange(),
      plateZRange: plateZRange(),
      zoneFilter: zoneFilter(),
      outcomeFilter: outcomeFilter(),
      selectedTypes: selectedTypes(),
    };
    return all.filter((p) => passesFilters(p, opts));
  });
  const activeCount = () => visiblePitches().length;

  // Display-only derived values (badge + chips). The type chips list every
  // loaded type (so a deselected one can be switched back on); the analysis
  // panels follow the filters.
  const availableTypes = createMemo(() => distinctPitchTypes(pitchData()?.pitches ?? []));
  const gameDate = createMemo(() => {
    const d = pitchData();
    return d ? extractGameDate(d.table) : null;
  });
  const whiffRate = createMemo(() => computeWhiffRate(visiblePitches()));
  const arsenalCentroids = createMemo(() => {
    if (!showPairComparison() && !pairedTypes()) return null;
    return computeArsenalCentroids(visiblePitches());
  });
  const releaseDispersion = createMemo(() => {
    if (!showDispersion()) return null;
    return computeReleaseDispersion(visiblePitches(), 1.5);
  });
  // Fatigue is per pitcher: the pinned pitch's pitcher, else the one who threw most.
  const fatigueInfo = createMemo(() => {
    const vis = visiblePitches();
    const id = fatiguePitcher(vis, pinned()?.pitcherId);
    const sample = id == null ? undefined : vis.find((p) => p.pitcherId === id);
    return {
      id,
      label: id == null ? undefined : playerLabel("Pitcher", id, isSyntheticSource(dataSource()), sample?.pitcherName),
      count: distinctPitcherCount(vis),
    };
  });
  const fatigueBuckets = createMemo(() => {
    if (!showFatigue()) return [];
    return computeFatigueBuckets(visiblePitches(), 25, fatigueInfo().id);
  });
  const heatmapCells = createMemo(() => {
    if (!showHeatmap()) return null;
    return computeStrikeZoneHeatmap(visiblePitches(), heatmapMode());
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
    setStorylines([]);
    const seq = ++loadSeq;
    setIsLoading(true);
    setErrorMessage(null);
    fetchPitches(`/pitches?date=${date}`)
      .then((data) => {
        if (seq !== loadSeq) return;
        setDataSource({ kind: "partition", date });
        setPitchData(data);
      })
      .catch((err) => {
        console.error("Failed to load date partition:", err);
        if (seq === loadSeq) setErrorMessage(`Failed to load ${date}: ${err.message}`);
      })
      .finally(() => {
        if (seq === loadSeq) setIsLoading(false);
      });
    // Editorial metadata should enrich, never block, the Arrow pitch view.
    fetchPitcherStorylines(date)
      .then((items) => {
        if (seq === loadSeq) setStorylines(items);
      })
      .catch((err) => console.warn("Failed to load pitcher storylines:", err));
  };

  const handleLoadSample = () => {
    const seq = ++loadSeq;
    setIsLoading(true);
    setErrorMessage(null);
    fetchPitches("/pitches/sample")
      .then((data) => {
        if (seq !== loadSeq) return;
        setSelectedDate("");
        setStorylines([]);
        setDataSource({ kind: "sample" });
        setPitchData(data);
      })
      .catch((err) => {
        console.error("Failed to load sample pitches:", err);
        if (seq === loadSeq) setErrorMessage(`Failed to load sample pitches: ${err.message}`);
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
      setStorylines([]);
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
        if (seq !== loadSeq) return;
        setDataSource({ kind: "scenario", synthetic: sc.synthetic });
        setPitchData(data);
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
    const next = nextPlayState(isPlaying(), prefersReducedMotion());
    batch(() => {
      setIsPlaying(next.playing);
      if (next.progress !== undefined) setFlightProgress(next.progress);
    });
  };

  // Reset filters: re-apply the active scenario's preset filters only (view and layers stay).
  const resetFilters = () =>
    applyPresetFiltersTo((activeScenario()?.preset ?? LIVE_PRESET), {
      setSpeedRange,
      setPlateXRange,
      setPlateZRange,
      setZoneFilter,
      setOutcomeFilter,
      setSelectedTypes,
    });

  onMount(() => {
    // Date partitions only feed the Live data card; failure is non-fatal.
    if (!STATIC_SCENARIOS) fetchDatePartitions().then(setDatePartitions).catch(() => {});
    selectScenario(parseScenarioParam(location.search) ?? DEFAULT_SCENARIO_ID);
  });

  // A new group of pitches invalidates the pinned one.
  createEffect(() => {
    void pitchData();
    setPinned(null);
  });

  const layerState = (): Record<LayerKey, boolean> => ({
    tunneling: showTunneling(),
    ghostBreak: showGhostBreak(),
    releasePoints: showReleasePoints(),
    plateCrossings: showPlateCrossings(),
    breakChart: showBreakChart(),
    pairComparison: showPairComparison(),
    contactSim: showContactSim(),
    dispersion: showDispersion(),
    fatigue: showFatigue(),
    heatmap: showHeatmap(),
  });
  // A scenario shows its own lenses; "All controls" (and Live data) show every lens plus the layer toggles.
  const controlsOpen = () => showAllControls() || activeScenario() !== null;
  const lensIds = () => (showAllControls() || !activeScenario() ? ALL_LENSES : activeScenario()!.lens);

  return (
    <div class="app-shell" style={{ "--accent": SCENE_ACCENT[activeScenarioId() ?? ""] ?? "#60a5fa" }}>
      <header class="app-header">
        <div style={{ display: "flex", "align-items": "baseline", gap: "12px" }}>
          <h1 class="app-title">Statcast Lakehouse</h1>
          <span class="app-subtitle">GPU-filtered 3D pitch exploration</span>
          <Show when={isLoading()}>
            <span role="status" style={{ color: "var(--accent)", "font-size": "12px" }}>Loading…</span>
          </Show>
          <Show when={errorMessage()}>
            <span role="alert" style={{ color: "var(--bad)", "font-size": "12px" }}>{errorMessage()}</span>
          </Show>
        </div>
        <button class="ui-ctl ui-ghost" aria-pressed={showAllControls()} onClick={() => setShowAllControls((v) => !v)}>
          {showAllControls() ? "Hide all controls" : "All controls"}
        </button>
      </header>

      <div class="app-body">
        <ScenarioRail
          scenarios={SCENARIOS}
          activeId={activeScenarioId()}
          onSelect={selectScenario}
          liveActive={activeScenarioId() === null}
          onLive={selectLive}
          showLive={!STATIC_SCENARIOS}
          datePartitions={datePartitions()}
          selectedDate={selectedDate()}
          onSelectDate={handleSelectDate}
          onLoadSample={handleLoadSample}
          loading={isLoading()}
        />
        <main class="app-main">
          <StoryCaption
            scenario={activeScenario()}
            activeCount={activeCount()}
            totalCount={pitchData()?.pitches.length ?? 0}
            whiffRate={whiffRate()}
            dataStatus={formatDataStatus(pitchData()?.pitches.length ?? 0, gameDate())}
            onResetFilters={resetFilters}
          />
          <Visualizer
            data={pitchData()}
            visiblePitches={visiblePitches()}
            filter={speedRange()}
            plateXRange={plateXRange()}
            plateZRange={plateZRange()}
            zoneFilter={zoneFilter()}
            outcomeFilter={outcomeFilter()}
            selectedTypes={selectedTypes()}
            viewState={CAMERA_VIEWS[view()]}
            dragMode={dragMode()}
            resetKey={resetKey()}
            synthetic={isSyntheticSource(dataSource())}
            pinned={pinned()}
            onPin={setPinned}
            flightProgress={isPlaying() || flightProgress() < 1.0 ? flightProgress() : undefined}
            isPlaying={isPlaying()}
            onFlightProgress={setFlightProgress}
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
            fatiguePitcherLabel={fatigueInfo().label}
            fatiguePitcherCount={fatigueInfo().count}
            onToggleFatigue={setShowFatigue}
            showHeatmap={showHeatmap()}
            heatmapCells={heatmapCells()}
            storylines={storylines()}
            storylineDate={selectedDate() || undefined}
          />
          <Show when={controlsOpen()}>
            <LensPanel
              lens={lensIds()}
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
              showLayers={showAllControls()}
              layers={layerState()}
              onLayer={(key, on) => layerSetters[key](on)}
            />
          </Show>
        </main>
      </div>
    </div>
  );
}

render(() => <App />, document.getElementById("root")!);
