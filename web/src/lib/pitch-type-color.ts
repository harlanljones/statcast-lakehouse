/**
 * Pitch-type color mapping — single source of truth for both the 3D
 * trajectory layer (deck-layers re-exports these) and the 2D legend.
 *
 * Known Statcast codes map to the shared pitch palette. Unknown codes fall
 * back to a deterministic per-code color derived from a string hash — stable
 * across reloads, distinct between different unknown codes — so legend and
 * trajectories always agree. The neutral gray fallback is reserved for
 * missing/empty codes only.
 */

/** FNV-1a 32-bit hash: pure, stable across sessions, no Math.random. */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Shared pitch palette: 4-seam FF, slider SL, curve CU, change CH,
 * cutter FC, sinker SI, sweeper ST, plus common Statcast codes.
 */
export const PITCH_COLORS: Readonly<Record<string, [number, number, number]>> = Object.freeze({
  FF: [230, 57, 70], // 4-seam fastball — red
  FT: [241, 133, 44], // two-seam — orange
  SI: [184, 115, 51], // sinker — rust
  FC: [255, 196, 0], // cutter — gold
  SL: [67, 170, 139], // slider — teal
  ST: [38, 132, 255], // sweeper — blue
  SW: [38, 132, 255], // sweeper (alt code)
  CU: [139, 81, 255], // curveball — violet
  KC: [97, 62, 178], // knuckle curve — deep violet
  CS: [72, 61, 139], // slow curve — slate violet
  CH: [42, 157, 244], // changeup — sky blue
  FS: [0, 181, 204], // splitter — cyan
  FO: [0, 181, 204], // forkball — cyan
  KN: [199, 199, 111], // knuckleball — olive
  EP: [155, 205, 155], // eephus — pale green
  SC: [188, 140, 255], // screwball — light violet
});

export const FALLBACK_COLOR: [number, number, number] = [160, 160, 160];

/** Golden-angle hue steps keep distinct unknown codes visually separated. */
export function deterministicFallbackColor(code: string): [number, number, number] {
  const hue = hash32(code.toUpperCase()) % 360;
  // HSL -> RGB, s = 0.55, l = 0.55 (readable on both light and dark panels).
  const c = (1 - Math.abs(2 * 0.55 - 1)) * 0.55;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = 0.55 - c / 2;
  const seg = Math.floor(hue / 60) % 6;
  const table: [number, number, number][] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ];
  const [r, g, b] = table[seg];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/** Stable deterministic color for a pitch-type code, as an RGB tuple. */
export function pitchTypeColor(pitchType: string): [number, number, number] {
  const key = pitchType?.toUpperCase() ?? "";
  if (!key) return FALLBACK_COLOR;
  return PITCH_COLORS[key] ?? deterministicFallbackColor(key);
}

/** Alias kept for deck-layers/ControlPanel call sites (trajectory colors). */
export function pitchColor(pitchType: string): [number, number, number] {
  return pitchTypeColor(pitchType);
}
