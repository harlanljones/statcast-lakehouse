import { describe, expect, it } from "vitest";
import type { PitchDatum } from "./deck-layers";
import { isSyntheticSource, mlbLinks, pitchResult, playerLabel, summarizePitcher } from "./player-card";

const pitch = (over: Partial<PitchDatum>): PitchDatum => ({
  path: new Float32Array(0),
  releaseSpeed: 90,
  pfxX: 0,
  pfxZ: 0,
  plateX: 0,
  plateZ: 2.5,
  pitchType: "FF",
  ...over,
});

describe("summarizePitcher", () => {
  const pitches = [
    pitch({ pitcherId: 1, pitchType: "FF", releaseSpeed: 96, isSwing: 1, isWhiff: 1 }),
    pitch({ pitcherId: 1, pitchType: "FF", releaseSpeed: 94, isSwing: 1, isWhiff: 0 }),
    pitch({ pitcherId: 1, pitchType: "SL", releaseSpeed: 86, isSwing: 0, isWhiff: 0 }),
    pitch({ pitcherId: 2, pitchType: "CU", releaseSpeed: 78, isSwing: 1, isWhiff: 1 }),
  ];

  it("counts only that pitcher's pitches and averages their speed", () => {
    const s = summarizePitcher(pitches, 1)!;
    expect(s.count).toBe(3);
    expect(s.avgSpeed).toBeCloseTo((96 + 94 + 86) / 3);
  });

  it("computes whiff rate over swings, not over all pitches", () => {
    const s = summarizePitcher(pitches, 1)!;
    expect(s.swings).toBe(2);
    expect(s.whiffRate).toBeCloseTo(0.5);
  });

  it("has no whiff rate when the pitcher drew no swings", () => {
    const s = summarizePitcher([pitch({ pitcherId: 3, isSwing: 0 })], 3)!;
    expect(s.whiffRate).toBeNull();
  });

  it("orders the pitch mix by count then type, and shares add up to 1", () => {
    const s = summarizePitcher(pitches, 1)!;
    expect(s.mix.map((m) => m.type)).toEqual(["FF", "SL"]);
    expect(s.mix[0]).toMatchObject({ type: "FF", count: 2 });
    expect(s.mix.reduce((a, m) => a + m.share, 0)).toBeCloseTo(1);
  });

  it("returns null for an unknown pitcher", () => {
    expect(summarizePitcher(pitches, 999)).toBeNull();
  });
});

describe("mlbLinks", () => {
  const byLabel = (links: ReturnType<typeof mlbLinks>, label: string) =>
    links.find((l) => l.label === label)!;

  it("disables every link for synthetic pitches and says why", () => {
    const links = mlbLinks({ synthetic: true, pitcherId: 543037, batterId: 500001, gameId: 2026091401 });
    expect(links.map((l) => l.label)).toEqual(["Watch pitch", "Game feed", "Pitcher on Savant", "Batter on Savant"]);
    for (const l of links) {
      expect(l.href).toBeNull();
      expect(l.reason).toMatch(/synthetic/i);
    }
  });

  it("links to the pitch video when a play id is present", () => {
    const links = mlbLinks({ synthetic: false, pitcherId: 1, batterId: 2, gameId: 745321, playId: "7970bd19-d633-4ea1-be2f-2af453d0ec46" });
    expect(byLabel(links, "Watch pitch").href).toBe(
      "https://baseballsavant.mlb.com/sporty-videos?playId=7970bd19-d633-4ea1-be2f-2af453d0ec46",
    );
  });

  it("falls back to the game feed when a real pitch has no play id", () => {
    const links = mlbLinks({ synthetic: false, pitcherId: 1, batterId: 2, gameId: 745321 });
    expect(byLabel(links, "Watch pitch").href).toBeNull();
    expect(byLabel(links, "Watch pitch").reason).toMatch(/video id/i);
    expect(byLabel(links, "Game feed").href).toBe("https://baseballsavant.mlb.com/gamefeed?game_pk=745321");
  });

  it("links to the Savant player pages for real players", () => {
    const links = mlbLinks({ synthetic: false, pitcherId: 702352, batterId: 694384, gameId: 745321 });
    expect(byLabel(links, "Pitcher on Savant").href).toBe("https://baseballsavant.mlb.com/savant-player/702352");
    expect(byLabel(links, "Batter on Savant").href).toBe("https://baseballsavant.mlb.com/savant-player/694384");
  });

  it("disables a link whose id is missing instead of building a broken URL", () => {
    const links = mlbLinks({ synthetic: false });
    for (const l of links) expect(l.href).toBeNull();
  });

  it("encodes the play id", () => {
    const links = mlbLinks({ synthetic: false, gameId: 1, playId: "a b/c" });
    expect(byLabel(links, "Watch pitch").href).toBe("https://baseballsavant.mlb.com/sporty-videos?playId=a%20b%2Fc");
  });
});

describe("pitchResult", () => {
  it("names the outcome", () => {
    expect(pitchResult(pitch({ isSwing: 1, isWhiff: 1 }))).toBe("Swinging strike");
    expect(pitchResult(pitch({ isSwing: 1, isWhiff: 0 }))).toBe("Contact");
    expect(pitchResult(pitch({ isSwing: 0 }))).toBe("Take");
    expect(pitchResult(pitch({}))).toBe("Unknown");
  });
});

describe("playerLabel", () => {
  it("marks synthetic players so they are never mistaken for real ones", () => {
    expect(playerLabel("Pitcher", 543037, true)).toBe("Synthetic pitcher #543037");
    expect(playerLabel("Batter", 500001, true)).toBe("Synthetic batter #500001");
  });

  it("uses the real name when present and falls back to the id", () => {
    expect(playerLabel("Pitcher", 543037, false, "Shota Imanaga")).toBe("Shota Imanaga");
    expect(playerLabel("Batter", 543037, false, "Tommy Pham")).toBe("Tommy Pham");
    expect(playerLabel("Pitcher", 702352, false)).toBe("Pitcher #702352");
    expect(playerLabel("Batter", undefined, false)).toBe("Batter unknown");
  });

  it("keeps synthetic labels even if an accidental name is present", () => {
    expect(playerLabel("Pitcher", 543037, true, "Shota Imanaga")).toBe("Synthetic pitcher #543037");
  });
});

describe("isSyntheticSource", () => {
  it("treats the generated sample day as synthetic, even though it loads outside a scenario", () => {
    expect(isSyntheticSource({ kind: "sample" })).toBe(true);
  });

  it("follows the catalog flag for scenarios", () => {
    expect(isSyntheticSource({ kind: "scenario", synthetic: true })).toBe(true);
    expect(isSyntheticSource({ kind: "scenario", synthetic: false })).toBe(false);
  });

  it("treats a warehouse date partition as real data", () => {
    expect(isSyntheticSource({ kind: "partition", date: "2024-06-16" })).toBe(false);
  });
});
