import { describe, expect, it } from "vitest";
import { nextPlayState, prefersReducedMotion } from "./playback";

describe("nextPlayState", () => {
  it("toggles playback normally", () => {
    expect(nextPlayState(false, false)).toEqual({ playing: true });
    expect(nextPlayState(true, false)).toEqual({ playing: false });
  });

  it("under reduced motion, Play jumps to 100% and never starts an animation", () => {
    expect(nextPlayState(false, true)).toEqual({ playing: false, progress: 1 });
    expect(nextPlayState(true, true)).toEqual({ playing: false, progress: 1 });
  });

  it("prefersReducedMotion is false without a browser", () => {
    expect(prefersReducedMotion()).toBe(false);
  });
});
