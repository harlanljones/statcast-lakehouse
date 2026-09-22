/**
 * Demo scenario catalog. Generated scenarios are available from the serving
 * API (and are pre-exported for static hosting). A small number of committed
 * real-data scenarios may instead point directly at a static Arrow asset, so
 * they work in local and Pages builds without FastAPI.
 */
import type { CameraViewName, OutcomeFilter, ZoneFilter } from "./deck-layers";
import type { HeatmapMode } from "./heatmap";

export type ScenarioId =
  | "tunnel-vision"
  | "fatigue-arc"
  | "ghost-break"
  | "chase-map"
  | "contact-lab"
  | "corpus-slice"
  | "imanaga-no-hitter";

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
  /** True for generated pitches: their players are made up, so the card never links out. */
  synthetic: boolean;
  /**
   * Arrow asset embedded in `public/`, used for a committed real-data demo.
   * Unlike generated scenarios, this must be used in both local and static
   * builds because FastAPI deliberately has no matching scenario endpoint.
   */
  assetUrl?: string;
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
    synthetic: true,
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
    synthetic: true,
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
    synthetic: true,
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
    synthetic: true,
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
    synthetic: true,
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
    synthetic: true,
    hook: "Savant 3D, but it's a query engine.",
    lookFor:
      "Ten pitchers with different release points and arsenals in one view. Every slider and chip filters on the GPU with no re-query: this is the corpus-scale exploration Savant's pre-rendered pages can't do.",
    tryThis: "Combine an outcome of Whiffs with a speed floor of 93 mph and a plate-height band.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "outcome"],
    preset: preset({ view: "Catcher" }),
  },
  {
    id: "imanaga-no-hitter",
    title: "Imanaga's Hitless Night",
    sprint: "S13",
    synthetic: false,
    assetUrl: "/real/imanaga-no-hitter.arrow",
    hook: "Seven hitless innings from Shota Imanaga, then a combined no-hitter.",
    lookFor:
      "Follow Imanaga's Sept. 4, 2024 arsenal through seven hitless innings. The real pitch identities, player names, and Savant links stay intact through the combined no-hitter.",
    tryThis: "Filter to swings and misses, then compare the fastball and splitter paths from the catcher view.",
    lens: ["camera", "flight", "types", "speed", "zone", "outcome"],
    preset: preset({
      view: "Catcher",
      layers: { tunneling: true, releasePoints: true },
      pairedTypes: ["FF", "FS"],
    }),
  },
];

// Lead the public demo with a real MLB game; generated scenarios remain
// available as controlled comparisons in the rail.
export const DEFAULT_SCENARIO_ID: ScenarioId = "imanaga-no-hitter";

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/**
 * Static hosting (Cloudflare Pages) has no API: the build sets
 * VITE_STATIC_SCENARIOS=1 and each scenario is a pre-exported Arrow asset
 * (`npm run export:scenarios`), byte-identical to the API response.
 */
export const STATIC_SCENARIOS: boolean = import.meta.env.VITE_STATIC_SCENARIOS === "1";

export const scenarioUrl = (id: ScenarioId, staticMode: boolean = STATIC_SCENARIOS): string =>
  scenarioById(id)?.assetUrl ?? (staticMode ? `/scenarios/${id}.arrow` : `/pitches/scenario/${id}`);
export const scenarioSearch = (id: ScenarioId): string => `?scenario=${id}`;

export function parseScenarioParam(search: string): ScenarioId | null {
  const raw = new URLSearchParams(search).get("scenario");
  return raw && scenarioById(raw) ? (raw as ScenarioId) : null;
}
