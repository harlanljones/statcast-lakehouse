import { describe, expect, it } from "vitest";
import { applyPresetTo, type PresetSetters } from "./scenario-state";
import { LIVE_PRESET, SCENARIOS, scenarioById, type LayerKey, type ScenarioPreset } from "./scenarios";

const LAYER_KEYS: LayerKey[] = [
  "tunneling", "ghostBreak", "releasePoints", "plateCrossings", "breakChart",
  "pairComparison", "contactSim", "dispersion", "fatigue", "heatmap",
];

/** In-memory stand-in for App's signals: records the last value written to each. */
function fakeApp() {
  const state = {
    view: "" as ScenarioPreset["view"] | "",
    speedRange: null as ScenarioPreset["speedRange"] | null,
    plateXRange: null as ScenarioPreset["plateXRange"] | null,
    plateZRange: null as ScenarioPreset["plateZRange"] | null,
    zoneFilter: "" as ScenarioPreset["zoneFilter"] | "",
    outcomeFilter: "" as ScenarioPreset["outcomeFilter"] | "",
    selectedTypes: null as ReadonlySet<string> | null,
    heatmapMode: "" as ScenarioPreset["heatmapMode"] | "",
    batSpeed: NaN,
    attackAngleDeg: NaN,
    pairedTypes: undefined as ScenarioPreset["pairedTypes"] | undefined,
    layers: {} as Partial<Record<LayerKey, boolean>>,
    layerWrites: 0,
  };
  const setters: PresetSetters = {
    setView: (v) => { state.view = v; },
    setSpeedRange: (v) => { state.speedRange = v; },
    setPlateXRange: (v) => { state.plateXRange = v; },
    setPlateZRange: (v) => { state.plateZRange = v; },
    setZoneFilter: (v) => { state.zoneFilter = v; },
    setOutcomeFilter: (v) => { state.outcomeFilter = v; },
    setSelectedTypes: (v) => { state.selectedTypes = v; },
    setLayer: (k, on) => { state.layers[k] = on; state.layerWrites++; },
    setHeatmapMode: (v) => { state.heatmapMode = v; },
    setBatSpeed: (v) => { state.batSpeed = v; },
    setAttackAngleDeg: (v) => { state.attackAngleDeg = v; },
    setPairedTypes: (v) => { state.pairedTypes = v; },
  };
  return { state, setters };
}

describe("applyPresetTo", () => {
  it.each(SCENARIOS.map((s) => [s.id, s.preset] as const))(
    "writes every preset field for %s",
    (_id, preset) => {
      const { state, setters } = fakeApp();
      applyPresetTo(preset, setters);
      expect(state.view).toBe(preset.view);
      expect(state.speedRange).toEqual(preset.speedRange);
      expect(state.plateXRange).toEqual(preset.plateXRange);
      expect(state.plateZRange).toEqual(preset.plateZRange);
      expect(state.zoneFilter).toBe(preset.zoneFilter);
      expect(state.outcomeFilter).toBe(preset.outcomeFilter);
      expect([...(state.selectedTypes ?? [])]).toEqual(preset.selectedTypes);
      expect(state.heatmapMode).toBe(preset.heatmapMode);
      expect(state.batSpeed).toBe(preset.batSpeed);
      expect(state.attackAngleDeg).toBe(preset.attackAngleDeg);
      expect(state.pairedTypes).toEqual(preset.pairedTypes);
      // every layer is written explicitly (true or false), exactly once
      expect(state.layerWrites).toBe(LAYER_KEYS.length);
      for (const k of LAYER_KEYS) expect(state.layers[k]).toBe(preset.layers[k]);
    },
  );

  it("switching scenarios leaves nothing from the previous one behind", () => {
    const { state, setters } = fakeApp();
    applyPresetTo(scenarioById("tunnel-vision")!.preset, setters);
    expect(state.layers.tunneling).toBe(true);
    expect(state.pairedTypes).toEqual(["FF", "SL"]);

    applyPresetTo(scenarioById("chase-map")!.preset, setters);
    expect(state.layers.tunneling).toBe(false);
    expect(state.layers.pairComparison).toBe(false);
    expect(state.pairedTypes).toBeNull();
    expect(state.layers.heatmap).toBe(true);
    expect(state.heatmapMode).toBe("whiff_rate");
  });

  it("the live preset resets contact-lab's bat settings and layers", () => {
    const { state, setters } = fakeApp();
    applyPresetTo(scenarioById("contact-lab")!.preset, setters);
    expect(state.batSpeed).toBe(72);
    expect(state.layers.contactSim).toBe(true);

    applyPresetTo(LIVE_PRESET, setters);
    expect(state.batSpeed).toBe(75);
    expect(state.attackAngleDeg).toBe(10);
    expect(Object.values(state.layers).every((v) => v === false)).toBe(true);
  });

  it("copies selectedTypes into a fresh Set so presets are never mutated", () => {
    const { state, setters } = fakeApp();
    const preset = scenarioById("corpus-slice")!.preset;
    applyPresetTo(preset, setters);
    (state.selectedTypes as Set<string>).add("ZZ");
    expect(preset.selectedTypes).not.toContain("ZZ");
  });
});
