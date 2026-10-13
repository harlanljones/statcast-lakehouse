import { describe, expect, it } from "vitest";
import type { PitchDatum } from "./deck-layers";
import { countMix } from "./count-mix";

const pitch = (over: Partial<PitchDatum>): PitchDatum => ({
  path: new Float32Array(3),
  releaseSpeed: 92,
  pfxX: 0,
  pfxZ: 0,
  plateX: 0,
  plateZ: 2.5,
  pitchType: "FF",
  ...over,
});

describe("countMix", () => {
  const pitches = [
    pitch({ pitcherId: 1, balls: 0, strikes: 0, pitchType: "FF", releaseSpeed: 96, isSwing: 0, isWhiff: 0 }),
    pitch({ pitcherId: 1, balls: 0, strikes: 1, pitchType: "SL", releaseSpeed: 86, isSwing: 1, isWhiff: 1 }),
    pitch({ pitcherId: 1, balls: 0, strikes: 2, pitchType: "SL", releaseSpeed: 85, isSwing: 1, isWhiff: 0 }),
    pitch({ pitcherId: 1, balls: 1, strikes: 0, pitchType: "FF", releaseSpeed: 95, isSwing: 1, isWhiff: 0 }),
    pitch({ pitcherId: 1, balls: 1, strikes: 1, pitchType: "CH", releaseSpeed: 84, isSwing: 0, isWhiff: 0 }),
    // another pitcher's counts must not leak in
    pitch({ pitcherId: 2, balls: 0, strikes: 2, pitchType: "CU", releaseSpeed: 78, isSwing: 1, isWhiff: 1 }),
    // no count at all: excluded from every bucket
    pitch({ pitcherId: 1, pitchType: "FF" }),
  ];

  it("returns the four buckets in display order, never dropping an empty one", () => {
    const rows = countMix([pitch({ pitcherId: 9, balls: 3, strikes: 0 })], 9);
    expect(rows.map((r) => r.bucket)).toEqual(["first", "pitcher_ahead", "hitter_ahead", "even"]);
    expect(rows.map((r) => r.label)).toEqual(["First pitch", "Pitcher ahead", "Hitter ahead", "Even"]);
    expect(rows.map((r) => r.pitches)).toEqual([0, 0, 1, 0]);
    expect(rows[0].swingRate).toBeNull();
    expect(rows[0].whiffRate).toBeNull();
    expect(rows[0].topTypes).toEqual([]);
  });

  it("counts one pitcher's pitches per bucket, with rates over that bucket", () => {
    const rows = countMix(pitches, 1);
    const byBucket = Object.fromEntries(rows.map((r) => [r.bucket, r]));
    expect(byBucket.first.pitches).toBe(1);
    expect(byBucket.pitcher_ahead.pitches).toBe(2);
    expect(byBucket.pitcher_ahead.swings).toBe(2);
    expect(byBucket.pitcher_ahead.whiffRate).toBeCloseTo(0.5);
    expect(byBucket.pitcher_ahead.avgSpeed).toBeCloseTo((86 + 85) / 2);
    expect(byBucket.hitter_ahead.pitches).toBe(1);
    expect(byBucket.even.pitches).toBe(1);
    // the rows are disjoint and cover every pitch that carries a count
    expect(rows.reduce((n, r) => n + r.pitches, 0)).toBe(5);
  });

  it("lists the top three types per bucket, ordered by count then code", () => {
    const rows = countMix(pitches, 1);
    const byBucket = Object.fromEntries(rows.map((r) => [r.bucket, r]));
    expect(byBucket.pitcher_ahead.topTypes.map((t) => t.type)).toEqual(["SL"]);
    expect(byBucket.pitcher_ahead.topTypes[0].share).toBeCloseTo(1);
    const mixed = countMix(
      [
        pitch({ balls: 1, strikes: 2, pitchType: "FF" }),
        pitch({ balls: 0, strikes: 2, pitchType: "FF" }),
        pitch({ balls: 2, strikes: 2, pitchType: "SL" }),
        pitch({ balls: 0, strikes: 1, pitchType: "CH" }),
      ],
      undefined,
    );
    const ahead = mixed.find((r) => r.bucket === "pitcher_ahead")!;
    expect(ahead.pitches).toBe(3);
    expect(ahead.topTypes.map((t) => t.type)).toEqual(["FF", "CH"]);
  });

  it("covers every pitcher when no id is given", () => {
    const rows = countMix(pitches);
    expect(rows.reduce((n, r) => n + r.pitches, 0)).toBe(6);
  });
});
