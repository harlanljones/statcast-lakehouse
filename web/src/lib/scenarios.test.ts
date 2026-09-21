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
  "tunnel-vision", "fatigue-arc", "ghost-break", "chase-map", "contact-lab", "corpus-slice",
];

describe("scenario catalog", () => {
  it("matches the server registry ids, in order", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(SERVER_IDS);
  });

  it("gives every scenario copy, a real camera, and at least one lens control", () => {
    for (const s of SCENARIOS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.hook.length).toBeGreaterThan(0);
      expect(s.lookFor.length).toBeGreaterThan(0);
      expect(s.tryThis.length).toBeGreaterThan(0);
      expect(s.sprint).toMatch(/^S\d|market/);
      expect(Object.keys(CAMERA_VIEWS)).toContain(s.preset.view);
      expect(s.lens.length).toBeGreaterThan(0);
    }
  });

  it("defaults to a scenario that exists", () => {
    expect(scenarioById(DEFAULT_SCENARIO_ID)).toBeDefined();
    expect(scenarioById("nope")).toBeUndefined();
  });

  it("turns on the layers each story is about", () => {
    const L = (id: string) => scenarioById(id)!.preset.layers;
    expect(L("tunnel-vision")).toMatchObject({ tunneling: true, pairComparison: true });
    expect(L("fatigue-arc")).toMatchObject({ dispersion: true, fatigue: true });
    expect(L("ghost-break")).toMatchObject({ ghostBreak: true, breakChart: true });
    expect(L("chase-map")).toMatchObject({ heatmap: true });
    expect(L("contact-lab")).toMatchObject({ contactSim: true });
    expect(Object.values(L("corpus-slice")).every((v) => v === false)).toBe(true);
  });

  it("carries scenario-specific settings", () => {
    const P = (id: string) => scenarioById(id)!.preset;
    expect(P("tunnel-vision").pairedTypes).toEqual(["FF", "SL"]);
    expect(P("chase-map").heatmapMode).toBe("whiff_rate");
    expect(P("contact-lab").batSpeed).toBe(72);
    expect(P("contact-lab").attackAngleDeg).toBe(18);
    for (const s of SCENARIOS.filter((x) => x.id !== "tunnel-vision")) {
      expect(s.preset.pairedTypes).toBeNull();
    }
  });
});

describe("scenario urls", () => {
  it("builds the serving url and the deep-link query", () => {
    expect(scenarioUrl("fatigue-arc")).toBe("/pitches/scenario/fatigue-arc");
    expect(scenarioUrl("fatigue-arc", false)).toBe("/pitches/scenario/fatigue-arc");
    expect(scenarioSearch("fatigue-arc")).toBe("?scenario=fatigue-arc");
  });

  it("points at the pre-exported .arrow asset in static (Cloudflare Pages) mode", () => {
    expect(scenarioUrl("fatigue-arc", true)).toBe("/scenarios/fatigue-arc.arrow");
  });

  it("is not in static mode unless the build asks for it", () => {
    expect(STATIC_SCENARIOS).toBe(false);
  });

  it("parses a known deep link and rejects unknown or missing ones", () => {
    expect(parseScenarioParam("?scenario=chase-map")).toBe("chase-map");
    expect(parseScenarioParam("?a=1&scenario=contact-lab")).toBe("contact-lab");
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
