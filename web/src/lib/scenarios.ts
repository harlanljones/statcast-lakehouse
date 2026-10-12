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
  | "season-sweep"
  | "strikeout-nights"
  | "extra-innings"
  | "power-nights"
  | "walk-off-wins"
  | "one-run-slugfests"
  | "pitchers-duels"
  | "multi-homer-nights"
  | "grand-slams"
  | "big-innings"
  | "strikeout-starts"
  | "comeback-wins"
  | "multi-error-games"
  | "inning-after-inning"
  | "called-early"
  | "combined-shutouts"
  | "blowouts"
  | "hundred-pitch-starts"
  | "unclassified-pitches"
  | "under-a-roof"
  | "short-left-lines"
  | "short-centre-fields"
  | "deep-centre-fields";

export type LayerKey =
  | "tunneling"
  | "ghostBreak"
  | "releasePoints"
  | "plateCrossings"
  | "spray"
  | "breakChart"
  | "pairComparison"
  | "contactSim"
  | "dispersion"
  | "fatigue"
  | "countMix"
  | "sprayProfile"
  | "heatmap";

export type LensId =
  | "camera"
  | "flight"
  | "types"
  | "speed"
  | "plate"
  | "zone"
  | "count"
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
  "count",
];

/** Layer-toggle labels, in display order (LensPanel's "All controls" row). */
export const LAYER_TOGGLES: readonly { key: LayerKey; label: string }[] = [
  { key: "tunneling", label: "Tunneling plane" },
  { key: "ghostBreak", label: "Ghost break" },
  { key: "releasePoints", label: "Release points" },
  { key: "plateCrossings", label: "Plate crossings" },
  { key: "spray", label: "Spray landings" },
  { key: "breakChart", label: "Break chart" },
  { key: "pairComparison", label: "Pitch pairs" },
  { key: "contactSim", label: "Contact sim" },
  { key: "dispersion", label: "Release dispersion" },
  { key: "fatigue", label: "Fatigue" },
  { key: "countMix", label: "Count mix" },
  { key: "sprayProfile", label: "Spray profile" },
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
  spray: false,
  breakChart: false,
  pairComparison: false,
  contactSim: false,
  dispersion: false,
  fatigue: false,
  countMix: false,
  sprayProfile: false,
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
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome"],
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
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome", "heatmapMode"],
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
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome"],
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
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome"],
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
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome"],
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
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome"],
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
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome", "heatmapMode"],
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
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome", "heatmapMode"],
    preset: preset({
      view: "Catcher",
      layers: { plateCrossings: true, heatmap: true, dispersion: true },
    }),
  },
  {
    id: "strikeout-nights",
    title: "Strikeout Nights",
    dateLabel: "Apr 5, 2024 – Jul 5, 2026",
    gameLabel: "Six games · 132 strikeouts",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/745042/feed/live",
    synthetic: false,
    hook: "Six games where the two staffs combined for twenty or more strikeouts.",
    lookFor:
      "1,739 tracked pitches and 871 swings that produced 264 whiffs, one game per date from April 2024 to July 2026: 20 to 24 strikeouts a game, 132 in all. 278 of those pitches were put in play with measured contact data.",
    tryThis:
      "Set the heatmap to Whiff %, then switch it to Hard Hit % to see where the same staffs were squared up.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome", "heatmapMode"],
    preset: preset({
      view: "Catcher",
      layers: { plateCrossings: true, heatmap: true },
      heatmapMode: "whiff_rate",
    }),
  },
  {
    id: "extra-innings",
    title: "Extra Innings",
    dateLabel: "May 5, 2024 – Apr 20, 2026",
    gameLabel: "Six games · 65 innings",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/745707/feed/live",
    synthetic: false,
    hook: "Six games that ran past nine innings, from a 1–0 duel to two 12-inning games.",
    lookFor:
      "2,143 tracked pitches, 996 swings and 246 whiffs across six extra-inning games from May 2024 to April 2026 — 65 innings in all, and 367 of the pitches were put in play with measured contact data.",
    tryThis:
      "Open the fatigue panel to see how the arms held up, then set the heatmap to Hard Hit % and compare the 1–0 duel in Pittsburgh with the 12-inning games.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome"],
    preset: preset({
      view: "Side",
      layers: { plateCrossings: true, dispersion: true, fatigue: true },
    }),
  },
  {
    id: "power-nights",
    title: "Power Nights",
    dateLabel: "Jun 22, 2024 – Aug 15, 2026",
    gameLabel: "Six games · 32 home runs",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/777873/feed/live",
    synthetic: false,
    hook: "Six games that produced four or more home runs apiece — 32 in all.",
    lookFor:
      "1,792 tracked pitches, 838 swings and 167 whiffs across six games from June 2024 to August 2026, including an eight-homer night in Baltimore. 354 of the pitches were put in play with measured contact data, 83 of them at 100 mph or harder.",
    tryThis:
      "Set the heatmap to Hard Hit % and compare the eight-homer game in Baltimore with the rest.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome", "heatmapMode"],
    preset: preset({
      view: "Batter",
      layers: { plateCrossings: true, heatmap: true },
      heatmapMode: "hard_hit",
    }),
  },
  {
    id: "walk-off-wins",
    title: "Walk-Off Wins",
    dateLabel: "Jul 13, 2024 – Jun 6, 2026",
    gameLabel: "Six games · six walk-offs",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/746447/feed/live",
    synthetic: false,
    hook: "Six games decided by the final swing — every one of them in extra innings.",
    lookFor:
      "2,010 tracked pitches, 931 swings and 209 whiffs across six walk-off games from July 2024 to June 2026, all decided in the tenth inning or later: two home runs, two singles and two fielders' choices ended them, and four were one-run games. 352 pitches were put in play with measured contact data.",
    tryThis:
      "Scrub to the final pitch of a game and compare where the winning contact was made.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome"],
    preset: preset({
      view: "Batter",
      layers: { plateCrossings: true, ghostBreak: true },
    }),
  },
  {
    id: "one-run-slugfests",
    title: "One-Run Slugfests",
    dateLabel: "May 11, 2024 – Jun 13, 2026",
    gameLabel: "Six games · 104 runs",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/778247/feed/live",
    synthetic: false,
    hook: "Six games decided by a single run with both teams scoring six or more.",
    lookFor:
      "1,965 tracked pitches, 910 swings and 221 whiffs across six high-scoring one-run games from May 2024 to June 2026 — 104 runs in all, an average of 17 a game, and 331 of the pitches were put in play with measured contact data.",
    tryThis:
      "Set the heatmap to Hard Hit % and compare where the 23-run game at Coors Field was pitched with the rest.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome", "heatmapMode"],
    preset: preset({
      view: "Pitcher",
      layers: { plateCrossings: true, heatmap: true },
      heatmapMode: "hard_hit",
    }),
  },
  {
    id: "pitchers-duels",
    title: "Pitchers' Duels",
    dateLabel: "Apr 21, 2024 – Aug 19, 2026",
    gameLabel: "Six games · 8 runs",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/776669/feed/live",
    synthetic: false,
    hook: "Six games with three runs or fewer — four of them 1–0 finals.",
    lookFor:
      "1,532 tracked pitches, 760 swings and 167 whiffs across six low-scoring games from April 2024 to August 2026: four 1–0 finals and two 2–0, eight runs in all, none of them needing extra innings. 274 of the pitches were put in play with measured contact data.",
    tryThis:
      "Turn on release dispersion and compare how the two 2–0 games were pitched with the four 1–0s.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome"],
    preset: preset({
      view: "Side",
      layers: { dispersion: true, releasePoints: true, tunneling: true },
    }),
  },
  {
    id: "multi-homer-nights",
    title: "Multi-Homer Nights",
    dateLabel: "Apr 14, 2024 – May 10, 2026",
    gameLabel: "Six games · 34 home runs",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/745551/feed/live",
    synthetic: false,
    hook: "Six games where a hitter went deep at least twice — two of them nine-homer games.",
    lookFor:
      "1,731 tracked pitches, 860 swings and 191 whiffs across six games from April 2024 to May 2026 in which at least one hitter homered twice, including two nine-home-run games and two three-homer performances. 331 of the pitches were put in play with measured contact data, 79 of them at 100 mph or harder.",
    tryThis:
      "Set the heatmap to Hard Hit % and compare where the Athletics' 18-run game was pitched with the Rockies' 6–0 shutout.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome", "heatmapMode"],
    preset: preset({
      view: "Catcher",
      layers: { plateCrossings: true, heatmap: true },
      heatmapMode: "hard_hit",
    }),
  },
  {
    id: "grand-slams",
    title: "Grand Slams",
    dateLabel: "May 12, 2024 – Aug 23, 2026",
    gameLabel: "Six games · seven grand slams",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/823099/feed/live",
    synthetic: false,
    hook: "Six games with a grand slam — including a 19–2 rout that had two.",
    lookFor:
      "1,906 tracked pitches, 893 swings and 163 whiffs across six games from May 2024 to August 2026 that produced seven grand slams, two of them in the Cubs' 19–2 win in Seattle. 353 of the pitches were put in play with measured contact data, 83 of them at 100 mph or harder.",
    tryThis:
      "Scrub to the grand-slam pitch in each game and compare where it was left over the plate.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome", "heatmapMode"],
    preset: preset({
      view: "Catcher",
      layers: { plateCrossings: true, heatmap: true },
      heatmapMode: "hard_hit",
    }),
  },
  {
    id: "big-innings",
    title: "Big Innings",
    dateLabel: "Apr 28, 2024 – Aug 16, 2026",
    gameLabel: "Six games · 43 runs in six innings",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/776428/feed/live",
    synthetic: false,
    hook: "Six games turned by one big inning — two of them eight-run frames.",
    lookFor:
      "2,012 tracked pitches, 993 swings and 212 whiffs across six games from April 2024 to August 2026 in which one inning produced six runs or more: 43 runs in those six innings alone, from the Mariners' eight-run third in an 18–2 win to the Rockies' seven-run eighth that won a one-run game. 356 of the pitches were put in play with measured contact data.",
    tryThis:
      "Scrub through the big inning in each game and watch the pitch locations change as the runs pile up.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome", "heatmapMode"],
    preset: preset({
      view: "Pitcher",
      layers: { plateCrossings: true, heatmap: true },
    }),
  },
  {
    id: "strikeout-starts",
    title: "Double-Digit Starts",
    dateLabel: "Jul 7, 2024 – Sep 6, 2026",
    gameLabel: "Six starts · 75 strikeouts",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/776317/feed/live",
    synthetic: false,
    hook: "Six starts where the pitcher struck out at least ten — twelve to fourteen each.",
    lookFor:
      "1,681 tracked pitches, 830 swings and 246 whiffs across six games from July 2024 to September 2026 in which the starting pitcher struck out ten or more: George Kirby's 14 for Seattle, Tarik Skubal's 13 for Detroit, and 12 each from Spencer Arrighetti, Garrett Crochet, Zack Wheeler and Payton Tolle. Three of the six were one-run games.",
    tryThis:
      "Set the heatmap to Whiff % and compare where these six starters put hitters away.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome", "heatmapMode"],
    preset: preset({
      view: "Catcher",
      layers: { plateCrossings: true, heatmap: true },
      heatmapMode: "whiff_rate",
    }),
  },
  {
    id: "comeback-wins",
    title: "Comeback Wins",
    dateLabel: "Apr 1, 2024 – Apr 4, 2026",
    gameLabel: "Six games · 3–4 run deficits",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/746085/feed/live",
    synthetic: false,
    hook: "Six games the winner trailed by three or four runs — and still won inside nine innings.",
    lookFor:
      "1,903 tracked pitches, 842 swings and 213 whiffs across six regulation games from April 2024 to April 2026 in which the winning team trailed by three or four runs: the Angels spotted the Marlins four runs on opening day, the Orioles and Dodgers each erased three, and the Dodgers turned a three-run deficit into a 13-6 win in Washington. 318 pitches were put in play with measured contact data.",
    tryThis:
      "Scrub to the inning the lead changed and compare where the pitches had to go.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome"],
    preset: preset({
      view: "Batter",
      layers: { plateCrossings: true, ghostBreak: true },
    }),
  },
  {
    id: "multi-error-games",
    title: "Multi-Error Games",
    dateLabel: "Apr 2, 2024 – Apr 13, 2026",
    gameLabel: "Six games · 24 errors",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/745598/feed/live",
    synthetic: false,
    hook: "Six regulation games in which a team made three or more errors — 24 in all.",
    lookFor:
      "1,866 tracked pitches, 877 swings and 192 whiffs across six regulation games from April 2024 to April 2026 in which a team made three or more errors: four by the Rockies in a 17-2 loss at Coors Field, three each behind the White Sox, Red Sox, Diamondbacks and Phillies, and five across the Reds and Phillies in the same game. 352 pitches were put in play with measured contact data.",
    tryThis:
      "Scrub through an inning with an error and watch where the next pitches went.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome", "heatmapMode"],
    preset: preset({
      view: "Catcher",
      layers: { plateCrossings: true, heatmap: true },
    }),
  },
  {
    id: "inning-after-inning",
    title: "Inning After Inning",
    dateLabel: "Apr 12, 2024 – Jul 6, 2026",
    gameLabel: "Six games · 93 runs",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/824354/feed/live",
    synthetic: false,
    hook: "Six games in which one team scored in seven or more different innings.",
    lookFor:
      "2,090 tracked pitches, 1,008 swings and 214 whiffs across six regulation games from April 2024 to July 2026 in which one team scored in seven or more different innings — three of them in eight — for 93 runs in all: the Giants put up 19 at Coors Field, the Orioles 17 at Yankee Stadium, and the Royals 15 while holding the Phillies to a single run. 395 pitches were put in play with measured contact data.",
    tryThis:
      "Step through the innings and watch how the pitch mix changes once a lead is built.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome", "heatmapMode"],
    preset: preset({
      view: "Batter",
      layers: { plateCrossings: true, heatmap: true },
      heatmapMode: "hard_hit",
    }),
  },
  {
    id: "called-early",
    title: "Called Early",
    dateLabel: "Apr 25, 2024 – Aug 2, 2026",
    gameLabel: "Six games · 37 innings",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/746320/feed/live",
    synthetic: false,
    hook: "Six games that stopped before nine innings — five for rain, one for wet grounds.",
    lookFor:
      "1,341 tracked pitches, 627 swings and 152 whiffs across six shortened games from April 2024 to August 2026, 37 innings in all: the Blue Jays and Royals played five on wet grounds in 93 minutes and 143 pitches, and four more games were called for rain in the sixth or seventh. 206 pitches were put in play with measured contact data.",
    tryThis:
      "Scrub to the last inning of each game — the final pitch is where the day ended.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome", "heatmapMode"],
    preset: preset({
      view: "Pitcher",
      layers: { releasePoints: true, plateCrossings: true },
    }),
  },
  {
    id: "combined-shutouts",
    title: "Combined Shutouts",
    dateLabel: "Apr 6, 2024 – Apr 7, 2026",
    gameLabel: "Twelve games · five 1-0",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/745029/feed/live",
    synthetic: false,
    hook: "Twelve games in which a team was shut out — none of them by a complete game.",
    lookFor:
      "3,152 tracked pitches, 1,487 swings and 355 whiffs across twelve shutouts from April 2024 to April 2026, four per season: five of them ended 1-0, and no starter went the distance — every shutout was combined, using between two and five pitchers. 532 pitches were put in play with measured contact data.",
    tryThis:
      "Compare where the strike zone was attacked in a 1-0 game with the 6-0 one.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome", "heatmapMode"],
    preset: preset({
      view: "Catcher",
      layers: { plateCrossings: true, heatmap: true },
      heatmapMode: "whiff_rate",
    }),
  },
  {
    id: "blowouts",
    title: "Blowouts",
    dateLabel: "Apr 4, 2024 – Apr 17, 2026",
    gameLabel: "Twelve games · 179 runs",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/825105/feed/live",
    synthetic: false,
    hook: "Twelve games decided by nine runs or more — where the late innings stopped looking like baseball.",
    lookFor:
      "3,680 tracked pitches, 1,732 swings and 338 whiffs across twelve blowouts from April 2024 to April 2026, four per season: 179 runs in all and margins from nine to sixteen, including 18-7 in Boston, 17-1 in San Francisco and 17-2 in Arizona. Four of the twelve had an arm that never topped 75 mph as the game ran away — the slowest 43.8 mph with Atlanta already 17 ahead. 723 pitches were put in play with measured contact data.",
    tryThis:
      "Step into the late innings and watch the pitch speeds fall away — then switch on Spray landings to see where the contact went.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome", "heatmapMode"],
    preset: preset({
      view: "Batter",
      layers: { plateCrossings: true, heatmap: true, spray: true, sprayProfile: true },
      heatmapMode: "hard_hit",
    }),
  },
  {
    id: "hundred-pitch-starts",
    title: "100-Pitch Starts",
    dateLabel: "Apr 16, 2024 – Apr 24, 2026",
    gameLabel: "Twelve games · 105–112 pitches",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/745593/feed/live",
    synthetic: false,
    hook: "Twelve starts that ran past 100 pitches — one of them a complete-game shutout.",
    lookFor:
      "3,450 tracked pitches, 1,630 swings and 388 whiffs across twelve games from April 2024 to April 2026 in which a starter threw 105 to 112 pitches: Ranger Suarez's 112 finished a shutout, Parker Messick's 112 came in eight innings, Zack Wheeler and Michael King each appear twice, and in two of the games both starters topped 100. 568 pitches were put in play with measured contact data.",
    tryThis:
      "Follow one of these outings inning by inning with the fatigue layer on — the velocity and whiff rate tell the workload story.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome"],
    preset: preset({
      view: "Pitcher",
      layers: { plateCrossings: true, fatigue: true, countMix: true },
    }),
  },
  {
    id: "unclassified-pitches",
    title: "Unclassified Pitches",
    dateLabel: "Mar 28, 2025 – Jul 4, 2026",
    gameLabel: "Ten games · one pitch each",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/778560/feed/live",
    synthetic: false,
    hook: "Ten games holding a pitch Statcast could not classify — every one of them a ball.",
    lookFor:
      "3,076 tracked pitches, 1,523 swings and 341 whiffs across ten games from March 2025 to July 2026, each containing exactly one pitch the classifier could not label. They came in at 51.9 to 82.4 mph from ten different pitchers and every one was called a ball. These ten close the set: the catalogue now covers all seventeen pitch types the MLB feed emits in these seasons. 547 pitches were put in play with measured contact data.",
    tryThis:
      "Drag the speed filter to its low end — in most of these games the unclassified pitch is the slowest thing thrown.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome"],
    preset: preset({
      view: "Pitcher",
      layers: { releasePoints: true, plateCrossings: true },
    }),
  },
  {
    id: "under-a-roof",
    title: "Under a Roof",
    dateLabel: "Apr 18, 2024 – Apr 18, 2026",
    gameLabel: "Twelve games · 8 parks",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/745104/feed/live",
    synthetic: false,
    hook: "Twelve games played under a roof — covering every domed or retractable-roof park in the league.",
    lookFor:
      "3,494 tracked pitches, 1,659 swings and 386 whiffs across twelve games from April 2024 to April 2026 at all eight roofed parks in MLB's venue data: Tropicana Field's fixed dome plus seven retractable roofs, with 31 home runs in all. The mirror of the called-early slice — nothing here was rained on. 635 pitches were put in play with measured contact data.",
    tryThis:
      "Set the heatmap to Hard Hit % and compare the contact in a fixed dome with a retractable-roof park.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome", "heatmapMode"],
    preset: preset({
      view: "Batter",
      layers: { plateCrossings: true, heatmap: true, spray: true },
      heatmapMode: "hard_hit",
    }),
  },
  {
    id: "short-left-lines",
    title: "Short Left Lines",
    dateLabel: "May 3 - Jun 2, 2024",
    gameLabel: "Twelve games · 5 parks",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/746961/feed/live",
    synthetic: false,
    hook: "Twelve games at five of the shortest left-field lines in MLB's venue data - 310 ft at Fenway Park to 325 at Progressive Field.",
    lookFor:
      "3,576 tracked pitches, 1,695 swings and 398 whiffs across twelve games in May and June 2024 at five of the shortest left-field lines in MLB's venue data, every dimension taken from the venue feed's own fieldInfo: Fenway Park 310 ft, Tropicana Field 315, Minute Maid Park 315 (now Daikin Park), Yankee Stadium 318 and Progressive Field 325. 29 home runs were hit across the twelve and 601 pitches were put in play with measured contact data.",
    tryThis:
      "Turn on the spray layer and compare where the home runs landed at Fenway Park's 310 ft line with Progressive Field's 325.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome"],
    preset: preset({
      view: "Batter",
      layers: { plateCrossings: true, spray: true },
    }),
  },
  {
    id: "short-centre-fields",
    title: "Short Centre Fields",
    dateLabel: "Apr 29 - Jun 13, 2024",
    gameLabel: "Twelve games · 7 parks",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/745333/feed/live",
    synthetic: false,
    hook: "Twelve games at the seven shortest centre fields in MLB's venue data - 391 ft at Oracle Park to 400 at Wrigley Field and Rate Field.",
    lookFor:
      "3,692 tracked pitches, 1,752 swings and 420 whiffs across twelve games from April to June 2024 at "
      + "the seven shortest centre fields in MLB's venue data: 391 ft at Oracle Park, 395 at Dodger Stadium, "
      + "396 at Angel Stadium and Petco Park, 399 at PNC Park, and 400 at Rate Field and Wrigley Field. 24 "
      + "home runs were hit across the twelve and 600 pitches were put in play with measured contact data.",
    tryThis:
      "Turn on the spray layer and compare where the batted balls landed: these seven parks hold the league's shallowest centre fields, from Oracle Park's 391 ft to Wrigley Field's 400.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome"],
    preset: preset({
      view: "Batter",
      layers: { plateCrossings: true, spray: true },
    }),
  },
  {
    id: "deep-centre-fields",
    title: "Deep Centre Fields",
    dateLabel: "May 26 - Jun 19, 2024",
    gameLabel: "Twelve games · 6 parks",
    storyUrl: "https://www.mlb.com/schedule",
    feedUrl: "https://statsapi.mlb.com/api/v1.1/game/746949/feed/live",
    synthetic: false,
    hook: "Twelve games at the six deepest centre fields in MLB's venue data - 420 ft at Fenway Park and Comerica Park down to 408 at Citi Field.",
    lookFor:
      "3,598 tracked pitches, 1,715 swings and 382 whiffs across twelve games in May and June 2024 at the "
      + "six deepest centre fields in MLB's venue data: 420 ft at Fenway Park and Comerica Park, 415 at "
      + "Coors Field, 410 at Kauffman Stadium, 409 at Minute Maid Park (now Daikin Park) and 408 at Citi "
      + "Field. 37 home runs were hit across the twelve and 633 pitches were put in play with measured "
      + "contact data.",
    tryThis:
      "Turn on the spray layer and compare where the batted balls landed: these six parks hold the "
      + "league's deepest centre fields, from Fenway Park and Comerica Park at 420 ft to Citi Field at 408.",
    lens: ["camera", "flight", "types", "speed", "plate", "zone", "count", "outcome"],
    preset: preset({
      view: "Batter",
      layers: { plateCrossings: true, spray: true },
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
