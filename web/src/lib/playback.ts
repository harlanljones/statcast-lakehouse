/**
 * Play-button semantics. With prefers-reduced-motion the flight is not
 * animated: Play jumps straight to 100% and playback never starts.
 */
export function nextPlayState(
  playing: boolean,
  reducedMotion: boolean,
): { playing: boolean; progress?: number } {
  if (reducedMotion) return { playing: false, progress: 1 };
  return { playing: !playing };
}

/** True when the user asked the OS/browser for reduced motion (false outside a browser). */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
