import { describe, expect, it } from "vitest";
import { CAMERA_VIEWS } from "./deck-layers";
import {
  DEFAULT_SCENARIO_ID,
  LIVE_PRESET,
  SCENARIOS,
  STATIC_SCENARIOS,
  parseScenarioParam,
  scenarioById,
  scenarioSearch,
  scenarioUrl,
} from "./scenarios";

const SERVER_IDS = [
  "twenty-run-night",
  "ohtani-50-50",
  "ohtani-50th-home-run",
  "freeman-walk-off",
  "snell-no-hitter",
];

describe("real-game story catalog", () => {
  it("matches the server registry ids, in order", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(SERVER_IDS);
  });

  it("gives every story copy, game date, source links, camera, and a lens control", () => {
    for (const s of SCENARIOS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.hook.length).toBeGreaterThan(0);
      expect(s.lookFor.length).toBeGreaterThan(0);
      expect(s.tryThis.length).toBeGreaterThan(0);
      expect(s.dateLabel).toMatch(/\w{3} \d{1,2}, 2024/);
      expect(s.storyUrl).toMatch(/^https:\/\/www\.mlb\.com\//);
      expect(s.feedUrl).toMatch(/^https:\/\/statsapi\.mlb\.com\/api\/v1\.1\/game\//);
      expect(s.synthetic).toBe(false);
      expect(Object.keys(CAMERA_VIEWS)).toContain(s.preset.view);
      expect(s.lens.length).toBeGreaterThan(0);
      expect(s.preset.layers.contactSim).toBe(false);
    }
  });

  it("defaults to a real game story", () => {
    expect(DEFAULT_SCENARIO_ID).toBe("twenty-run-night");
    expect(scenarioById(DEFAULT_SCENARIO_ID)?.synthetic).toBe(false);
    expect(scenarioById("nope")).toBeUndefined();
  });

  it("turns on the layers that fit each real data slice", () => {
    const L = (id: string) => scenarioById(id)!.preset.layers;
    expect(L("twenty-run-night")).toMatchObject({ plateCrossings: true, ghostBreak: true, breakChart: true });
    expect(L("ohtani-50-50")).toMatchObject({ plateCrossings: true, heatmap: true });
    expect(L("ohtani-50th-home-run")).toMatchObject({ plateCrossings: true, ghostBreak: true });
    expect(L("freeman-walk-off")).toMatchObject({ plateCrossings: true, ghostBreak: true });
    expect(L("snell-no-hitter")).toMatchObject({ dispersion: true, fatigue: true, releasePoints: true });
  });

  it("sets the Ohtani at-bat slice to whiff-rate heatmap mode", () => {
    expect(scenarioById("ohtani-50-50")!.preset.heatmapMode).toBe("whiff_rate");
  });
});

describe("scenario urls", () => {
  it("builds the serving url and the deep-link query", () => {
    expect(scenarioUrl("snell-no-hitter")).toBe("/pitches/scenario/snell-no-hitter");
    expect(scenarioUrl("snell-no-hitter", false)).toBe("/pitches/scenario/snell-no-hitter");
    expect(scenarioSearch("snell-no-hitter")).toBe("?scenario=snell-no-hitter");
  });

  it("points at the pre-exported .arrow asset in static mode", () => {
    expect(scenarioUrl("snell-no-hitter", true)).toBe("/scenarios/snell-no-hitter.arrow");
  });

  it("is not in static mode unless the build asks for it", () => {
    expect(STATIC_SCENARIOS).toBe(false);
  });

  it("parses known deep links and rejects unknown or missing ones", () => {
    expect(parseScenarioParam("?scenario=snell-no-hitter")).toBe("snell-no-hitter");
    expect(parseScenarioParam("?a=1&scenario=freeman-walk-off")).toBe("freeman-walk-off");
    expect(parseScenarioParam("?scenario=nope")).toBeNull();
    expect(parseScenarioParam("")).toBeNull();
  });

  it("LIVE_PRESET is neutral", () => {
    expect(Object.values(LIVE_PRESET.layers).some(Boolean)).toBe(false);
    expect(LIVE_PRESET.pairedTypes).toBeNull();
    expect(LIVE_PRESET.zoneFilter).toBe("all");
    expect(LIVE_PRESET.outcomeFilter).toBe("all");
  });
});
