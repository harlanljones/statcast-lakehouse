/**
 * Design tokens shared by the inline styles (THEME) and app.css (the same
 * values as custom properties on :root; theme.test.ts keeps the two in sync).
 */
export const THEME = {
  bg: "#020617",
  panel: "rgba(10, 15, 30, 0.95)",
  /** Decorative panel/card edges. */
  border: "rgba(255, 255, 255, 0.28)",
  text: "#e2e8f0",
  muted: "#94a3b8",
  accent: "#60a5fa",
  gold: "#fbbf24",
  good: "#4ade80",
  bad: "#f87171",
} as const;

/** Interactive control outlines (buttons, selects): >= 3:1 against the panel. */
export const CONTROL_BORDER = "rgba(255, 255, 255, 0.4)";

/** Per-story accent, exposed as --accent on the app shell. */
export const SCENE_ACCENT: Record<string, string> = {
  "twenty-run-night": "#38bdf8",
  "ohtani-50-50": "#fb923c",
  "ohtani-50th-home-run": "#c4b5fd",
  "freeman-walk-off": "#f87171",
  "snell-no-hitter": "#4ade80",
};
