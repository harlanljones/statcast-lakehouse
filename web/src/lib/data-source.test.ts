/** Tests: /pitches/dates availability fetch — validation, dedupe, error behavior. */
import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchAvailableDates } from "./data-source";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => vi.unstubAllGlobals());

describe("fetchAvailableDates", () => {
  it("fetches /pitches/dates and returns the date list", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(["2024-04-01", "2024-04-02"]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const dates = await fetchAvailableDates();
    expect(fetchMock).toHaveBeenCalledWith("/pitches/dates");
    expect(dates).toEqual(["2024-04-01", "2024-04-02"]);
  });

  it("sorts and deduplicates entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(["2024-04-05", "2024-04-01", "2024-04-05"])),
    );
    expect(await fetchAvailableDates()).toEqual(["2024-04-01", "2024-04-05"]);
  });

  it("filters entries that are not YYYY-MM-DD", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(["2024-04-01", "not-a-date", "", "2024-13-40", 42]),
      ),
    );
    expect(await fetchAvailableDates()).toEqual(["2024-04-01"]);
  });

  it("returns [] on non-200 responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    expect(await fetchAvailableDates()).toEqual([]);
  });

  it("honors a custom baseUrl", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(["2024-04-01"]));
    vi.stubGlobal("fetch", fetchMock);
    await fetchAvailableDates("/api/pitches");
    expect(fetchMock).toHaveBeenCalledWith("/api/pitches/dates");
  });
});
