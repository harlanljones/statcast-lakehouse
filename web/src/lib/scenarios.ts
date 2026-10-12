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
  | "snell-no-hitter"
  | "cardinals-dodgers-opener"
  | "tigers-astros-june"
  | "yankees-athletics-2025"
  | "twins-blue-jays-2026"
  | "season-sweep";

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

/** Every lens, in display order: what the header's "All controls" (and Live data) shows. */
export const ALL_LENSES: readonly LensId[] = [
  "camera",
  "flight",
  "types",
  "speed",
  "plate",
  "zone",
  "outcome",
  "heatmapMode",
  "contact",
];

/** Layer-toggle labels, in display order (LensPanel's "All controls" row). */
export const LAYER_TOGGLES: readonly { key: LayerKey; label: string }[] = [
  { key: "tunneling", label: "Tunneling plane" },
  { key: "ghostBreak", label: "Ghost break" },
  { key: "releasePoints", label: "Release points" },
  { key: "plateCrossings", label: "Plate crossings" },
  { key: "breakChart", label: "Break chart" },
  { key: "pairComparison", label: "Pitch pairs" },
  { key: "contactSim", label: "Contact sim" },
  { key: "dispersion", label: "Release dispersion" },
  { key: "fatigue", label: "Fatigue" },
  { key: "heatmap", label: "Zone heatmap" },
];

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
  // Eephus pitches in the checked-in data are ~49 mph; a floor of 70 silently hid them.
  speedRange: [40, 105],
  plateXRange: [-3, 3],
  plateZRange: [-1, 6],
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
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "outcome", "heatmapMode"],
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
    lens: ["camera", "flight", "types", "speed", "plate"],
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
  {
    id: "cardinals-dodgers-opener",
    title: "Opening Day at Dodger Stadium",
    dateLabel: "Mar 28, 2024",
    gameLabel: "Cardinals at Dodgers · 1–7",
    storyUrl: "https://www.mlb.com/gameday/cardinals-vs-dodgers/2024/03/28/746165/final",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/746165/feed/live",
    synthetic: false,
    hook: "All 259 tracked pitches of the 2024 home opener in Los Angeles.",
    lookFor:
      "Tyler Glasnow's 81 pitches for the Dodgers against Miles Mikolas's 74 for St. Louis: 137 swings, 32 whiffs, and a mix that runs from four-seamers to 41 sinkers, 27 sweepers and a slurve. Speeds span 69.0 to 98.5 mph.",
    tryThis:
      "Isolate the sinkers and sweepers, then open the break chart to compare their movement with the four-seamers.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "outcome"],
    preset: preset({
      view: "Catcher",
      layers: { plateCrossings: true, ghostBreak: true, breakChart: true },
    }),
  },
  {
    id: "tigers-astros-june",
    title: "Thirteen Runs in Houston",
    dateLabel: "Jun 15, 2024",
    gameLabel: "Tigers at Astros · 13–5",
    storyUrl: "https://www.mlb.com/gameday/tigers-vs-astros/2024/06/15/746381/final",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/746381/feed/live",
    synthetic: false,
    hook: "A 13–5 Detroit win with the widest arsenal in the catalog.",
    lookFor:
      "357 tracked pitches from Minute Maid Park — Jack Flaherty's 73 plus nine more arms — 163 swings and 36 whiffs across ten pitch types, including two slurves.",
    tryThis:
      "Open pitch pairs, choose the four-seamer and the slider, and compare where the two separate between the commitment plane and the plate.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "outcome"],
    preset: preset({
      view: "Catcher",
      layers: { tunneling: true, pairComparison: true, plateCrossings: true },
      pairedTypes: ["FF", "SL"],
    }),
  },
  {
    id: "yankees-athletics-2025",
    title: "Forty-Six Whiffs in Sacramento",
    dateLabel: "May 10, 2025",
    gameLabel: "Yankees at Athletics · 7–11",
    storyUrl: "https://www.mlb.com/gameday/yankees-vs-athletics/2025/05/10/777972/final",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/777972/feed/live",
    synthetic: false,
    hook: "The 2025 slice: 323 pitches and the catalog's highest whiff count.",
    lookFor:
      "Carlos Rodón's 98 pitches against JP Sears's 82, with Mason Miller out of the bullpen; 148 swings produced 46 whiffs. Speeds span 75.5 to 102.1 mph.",
    tryThis:
      "Turn on release points and compare Rodón's and Sears's release spread pitch type by pitch type.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "outcome"],
    preset: preset({
      view: "Side",
      layers: { releasePoints: true, dispersion: true, heatmap: true },
    }),
  },
  {
    id: "twins-blue-jays-2026",
    title: "Toronto's Ten-Run Night",
    dateLabel: "Apr 10, 2026",
    gameLabel: "Twins at Blue Jays · 4–10",
    storyUrl: "https://www.mlb.com/gameday/twins-vs-blue-jays/2026/04/10/822829/final",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/822829/feed/live",
    synthetic: false,
    hook: "The 2026 slice: 311 pitches from Rogers Centre.",
    lookFor:
      "Sliders (92) outnumber four-seamers (48) in this game, with Patrick Corbin's 85 pitches leading the staff; 147 swings produced 23 whiffs.",
    tryThis:
      "Set the whiff-rate heatmap, then compare where sliders missed bats with where sinkers were put in play.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "outcome", "heatmapMode"],
    preset: preset({
      view: "Batter",
      layers: { plateCrossings: true, heatmap: true, fatigue: true },
      heatmapMode: "whiff_rate",
    }),
  },
  {
    id: "season-sweep",
    title: "Six Games Across Three Seasons",
    dateLabel: "Apr 15, 2024 – Sep 20, 2026",
    gameLabel: "Twelve games · 4,063 pitches",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/778250/feed/live",
    synthetic: false,
    hook: "One game per period from the 2024, 2025 and 2026 seasons in a single slice.",
    lookFor:
      "Every tracked pitch from twelve games: 4,063 pitches, 108 pitchers, 194 batters, 13 pitch types and 1,950 swings (415 whiffs), across ten ballparks from Camden Yards to Citi Field. One of the twelve is Cincinnati's 24–2 win in Baltimore on 2025-04-20.",
    tryThis:
      "Run the density heatmap over the whole sweep, then pick a single date partition in the Live data card to compare one game against the corpus.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "outcome", "heatmapMode"],
    preset: preset({
      view: "Catcher",
      layers: { plateCrossings: true, heatmap: true, dispersion: true },
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
