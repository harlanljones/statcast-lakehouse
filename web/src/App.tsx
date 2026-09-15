import { render } from "solid-js/web";
import { createMemo, createSignal } from "solid-js";
import Visualizer from "./components/Visualizer";
import ControlPanel from "./components/ControlPanel";
import { fetchPitches, type PitchTable } from "./lib/arrow-loader";
import { CAMERA_VIEWS, type CameraViewName } from "./lib/deck-layers";

const [pitchData, setPitchData] = createSignal<PitchTable | null>(null);
const [speedRange, setSpeedRange] = createSignal<[number, number]>([70, 105]);
const [view, setView] = createSignal<CameraViewName>("Catcher");
const [selectedTypes, setSelectedTypes] = createSignal<ReadonlySet<string>>(new Set());

// Display-only derived values (badge + chips). These run once per signal
// change, never per frame; the layer data itself is never filtered in JS.
const availableTypes = createMemo(() => {
  const counts = new Map<string, number>();
  for (const p of pitchData()?.pitches ?? []) counts.set(p.pitchType, (counts.get(p.pitchType) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
});
const activeCount = createMemo(() => {
  const pitches = pitchData()?.pitches ?? [];
  const sel = selectedTypes();
  const [lo, hi] = speedRange();
  return pitches.filter(
    (p) => p.releaseSpeed >= lo && p.releaseSpeed <= hi && (sel.size === 0 || sel.has(p.pitchType)),
  ).length;
});
const toggleType = (code: string) => {
  const next = new Set(selectedTypes());
  if (next.has(code)) next.delete(code);
  else next.add(code);
  setSelectedTypes(next);
};

export default function App() {
  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", "flex-direction": "column" }}>
      <header>Statcast 3D — {pitchData()?.pitches.length ?? 0} pitches</header>
      <Visualizer
        data={pitchData()}
        filter={speedRange()}
        selectedTypes={selectedTypes()}
        viewState={CAMERA_VIEWS[view()]}
      />
      <ControlPanel
        speed={speedRange()}
        onSpeed={setSpeedRange}
        onLoad={() => fetchPitches("/pitches/sample").then(setPitchData)}
        view={view()}
        onView={setView}
        activeCount={activeCount()}
        totalCount={pitchData()?.pitches.length ?? 0}
        availableTypes={availableTypes()}
        selectedTypes={selectedTypes()}
        onToggleType={toggleType}
      />
    </div>
  );
}

render(() => <App />, document.getElementById("root")!);
