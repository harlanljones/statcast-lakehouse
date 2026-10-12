import { describe, expect, it } from "vitest";
import type { PitchDatum } from "./deck-layers";
import {
  isSyntheticSource,
  mlbLinks,
  pitchResult,
  playerLabel,
  summarizeBatter,
  summarizePitcher,
} from "./player-card";

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

  it("reports swings per pitch seen alongside whiffs per swing", () => {
    const s = summarizePitcher(pitches, 1)!;
    expect(s.swingRate).toBeCloseTo(2 / 3);
  });

  describe("summarizeBatter", () => {
    const atBats = [
      pitch({ pitcherId: 1, batterId: 10, pitchType: "FF", releaseSpeed: 96, isSwing: 1, isWhiff: 1 }),
      pitch({ pitcherId: 1, batterId: 10, pitchType: "SL", releaseSpeed: 86, isSwing: 0, isWhiff: 0 }),
      pitch({ pitcherId: 2, batterId: 11, pitchType: "CU", releaseSpeed: 78, isSwing: 1, isWhiff: 0 }),
    ];

    it("summarises what that batter saw, not what the pitcher threw", () => {
      const b = summarizeBatter(atBats, 10)!;
      expect(b.batterId).toBe(10);
      expect(b.count).toBe(2);
      expect(b.avgSpeed).toBeCloseTo((96 + 86) / 2);
      expect(b.swings).toBe(1);
      expect(b.swingRate).toBeCloseTo(0.5);
      expect(b.whiffRate).toBe(1);
      expect(b.mix.map((m) => m.type)).toEqual(["FF", "SL"]);
      // the other batter's pitch must not leak in
      expect(summarizeBatter(atBats, 11)!.count).toBe(1);
      expect(summarizeBatter(atBats, 12)).toBeNull();
    });

    it("carries the contact that batter made", () => {
      const b = summarizeBatter(
        [pitch({ batterId: 10, launchSpeed: 99.0, bbType: "fly_ball" }), pitch({ batterId: 10, launchSpeed: 88.0, bbType: "ground_ball" })],
        10,
      )!;
      expect(b.contact!.measured).toBe(2);
      expect(b.contact!.hardHitRate).toBeCloseTo(0.5);
      expect(b.contact!.mix.map((m) => m.label)).toEqual(["fly ball", "ground ball"]);
    });
  });

  describe("contact allowed", () => {
    const batted = [
      pitch({ pitcherId: 7, launchSpeed: 104.2, bbType: "line_drive" }),
      pitch({ pitcherId: 7, launchSpeed: 95.0, bbType: "fly_ball" }),
      pitch({ pitcherId: 7, launchSpeed: 94.9, bbType: "ground_ball" }),
      pitch({ pitcherId: 7, launchSpeed: 80.0, bbType: "ground_ball" }),
      // in play but unmeasured, and measured without a batted-ball code
      pitch({ pitcherId: 7, bbType: "popup" }),
      pitch({ pitcherId: 7, launchSpeed: 88.0 }),
      // another pitcher's hard contact must not leak in
      pitch({ pitcherId: 8, launchSpeed: 112.0, bbType: "fly_ball" }),
    ];

    it("summarises only measured batted balls for that pitcher", () => {
      const c = summarizePitcher(batted, 7)!.contact!;
      expect(c.measured).toBe(5);
      expect(c.avgExitVelocity).toBeCloseTo((104.2 + 95.0 + 94.9 + 80.0 + 88.0) / 5);
    });

    it("counts the hard-hit line exactly at HARD_HIT_MPH (95) and above", () => {
      const c = summarizePitcher(batted, 7)!.contact!;
      expect(c.hardHitRate).toBeCloseTo(2 / 5);
    });

    it("reports the batted-ball mix over measured balls, largest first", () => {
      const c = summarizePitcher(batted, 7)!.contact!;
      expect(c.mix.map((m) => m.label)).toEqual(["ground ball", "fly ball", "line drive"]);
      expect(c.mix[0]).toMatchObject({ label: "ground ball", count: 2 });
      // the unmeasured popup is not in the mix, so shares cover only measured balls
      expect(c.mix.reduce((a, m) => a + m.share, 0)).toBeCloseTo(4 / 5);
    });

    it("is null when nothing the pitcher threw was measured", () => {
      const s = summarizePitcher([pitch({ pitcherId: 9, isSwing: 1 })], 9)!;
      expect(s.contact).toBeNull();
      expect(s.count).toBe(1);
    });
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
  it("treats the sample as real data: it serves checked-in MLB game-feed pitches", () => {
    expect(isSyntheticSource({ kind: "sample" })).toBe(false);
  });

  it("follows the catalog flag for scenarios", () => {
    expect(isSyntheticSource({ kind: "scenario", synthetic: true })).toBe(true);
    expect(isSyntheticSource({ kind: "scenario", synthetic: false })).toBe(false);
  });

  it("treats a warehouse date partition as real data", () => {
    expect(isSyntheticSource({ kind: "partition", date: "2024-06-16" })).toBe(false);
  });
});
