/**
 * Story catalog. Every listed scenario uses a curated real-game Arrow slice
 * (data/scenarios/, GET /pitches/scenario/{id}); its story and viewer controls
 * are declared here while pitch data stays on the Arrow serving path.
 */
import type { CameraViewName, OutcomeFilter, ZoneFilter } from "./deck-layers";
import type { HeatmapMode } from "./heatmap";

export type ScenarioId =
  | "twenty-run-night"
  | "ohtani-50-50"
  | "ohtani-50th-home-run"
  | "freeman-walk-off"
  | "snell-no-hitter";

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
  dateLabel: string;
  gameLabel: string;
  storyUrl: string;
  feedUrl: string;
  /** All curated scenarios contain real MLB game-feed pitches. */
  synthetic: boolean;
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
    id: "twenty-run-night",
    title: "Ohtani's 50/50 Night",
    dateLabel: "Sep 19, 2024",
    gameLabel: "Dodgers at Marlins · 20–4",
    storyUrl: "https://www.mlb.com/stories/shohei-ohtani-historic-50-50-day",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/746011/feed/live",
    synthetic: false,
    hook: "A record-setting 50/50 game inside a 20-run Dodgers win.",
    lookFor:
      "All 370 tracked pitches from Los Angeles's 20–4 win over Miami. Ohtani went 6-for-6 with three home runs, two doubles and 10 RBIs; this view keeps the full game's pitch data together.",
    tryThis: "Isolate a pitch type, then turn on plate crossings to compare where each pitch finished.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "outcome"],
    preset: preset({
      view: "Catcher",
      layers: { plateCrossings: true, ghostBreak: true, breakChart: true },
    }),
  },
  {
    id: "ohtani-50-50",
    title: "Six Trips to the Plate",
    dateLabel: "Sep 19, 2024",
    gameLabel: "Shohei Ohtani · 22 pitches",
    storyUrl: "https://www.mlb.com/stories/shohei-ohtani-historic-50-50-day",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/746011/feed/live",
    synthetic: false,
    hook: "The 22 pitches Ohtani saw during his 6-for-6 game.",
    lookFor:
      "This slice contains every pitch from Ohtani's six plate appearances: three homers, two doubles and a single. The plate locations and pitch outcomes come from the game feed; the 50/50 milestone is linked to MLB's game story.",
    tryThis: "Set the outcome filter to Whiffs, then compare those locations with the pitches he put in play.",
    lens: ["camera", "flight", "types", "plate", "zone", "outcome", "heatmapMode"],
    preset: preset({
      view: "Batter",
      layers: { plateCrossings: true, heatmap: true },
      heatmapMode: "whiff_rate",
    }),
  },
  {
    id: "ohtani-50th-home-run",
    title: "The 50th Home Run",
    dateLabel: "Sep 19, 2024",
    gameLabel: "Top 7th · Ohtani vs. Mike Baumann",
    storyUrl: "https://www.mlb.com/stories/shohei-ohtani-historic-50-50-day",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/746011/feed/live",
    synthetic: false,
    hook: "Four pitches in the at-bat that made Ohtani the first 50/50 player.",
    lookFor:
      "The four recorded pitches from the top of the seventh, ending with Ohtani's 50th home run of the season. Trajectory and plate crossing values are from the MLB game feed for this at-bat.",
    tryThis: "Scrub the flight path and compare the final pitch's crossing with the earlier pitches in the at-bat.",
    lens: ["camera", "flight", "types", "plate"],
    preset: preset({ view: "Batter", layers: { plateCrossings: true, ghostBreak: true } }),
  },
  {
    id: "freeman-walk-off",
    title: "Freeman's Walk-Off",
    dateLabel: "Oct 25, 2024",
    gameLabel: "World Series Game 1 · bottom 10th",
    storyUrl: "https://www.mlb.com/news/freddie-freeman-walk-off-grand-slam-world-series-game-1-2024",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/775300/feed/live",
    synthetic: false,
    hook: "The pitches from Freddie Freeman's Game 1 plate appearances.",
    lookFor:
      "Thirteen pitches from Freeman's five trips to the plate, including the bottom-of-the-10th at-bat against Nestor Cortes. The Dodgers won 6–3 on Freeman's walk-off grand slam.",
    tryThis: "Use the plate crossings and flight scrubber to inspect the recorded paths from the at-bats.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "outcome"],
    preset: preset({
      view: "Pitcher",
      layers: { plateCrossings: true, ghostBreak: true },
    }),
  },
  {
    id: "snell-no-hitter",
    title: "Snell's No-Hitter",
    dateLabel: "Aug 2, 2024",
    gameLabel: "Giants at Reds · 3–0",
    storyUrl: "https://www.mlb.com/news/blake-snell-throws-no-hitter-for-giants-vs-reds",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/746679/feed/live",
    synthetic: false,
    hook: "Blake Snell's 114-pitch, 11-strikeout no-hitter.",
    lookFor:
      "Every pitch Snell threw in the complete-game no-hitter against Cincinnati. The box score records 11 strikeouts and three walks; release points, pitch speeds and plate locations are the measured game-feed values.",
    tryThis: "Compare release points by pitch type, then scrub a pitch to follow its measured trajectory.",
    lens: ["camera", "flight", "types", "speed", "plate"],
    preset: preset({
      view: "Side",
      layers: { dispersion: true, fatigue: true, releasePoints: true },
    }),
  },
];

export const DEFAULT_SCENARIO_ID: ScenarioId = "twenty-run-night";

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
  staticMode ? `/scenarios/${id}.arrow` : `/pitches/scenario/${id}`;
export const scenarioSearch = (id: ScenarioId): string => `?scenario=${id}`;

export function parseScenarioParam(search: string): ScenarioId | null {
  const raw = new URLSearchParams(search).get("scenario");
  return raw && scenarioById(raw) ? (raw as ScenarioId) : null;
}
