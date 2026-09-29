/** Design tokens: THEME and app.css stay in sync, and the palette keeps its contrast promises. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTROL_BORDER, THEME } from "./theme";

const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

const rootVars = (): Record<string, string> => {
  const block = /:root\s*\{([^}]*)\}/.exec(css)![1];
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
};

type RGB = [number, number, number];
function parse(color: string): { rgb: RGB; a: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a: 1 };
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(color)!;
  const [r, g, b, a] = m[1].split(",").map((x) => parseFloat(x));
  return { rgb: [r, g, b], a: a ?? 1 };
}
const over = (fg: string, bg: RGB): RGB => {
  const { rgb, a } = parse(fg);
  return [0, 1, 2].map((i) => rgb[i] * a + bg[i] * (1 - a)) as RGB;
};
const lum = ([r, g, b]: RGB) => {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// The card sits on the near-black canvas: composite the translucent panel over the page background.
const pageBg = parse(THEME.bg).rgb;
const panelBg = over(THEME.panel, pageBg);

describe("THEME <-> app.css", () => {
  it("exposes every THEME token as a :root custom property with the same value", () => {
    const vars = rootVars();
    for (const [key, value] of Object.entries(THEME)) {
      expect(vars[key], `--${key}`).toBe(value);
    }
    expect(vars["ctl-border"]).toBe(CONTROL_BORDER);
  });

  it("has no !important anywhere (index.html has no inline style block either)", () => {
    expect(css).not.toMatch(/!important/);
    expect(html).not.toMatch(/!important|<style/);
  });

  it("uses the system font stack (no unloaded webfont)", () => {
    expect(css).not.toMatch(/Inter/);
    expect(html).not.toMatch(/fonts\.googleapis/);
    expect(rootVars().font).toMatch(/^system-ui/);
  });

  it("styles the responsive shell by class: rail strip at 1000px, phone stack at 720px", () => {
    expect(css).toMatch(/@media \(max-width: 1000px\)/);
    expect(css).toMatch(/@media \(max-width: 720px\)/);
    for (const cls of ["app-shell", "app-header", "app-body", "scenario-rail", "app-viz", "viz-dock-left", "viz-dock-right"]) {
      expect(css, cls).toContain(`.${cls}`);
    }
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });
});

describe("contrast", () => {
  it("every text color reaches 4.5:1 on the panel and on the page", () => {
    for (const key of ["text", "muted", "accent", "gold", "good", "bad"] as const) {
      const fg = parse(THEME[key]).rgb;
      expect(contrast(fg, panelBg), `${key} on panel`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(fg, pageBg), `${key} on page`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("dark button text on the accent fill reaches 4.5:1", () => {
    expect(contrast(parse("#0b1220").rgb, parse(THEME.accent).rgb)).toBeGreaterThanOrEqual(4.5);
  });

  it("interactive control outlines reach 3:1 against the panel", () => {
    expect(contrast(over(CONTROL_BORDER, panelBg), panelBg)).toBeGreaterThanOrEqual(3);
  });

  it("no dim grays (#777, #666, #888) remain in the components", () => {
    const dir = new URL("../components/", import.meta.url);
    for (const f of ["BreakChart", "PairComparisonPanel", "FatiguePanel", "PlayerCard", "LensPanel", "StoryCaption", "ScenarioRail"]) {
      const src = readFileSync(new URL(`${f}.tsx`, dir), "utf8");
      expect(src, f).not.toMatch(/#(777|666|888|ccc|ffd700|66ff66|ff6666|222|444)\b/i);
    }
  });
});
