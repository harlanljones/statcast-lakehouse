import { describe, expect, it } from "vitest";
import { clampViewState, ZOOM_LIMITS } from "./camera";
import { keyboardCameraStep, stepPitch, ORBIT_STEP_DEG, ZOOM_STEP } from "./keyboard";

describe("stepPitch", () => {
  const items = ["a", "b", "c"];
  it("steps forward and backward, wrapping at both ends", () => {
    expect(stepPitch(items, "a", 1)).toBe("b");
    expect(stepPitch(items, "c", 1)).toBe("a");
    expect(stepPitch(items, "a", -1)).toBe("c");
    expect(stepPitch(items, "b", -1)).toBe("a");
  });
  it("starts at the first/last item when nothing (or a hidden pitch) is pinned", () => {
    expect(stepPitch(items, null, 1)).toBe("a");
    expect(stepPitch(items, null, -1)).toBe("c");
    expect(stepPitch(items, "zzz", 1)).toBe("a");
  });
  it("returns null for an empty list", () => {
    expect(stepPitch([], null, 1)).toBeNull();
  });
});

describe("keyboardCameraStep", () => {
  const view = { target: [0, 14, 1.8] as [number, number, number], rotationX: 8, rotationOrbit: 0, zoom: 4.8 };
  it("Shift+Up/Down orbits rotationX by 5 degrees", () => {
    expect(keyboardCameraStep(view, "ArrowUp", true)!.rotationX).toBe(8 + ORBIT_STEP_DEG);
    expect(keyboardCameraStep(view, "ArrowDown", true)!.rotationX).toBe(8 - ORBIT_STEP_DEG);
    expect(keyboardCameraStep({ ...view, rotationX: 88 }, "ArrowUp", true)!.rotationX).toBe(90);
    expect(keyboardCameraStep({ ...view, rotationX: -88 }, "ArrowDown", true)!.rotationX).toBe(-90);
  });
  it("plain Up/Down zooms by 0.25 and the result stays inside the zoom limits once clamped", () => {
    expect(keyboardCameraStep(view, "ArrowUp", false)!.zoom).toBeCloseTo(4.8 + ZOOM_STEP, 9);
    expect(keyboardCameraStep(view, "ArrowDown", false)!.zoom).toBeCloseTo(4.8 - ZOOM_STEP, 9);
    const past = keyboardCameraStep({ ...view, zoom: ZOOM_LIMITS.maxZoom }, "ArrowUp", false)!;
    expect(clampViewState(past).zoom).toBe(ZOOM_LIMITS.maxZoom);
  });
  it("ignores other keys", () => {
    expect(keyboardCameraStep(view, "ArrowLeft", false)).toBeNull();
    expect(keyboardCameraStep(view, "a", true)).toBeNull();
  });
});
