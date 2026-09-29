/** Pitch-type legend color mapping: stable, deterministic, pure. */
import { describe, expect, it } from "vitest";
import { PITCH_COLORS, FALLBACK_COLOR } from "./deck-layers";
import { pitchTypeColor, pitchName, PITCH_NAMES } from "./pitch-type-color";

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

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

  it("keeps the fastball family visually distinct (FA, FT, SI vs FF and each other)", () => {
    expect(PITCH_COLORS.FA).toEqual([255, 120, 90]);
    expect(PITCH_COLORS.FT).toEqual([255, 140, 0]);
    expect(PITCH_COLORS.SI).toEqual([190, 110, 40]);
    const fam = ["FF", "FA", "FT", "SI"];
    for (const a of fam) {
      for (const b of fam) if (a < b) expect(dist(PITCH_COLORS[a], PITCH_COLORS[b]), `${a} vs ${b}`).toBeGreaterThan(40);
    }
  });

  it("names every palette code (chips get an accessible pitch name)", () => {
    for (const code of Object.keys(PITCH_COLORS)) {
      if (code === "SW") continue; // alt sweeper code
      expect(PITCH_NAMES[code], code).toBeTruthy();
    }
    expect(pitchName("ff")).toBe("Four-seam fastball");
    expect(pitchName("EP")).toBe("Eephus");
    expect(pitchName("ZZ")).toBeUndefined();
    expect(pitchName("")).toBeUndefined();
  });

  it("handles empty and nullish input gracefully", () => {
    expect(() => pitchTypeColor("")).not.toThrow();
    expect(pitchTypeColor("")).toEqual(FALLBACK_COLOR);
  });
});
