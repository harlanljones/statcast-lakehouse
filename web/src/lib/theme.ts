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
  "cardinals-dodgers-opener": "#a78bfa",
  "tigers-astros-june": "#facc15",
  "yankees-athletics-2025": "#22d3ee",
  "twins-blue-jays-2026": "#f472b6",
  "season-sweep": "#e879f9",
  "strikeout-nights": "#38bdf8",
  "extra-innings": "#fbbf24",
  "power-nights": "#fb923c",
  "walk-off-wins": "#4ade80",
  "one-run-slugfests": "#f87171",
  "pitchers-duels": "#22d3ee",
  "multi-homer-nights": "#c4b5fd",
  "grand-slams": "#facc15",
  "big-innings": "#38bdf8",
  "strikeout-starts": "#a78bfa",
  "comeback-wins": "#5eead4",
  "multi-error-games": "#f9a8d4",
  "inning-after-inning": "#c7d2fe",
  "called-early": "#94a3b8",
  "combined-shutouts": "#a3e635",
  "blowouts": "#67e8f9",
  "hundred-pitch-starts": "#8b5cf6",
  "unclassified-pitches": "#d9f99d",
};
