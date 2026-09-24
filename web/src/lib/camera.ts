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

/**
 * Canvas size (CSS px) the presets were framed on: the 3D pane of a 1440x900
 * laptop window. OrbitView zoom is pixels per foot at the target and the
 * camera distance follows the canvas height, so one fixed zoom crops the scene
 * (and parks the camera inside the pitch bundle) on a short canvas and leaves
 * it tiny on a large one.
 */
export const REFERENCE_CANVAS = { width: 1180, height: 630 } as const;
/** OrbitView's default vertical field of view, the one the presets use. */
export const REFERENCE_FOVY = 50;

export interface CanvasFit {
  /** log2 zoom shift applied on top of the canvas-independent view. */
  zoomOffset: number;
  /** Vertical field of view (degrees) for the OrbitView. */
  fovy: number;
}

const DEG = Math.PI / 180;

/**
 * Fit the reference framing into a width x height canvas. The image is scaled
 * by min(width, height) against the reference, and the field of view widens on
 * canvases narrower than the reference aspect so the camera stays exactly where
 * it is on the reference canvas: same distance, same perspective, just more
 * sky and ground above and below on a portrait screen.
 */
export function fitCanvas(width: number, height: number): CanvasFit {
  if (!(width > 0) || !(height > 0)) return { zoomOffset: 0, fovy: REFERENCE_FOVY };
  const scale = Math.min(width / REFERENCE_CANVAS.width, height / REFERENCE_CANVAS.height);
  const halfTan = (Math.tan((REFERENCE_FOVY / 2) * DEG) * height) / (REFERENCE_CANVAS.height * scale);
  return { zoomOffset: Math.log2(scale), fovy: (2 * Math.atan(halfTan)) / DEG };
}

/** Canvas-independent view -> the view deck.gl renders (zoom and its limits shifted by the fit). */
export function toCanvasView(vs: OrbitViewState, zoomOffset: number): OrbitViewState {
  return {
    ...vs,
    zoom: vs.zoom + zoomOffset,
    minZoom: ZOOM_LIMITS.minZoom + zoomOffset,
    maxZoom: ZOOM_LIMITS.maxZoom + zoomOffset,
  };
}

/** Inverse of toCanvasView: what the user did, expressed in canvas-independent zoom. */
export function fromCanvasView(vs: OrbitViewState, zoomOffset: number): OrbitViewState {
  return { ...vs, ...ZOOM_LIMITS, zoom: vs.zoom - zoomOffset };
}

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
