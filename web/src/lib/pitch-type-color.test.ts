/** Pitch-type legend color mapping: stable, deterministic, pure. */
import { describe, expect, it } from "vitest";
import { PITCH_COLORS, FALLBACK_COLOR } from "./deck-layers";
import { pitchTypeColor } from "./pitch-type-color";

describe("pitchTypeColor", () => {
  it("maps known codes to the shared pitch palette", () => {
    for (const [code, rgb] of Object.entries(PITCH_COLORS)) {
      expect(pitchTypeColor(code)).toEqual(rgb);
    }
  });

  it("is case-insensitive", () => {
    expect(pitchTypeColor("ff")).toEqual(PITCH_COLORS.FF);
  });

  it("falls back deterministically for unknown codes (not a single gray blob)", () => {
    const a = pitchTypeColor("ZZ");
    const b = pitchTypeColor("XX");
    expect(pitchTypeColor("ZZ")).toEqual(a); // stable across calls
    expect(a).not.toEqual(b); // distinct unknowns stay distinguishable
    expect(a).not.toEqual(FALLBACK_COLOR);
    expect(a).toHaveLength(3);
    for (const c of a) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
      expect(Number.isInteger(c)).toBe(true);
    }
  });

  it("handles empty and nullish input gracefully", () => {
    expect(() => pitchTypeColor("")).not.toThrow();
    expect(pitchTypeColor("")).toEqual(FALLBACK_COLOR);
  });
});
