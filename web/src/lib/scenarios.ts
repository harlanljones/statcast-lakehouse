/**
 * Demo scenario catalog. Data for each id is generated server-side
 * (ingestion/scenarios.py, GET /pitches/scenario/{id}); everything a viewer
 * sees around it (story copy, which layers/filters/camera to apply, which
 * controls matter) is declared here so the serving path stays Arrow-only.
 */
import type { CameraViewName, OutcomeFilter, ZoneFilter } from "./deck-layers";
import type { HeatmapMode } from "./heatmap";

export type ScenarioId =
  | "tunnel-vision"
  | "fatigue-arc"
  | "ghost-break"
  | "chase-map"
  | "contact-lab"
  | "corpus-slice";

export type LayerKey =
  | "tunneling"
  | "ghostBreak"
  | "releasePoints"
  | "plateCrossings"
  | "breakChart"
  | "pairComparison"
  | "contactSim"
  | "dispersion"
  | "fatigue"
  | "heatmap";

export type LensId =
  | "camera"
  | "flight"
  | "types"
  | "speed"
  | "plate"
  | "zone"
  | "outcome"
  | "heatmapMode"
  | "contact";

export interface ScenarioPreset {
  view: CameraViewName;
  speedRange: [number, number];
  plateXRange: [number, number];
  plateZRange: [number, number];
  zoneFilter: ZoneFilter;
  outcomeFilter: OutcomeFilter;
  selectedTypes: string[];
  layers: Record<LayerKey, boolean>;
  heatmapMode: HeatmapMode;
  batSpeed: number;
  attackAngleDeg: number;
  pairedTypes: [string, string] | null;
}

export interface Scenario {
  id: ScenarioId;
  title: string;
  /** ROADMAP sprint the use case comes from, or "market" for positioning. */
  sprint: string;
  hook: string;
  lookFor: string;
  tryThis: string;
  lens: LensId[];
  preset: ScenarioPreset;
}

const NO_LAYERS: Record<LayerKey, boolean> = {
  tunneling: false,
  ghostBreak: false,
  releasePoints: false,
  plateCrossings: false,
  breakChart: false,
  pairComparison: false,
  contactSim: false,
  dispersion: false,
  fatigue: false,
  heatmap: false,
};

const BASE: ScenarioPreset = {
  view: "Catcher",
  speedRange: [70, 105],
  plateXRange: [-2.5, 2.5],
  plateZRange: [0, 5],
  zoneFilter: "all",
  outcomeFilter: "all",
  selectedTypes: [],
  layers: NO_LAYERS,
  heatmapMode: "density",
  batSpeed: 75,
  attackAngleDeg: 10,
  pairedTypes: null,
};

/** Neutral preset applied when leaving scenario mode for the live sample. */
export const LIVE_PRESET: ScenarioPreset = BASE;

interface PresetOverride {
  view?: CameraViewName;
  speedRange?: [number, number];
  plateXRange?: [number, number];
  plateZRange?: [number, number];
  zoneFilter?: ZoneFilter;
  outcomeFilter?: OutcomeFilter;
  selectedTypes?: string[];
  layers?: Partial<Record<LayerKey, boolean>>;
  heatmapMode?: HeatmapMode;
  batSpeed?: number;
  attackAngleDeg?: number;
  pairedTypes?: [string, string] | null;
}

const preset = (over: PresetOverride): ScenarioPreset => {
  const layers: Record<LayerKey, boolean> = { ...NO_LAYERS, ...(over.layers ?? {}) };
  return {
    ...BASE,
    ...over,
    layers,
  };
};

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "tunnel-vision",
    title: "Tunnel Vision",
    sprint: "S8-9",
    hook: "Fastball, slider, changeup: identical until it's too late.",
    lookFor:
      "Three pitch types leave one arm slot and pass through nearly the same spot at the commitment plane, then split by more than a foot at the plate. The pair panel shows the Deception Tunnel Ratio.",
    tryThis: "Switch the pair to FF vs CH, then scrub flight progress to watch the paths separate.",
    lens: ["camera", "flight", "types"],
    preset: preset({
      view: "Pitcher",
      layers: { tunneling: true, pairComparison: true },
      pairedTypes: ["FF", "SL"],
    }),
  },
  {
    id: "fatigue-arc",
    title: "Fatigue Arc",
    sprint: "S11",
    hook: "One starter, 500 pitches, and the arm slowly gives way.",
    lookFor:
      "Velocity falls about 3 mph, the arm slot sinks about 3 inches, and the release cloud widens as the count climbs. The panel buckets it every 25 pitches.",
    tryThis: "Raise the minimum speed to 90 mph: the late-game pitches vanish first.",
    lens: ["camera", "speed", "types"],
    preset: preset({
      view: "Side",
      layers: { dispersion: true, fatigue: true, releasePoints: true },
    }),
  },
  {
    id: "ghost-break",
    title: "Ghost Break",
    sprint: "S5, S8",
    hook: "How far did each pitch really move?",
    lookFor:
      "A six-pitch arsenal from a sinker that runs arm-side to a curve that falls off the table. Each ghost path is the same pitch with no spin; the gold gap is the induced break.",
    tryThis: "Toggle types on the chart legend to isolate the curveball's vertical drop.",
    lens: ["camera", "flight", "types"],
    preset: preset({ view: "Catcher", layers: { ghostBreak: true, breakChart: true } }),
  },
  {
    id: "chase-map",
    title: "Chase Map",
    sprint: "S12",
    hook: "Where do swings turn into misses?",
    lookFor:
      "Whiffs pile up low and away, outside the zone, where batters chase. In-zone swings rarely miss. The heatmap is in Whiff % mode.",
    tryThis: "Set the zone filter to Chase and outcome to Whiffs: the cluster is almost the whole set.",
    lens: ["camera", "zone", "outcome", "heatmapMode"],
    preset: preset({
      view: "Catcher",
      layers: { heatmap: true },
      heatmapMode: "whiff_rate",
    }),
  },
  {
    id: "contact-lab",
    title: "Contact Lab",
    sprint: "S10",
    hook: "Same swing, different pitch, different result.",
    lookFor:
      "Pitch speeds from 70 to 100 mph meet a fixed bat. Hover a pitch to see the simulated exit velocity, launch angle, and contact quality. At 72 mph bat speed and 18 degrees, the harder pitches barrel first.",
    tryThis: "Drag attack angle down to 16 degrees and the barrels disappear; push it to 20 and nearly every pitch barrels.",
    lens: ["camera", "contact", "types"],
    preset: preset({
      view: "Batter",
      layers: { contactSim: true },
      batSpeed: 72,
      attackAngleDeg: 18,
    }),
  },
  {
    id: "corpus-slice",
    title: "Corpus Slice",
    sprint: "market",
    hook: "Savant 3D, but it's a query engine.",
    lookFor:
      "Ten pitchers with different release points and arsenals in one view. Every slider and chip filters on the GPU with no re-query: this is the corpus-scale exploration Savant's pre-rendered pages can't do.",
    tryThis: "Combine an outcome of Whiffs with a speed floor of 93 mph and a plate-height band.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "outcome"],
    preset: preset({ view: "Catcher" }),
  },
];

export const DEFAULT_SCENARIO_ID: ScenarioId = "tunnel-vision";

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export const scenarioUrl = (id: ScenarioId): string => `/pitches/scenario/${id}`;
export const scenarioSearch = (id: ScenarioId): string => `?scenario=${id}`;

export function parseScenarioParam(search: string): ScenarioId | null {
  const raw = new URLSearchParams(search).get("scenario");
  return raw && scenarioById(raw) ? (raw as ScenarioId) : null;
}
