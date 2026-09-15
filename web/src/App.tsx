import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import Visualizer from "./components/Visualizer";
import ControlPanel from "./components/ControlPanel";
import { fetchPitches, type PitchTable } from "./lib/arrow-loader";

const [pitchData, setPitchData] = createSignal<PitchTable | null>(null);
const [speedRange, setSpeedRange] = createSignal<[number, number]>([70, 105]);

export default function App() {
  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", "flex-direction": "column" }}>
      <header>Statcast 3D — {pitchData()?.pitches.length ?? 0} pitches</header>
      <Visualizer data={pitchData()} filter={speedRange()} />
      <ControlPanel
        speed={speedRange()}
        onSpeed={setSpeedRange}
        onLoad={() => fetchPitches("/pitches/sample").then(setPitchData)}
      />
    </div>
  );
}

render(() => <App />, document.getElementById("root")!);
