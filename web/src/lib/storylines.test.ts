import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPitcherStorylines, isStorylineActiveOn, storylinesForPitcher, type PitcherStoryline } from "./storylines";

const story: PitcherStoryline = {
  playerId: 694973,
  playerName: "Paul Skenes",
  startDate: "2024-05-11",
  endDate: "2024-05-11",
  eventDate: "2024-05-11",
  storylineType: "debut",
  title: "Skenes debuts",
  summary: "The rookie made his Major League debut.",
  sourceUrl: "https://www.mlb.com/news/paul-skenes-debut",
};

afterEach(() => vi.unstubAllGlobals());

describe("fetchPitcherStorylines", () => {
  it("requests the date-scoped endpoint and normalizes snake-case fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{
      player_id: 694973,
      player_name: "Paul Skenes",
      start_date: "2024-05-11",
      end_date: "2024-05-11",
      event_date: "2024-05-11",
      storyline_type: "debut",
      title: "Skenes debuts",
      summary: "The rookie made his Major League debut.",
      source_url: "https://www.mlb.com/news/paul-skenes-debut",
    }]), { status: 200 })));

    await expect(fetchPitcherStorylines("2024-05-11")).resolves.toEqual([story]);
    expect(fetch).toHaveBeenCalledWith("/pitches/storylines?date=2024-05-11");
  });

  it("rejects malformed payloads instead of presenting untrusted metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    await expect(fetchPitcherStorylines("2024-05-11")).rejects.toThrow(/invalid storylines response/i);
  });
});

describe("storylinesForPitcher", () => {
  it("keeps only active pitcher stories for the pinned pitcher", () => {
    const irrelevant: PitcherStoryline = { ...story, playerId: 1 };
    expect(storylinesForPitcher([story, irrelevant], 694973, "2024-05-11")).toEqual([story]);
    expect(storylinesForPitcher([story], 694973, "2024-05-12")).toEqual([]);
    expect(isStorylineActiveOn(story, "2024-05-11")).toBe(true);
  });
});
