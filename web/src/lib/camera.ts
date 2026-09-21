/**
 * Camera navigation for the OrbitView: gesture configuration and guard rails.
 * Pure helpers so the behaviour is testable without a canvas.
 *
 *   scroll        zoom (cursor-anchored, smoothed)
 *   drag          rotate (or pan, when dragMode is "pan")
 *   shift/right   the opposite of the drag mode
 *   touch         one finger rotates, two fingers pinch-zoom
 */
import type { OrbitViewState } from "@deck.gl/core";

export type DragMode = "rotate" | "pan";

/** Zoom range: the presets sit between 3.7 and 5.0, so this leaves room both ways. */
export const ZOOM_LIMITS = { minZoom: 2, maxZoom: 8 } as const;

/** The camera target may not leave the field (feet: x across, y toward the mound, z up). */
export const CAMERA_BOUNDS = {
  x: [-25, 25],
  y: [-10, 70],
  z: [-2, 20],
} as const;

export function controllerOptions(dragMode: DragMode) {
  return {
    dragMode,
    scrollZoom: { speed: 0.01, smooth: true },
    dragPan: true,
    dragRotate: true,
    doubleClickZoom: true,
    touchZoom: true,
    touchRotate: true,
    inertia: 250,
  };
}

/** A preset with the zoom limits attached (the preset itself is never mutated). */
export function withLimits(vs: OrbitViewState): OrbitViewState {
  return { ...vs, ...ZOOM_LIMITS };
}

const clamp = (v: number, [lo, hi]: readonly [number, number] | readonly number[]) =>
  Math.min(Math.max(v, lo), hi);

/** Keep zoom in range and the target inside the field, so panning can never lose the scene. */
export function clampViewState(vs: OrbitViewState): OrbitViewState {
  const [x, y, z] = vs.target;
  return {
    ...vs,
    zoom: clamp(vs.zoom, [ZOOM_LIMITS.minZoom, ZOOM_LIMITS.maxZoom]),
    target: [clamp(x, CAMERA_BOUNDS.x), clamp(y, CAMERA_BOUNDS.y), clamp(z, CAMERA_BOUNDS.z)],
  };
}
