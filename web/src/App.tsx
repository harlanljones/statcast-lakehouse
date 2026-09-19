import { render } from "solid-js/web";
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
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

const [pitchData, setPitchData] = createSignal<PitchTable | null>(null);
const [speedRange, setSpeedRange] = createSignal<[number, number]>([70, 105]);
const [plateXRange, setPlateXRange] = createSignal<[number, number]>([-2.5, 2.5]);
const [plateZRange, setPlateZRange] = createSignal<[number, number]>([0, 5]);
const [zoneFilter, setZoneFilter] = createSignal<ZoneFilter>("all");
const [outcomeFilter, setOutcomeFilter] = createSignal<OutcomeFilter>("all");
const [view, setView] = createSignal<CameraViewName>("Catcher");
const [selectedTypes, setSelectedTypes] = createSignal<ReadonlySet<string>>(new Set());
const [datePartitions, setDatePartitions] = createSignal<DatePartition[]>([]);
const [selectedDate, setSelectedDate] = createSignal<string>("");
const [flightProgress, setFlightProgress] = createSignal<number>(1.0);
const [isPlaying, setIsPlaying] = createSignal<boolean>(false);
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
  const pitches = pitchData()?.pitches ?? [];
  return computeArsenalCentroids(pitches);
});
const releaseDispersion = createMemo(() => {
  const pitches = pitchData()?.pitches ?? [];
  return computeReleaseDispersion(pitches, 1.5);
});
const fatigueBuckets = createMemo(() => {
  const pitches = pitchData()?.pitches ?? [];
  return computeFatigueBuckets(pitches, 25);
});
const heatmapCells = createMemo(() => {
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

const handleSelectDate = (date: string) => {
  setSelectedDate(date);
  if (date) {
    fetchPitches(`/pitches?date=${date}`).then(setPitchData);
  }
};

const handleLoadSample = () => {
  fetchPitches("/pitches/sample").then(setPitchData);
};

const togglePlay = () => {
  setIsPlaying((prev) => !prev);
};

export default function App() {
  onMount(() => {
    fetchDatePartitions().then(setDatePartitions);
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
    <div style={{ width: "100vw", height: "100vh", display: "flex", "flex-direction": "column" }}>
      <header>Statcast 3D — {pitchData()?.pitches.length ?? 0} pitches</header>
      <Visualizer
        data={pitchData()}
        filter={speedRange()}
        plateXRange={plateXRange()}
        plateZRange={plateZRange()}
        zoneFilter={zoneFilter()}
        outcomeFilter={outcomeFilter()}
        selectedTypes={selectedTypes()}
        viewState={CAMERA_VIEWS[view()]}
        flightProgress={flightProgress()}
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
      <ControlPanel
        speed={speedRange()}
        onSpeed={setSpeedRange}
        plateX={plateXRange()}
        onPlateX={setPlateXRange}
        plateZ={plateZRange()}
        onPlateZ={setPlateZRange}
        onLoad={handleLoadSample}
        datePartitions={datePartitions()}
        selectedDate={selectedDate()}
        onSelectDate={handleSelectDate}
        view={view()}
        onView={setView}
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
  );
}


render(() => <App />, document.getElementById("root")!);
