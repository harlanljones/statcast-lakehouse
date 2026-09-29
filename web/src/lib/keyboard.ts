/**
 * Keyboard navigation for the 3D canvas: stepping the pinned pitch through the
 * visible set, and camera orbit/zoom steps. Pure, so it is testable without a
 * canvas; Visualizer wires the key events and applies the result through its
 * clamped applyView.
 */
import type { OrbitViewState } from "@deck.gl/core";

export const ORBIT_STEP_DEG = 5;
export const ZOOM_STEP = 0.25;

/**
 * Next/previous item, wrapping. When `current` is not in `items` (nothing
 * pinned, or pinned pitch filtered out) ArrowRight starts at the first item
 * and ArrowLeft at the last. Empty list: null.
 */
export function stepPitch<T>(items: readonly T[], current: T | null | undefined, dir: 1 | -1): T | null {
  if (items.length === 0) return null;
  const i = current == null ? -1 : items.indexOf(current);
  if (i < 0) return dir === 1 ? items[0] : items[items.length - 1];
  return items[(i + dir + items.length) % items.length];
}

/**
 * Camera step for ArrowUp/ArrowDown: Shift orbits rotationX by 5 degrees
 * (clamped to +/-90), plain arrows zoom by 0.25. Returns null for other keys.
 * The caller clamps zoom and target through clampViewState.
 */
export function keyboardCameraStep(view: OrbitViewState, key: string, shift: boolean): OrbitViewState | null {
  if (key !== "ArrowUp" && key !== "ArrowDown") return null;
  const sign = key === "ArrowUp" ? 1 : -1;
  if (shift) {
    const rotationX = Math.min(90, Math.max(-90, (view.rotationX ?? 0) + sign * ORBIT_STEP_DEG));
    return { ...view, rotationX };
  }
  return { ...view, zoom: view.zoom + sign * ZOOM_STEP };
}
