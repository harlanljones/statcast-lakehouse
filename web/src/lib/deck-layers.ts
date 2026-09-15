/**
 * Deck.gl layer definitions (TDD §5.3).
 *
 * GPU-side filtering: slider signals bind straight to DataFilterExtension
 * filter ranges — no JavaScript array filtering on the interaction path.
 */
import { DataFilterExtension } from "@deck.gl/extensions";
import type { OrbitViewState } from "@deck.gl/core";

export const ORBIT_TARGET: [number, number, number] = [0, 1.417, 2.5];
export const INITIAL_VIEW: OrbitViewState = {
  target: ORBIT_TARGET,
  rotationX: 12,
  rotationOrbit: 35,
  zoom: 6.2,
};

export interface PitchDatum {
  path: Float32Array;
  releaseSpeed: number;
  pfxX: number;
  pfxZ: number;
  pitchType: string;
}

export const FILTER_SIZE = 3;

export function dataFilterExtension() {
  return new DataFilterExtension({ filterSize: FILTER_SIZE });
}
