import { describe, expect, it } from "vitest";
import { CAMERA_VIEWS } from "./deck-layers";
import {
  CAMERA_BOUNDS,
  REFERENCE_CANVAS,
  REFERENCE_FOVY,
  ZOOM_LIMITS,
  clampViewState,
  controllerOptions,
  fitCanvas,
  fromCanvasView,
  toCanvasView,
  withLimits,
} from "./camera";

describe("controllerOptions", () => {
  it("rotates on drag by default and pans on request", () => {
    expect(controllerOptions("rotate").dragMode).toBe("rotate");
    expect(controllerOptions("pan").dragMode).toBe("pan");
  });

  it("keeps every gesture on: scroll zoom, drag, double-click zoom and touch", () => {
    for (const mode of ["rotate", "pan"] as const) {
      const c = controllerOptions(mode);
      expect(c.scrollZoom).toBeTruthy();
      expect(c.dragPan).toBe(true);
      expect(c.dragRotate).toBe(true);
      expect(c.doubleClickZoom).toBe(true);
      expect(c.touchZoom).toBe(true);
      expect(c.touchRotate).toBe(true);
    }
  });
});

describe("withLimits", () => {
  it("adds zoom limits without touching the preset", () => {
    const limited = withLimits(CAMERA_VIEWS.Catcher);
    expect(limited.minZoom).toBe(ZOOM_LIMITS.minZoom);
    expect(limited.maxZoom).toBe(ZOOM_LIMITS.maxZoom);
    expect(limited.zoom).toBe(CAMERA_VIEWS.Catcher.zoom);
    expect("minZoom" in CAMERA_VIEWS.Catcher).toBe(false);
  });

  it("leaves every preset inside its own limits and scene bounds", () => {
    for (const vs of Object.values(CAMERA_VIEWS)) {
      const c = clampViewState(withLimits(vs));
      expect(c.zoom).toBe(vs.zoom);
      expect(c.target).toEqual(vs.target);
    }
  });
});

describe("clampViewState", () => {
  const base = withLimits(CAMERA_VIEWS.Catcher);

  it("clamps zoom into the limits", () => {
    expect(clampViewState({ ...base, zoom: 99 }).zoom).toBe(ZOOM_LIMITS.maxZoom);
    expect(clampViewState({ ...base, zoom: -5 }).zoom).toBe(ZOOM_LIMITS.minZoom);
  });

  it("keeps the camera target inside the scene so the field cannot be panned out of view", () => {
    const far = clampViewState({ ...base, target: [500, -500, 500] });
    expect(far.target).toEqual([CAMERA_BOUNDS.x[1], CAMERA_BOUNDS.y[0], CAMERA_BOUNDS.z[1]]);
    const other = clampViewState({ ...base, target: [-500, 500, -500] });
    expect(other.target).toEqual([CAMERA_BOUNDS.x[0], CAMERA_BOUNDS.y[1], CAMERA_BOUNDS.z[0]]);
  });

  it("preserves rotation and returns a valid view unchanged", () => {
    const vs = { ...base, rotationX: 33, rotationOrbit: 120 };
    expect(clampViewState(vs)).toEqual(vs);
  });
});

describe("fitCanvas", () => {
  // OrbitView: camera distance = height / 2 / tan(fovy / 2) / 2^zoom (world units).
  const distance = (height: number, zoom: number, fovy: number) =>
    height / 2 / Math.tan((fovy / 2) * (Math.PI / 180)) / 2 ** zoom;
  const { width: W, height: H } = REFERENCE_CANVAS;
  const z = CAMERA_VIEWS.Catcher.zoom;

  it("leaves the reference canvas untouched", () => {
    const fit = fitCanvas(W, H);
    expect(fit.zoomOffset).toBeCloseTo(0, 9);
    expect(fit.fovy).toBeCloseTo(REFERENCE_FOVY, 9);
  });

  it("falls back to the reference while the canvas has no size yet", () => {
    expect(fitCanvas(0, 0)).toEqual({ zoomOffset: 0, fovy: REFERENCE_FOVY });
    expect(fitCanvas(800, 0)).toEqual({ zoomOffset: 0, fovy: REFERENCE_FOVY });
  });

  it("scales the image with the canvas so a short or large screen frames the same scene", () => {
    expect(fitCanvas(W / 2, H / 2).zoomOffset).toBeCloseTo(-1, 9);
    expect(fitCanvas(W * 2, H * 2).zoomOffset).toBeCloseTo(1, 9);
    // A wide, short strip is height-bound: same field of view, smaller image.
    const strip = fitCanvas(767, 310);
    expect(strip.zoomOffset).toBeCloseTo(Math.log2(310 / H), 9);
    expect(strip.fovy).toBeCloseTo(REFERENCE_FOVY, 9);
  });

  it("keeps the camera where the reference puts it on every canvas, portrait phones included", () => {
    const ref = distance(H, z, REFERENCE_FOVY);
    for (const [w, h] of [[390, 560], [563, 763], [767, 310], [1663, 841], [3000, 400]]) {
      const fit = fitCanvas(w, h);
      expect(distance(h, z + fit.zoomOffset, fit.fovy)).toBeCloseTo(ref, 6);
      // Width-bound canvases widen the field of view instead of pulling the camera back.
      expect(fit.fovy).toBeGreaterThanOrEqual(REFERENCE_FOVY - 1e-9);
      expect(fit.fovy).toBeLessThan(180);
    }
  });

  it("shifts zoom and its limits together, and maps a user's zoom back to the reference", () => {
    const base = withLimits(CAMERA_VIEWS.Catcher);
    const onCanvas = toCanvasView(base, -1.5);
    expect(onCanvas.zoom).toBeCloseTo(base.zoom - 1.5, 9);
    expect(onCanvas.minZoom).toBeCloseTo(ZOOM_LIMITS.minZoom - 1.5, 9);
    expect(onCanvas.maxZoom).toBeCloseTo(ZOOM_LIMITS.maxZoom - 1.5, 9);
    expect(fromCanvasView(onCanvas, -1.5)).toEqual(base);
  });
});
