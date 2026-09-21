import { describe, expect, it } from "vitest";
import { CAMERA_VIEWS } from "./deck-layers";
import { CAMERA_BOUNDS, ZOOM_LIMITS, clampViewState, controllerOptions, withLimits } from "./camera";

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
