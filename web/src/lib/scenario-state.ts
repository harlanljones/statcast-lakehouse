/**
 * Applies a scenario preset to the app's state through a setter bag, so the
 * "one preset = one atomic state change" rule is testable without a DOM or
 * Solid runtime. App.tsx supplies its real signal setters; tests supply fakes.
 */
import type { CameraViewName, OutcomeFilter, ZoneFilter } from "./deck-layers";
import type { HeatmapMode } from "./heatmap";
import type { LayerKey, ScenarioPreset } from "./scenarios";

export interface PresetSetters {
  setView: (v: CameraViewName) => void;
  setSpeedRange: (v: [number, number]) => void;
  setPlateXRange: (v: [number, number]) => void;
  setPlateZRange: (v: [number, number]) => void;
  setZoneFilter: (v: ZoneFilter) => void;
  setOutcomeFilter: (v: OutcomeFilter) => void;
  setSelectedTypes: (v: ReadonlySet<string>) => void;
  setLayer: (key: LayerKey, on: boolean) => void;
  setHeatmapMode: (v: HeatmapMode) => void;
  setBatSpeed: (v: number) => void;
  setAttackAngleDeg: (v: number) => void;
  setPairedTypes: (v: [string, string] | null) => void;
}

/** Every layer a preset controls; each is written explicitly so nothing leaks between scenarios. */
export const LAYER_KEYS: readonly LayerKey[] = [
  "tunneling",
  "ghostBreak",
  "releasePoints",
  "plateCrossings",
  "breakChart",
  "pairComparison",
  "contactSim",
  "dispersion",
  "fatigue",
  "heatmap",
];

export function applyPresetTo(p: ScenarioPreset, s: PresetSetters): void {
  s.setView(p.view);
  s.setSpeedRange(p.speedRange);
  s.setPlateXRange(p.plateXRange);
  s.setPlateZRange(p.plateZRange);
  s.setZoneFilter(p.zoneFilter);
  s.setOutcomeFilter(p.outcomeFilter);
  s.setSelectedTypes(new Set(p.selectedTypes));
  for (const key of LAYER_KEYS) s.setLayer(key, p.layers[key]);
  s.setHeatmapMode(p.heatmapMode);
  s.setBatSpeed(p.batSpeed);
  s.setAttackAngleDeg(p.attackAngleDeg);
  s.setPairedTypes(p.pairedTypes);
}
