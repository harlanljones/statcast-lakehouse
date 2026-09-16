/** Arrow IPC loader tests: byte stream -> PitchTable. */
import { describe, expect, it, vi, afterEach } from "vitest";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { loadPitchTable, fetchPitches, clearEtagCache, getEtag, type PitchTable } from "./arrow-loader";
import { PLATE_Y } from "./kinematics";

const N = 60;

/** Build an IPC byte buffer with the worker.SCHEMA column set. */
function ipcBuffer(rows: {
  count: number;
  pitchTypes: string[];
  y0?: Float64Array | number[];
  vy0?: Float64Array | number[];
  ay?: Float64Array | number[];
}): ArrayBuffer {
  const count = rows.count;
  // Release point ~55.5 ft from the plate front, moving toward it at 120 ft/s.
  const ones = () => new Float64Array(count).fill(1);
  const y0 = rows.y0 ?? new Float64Array(count).fill(55.5);
  return tableToIPC(
    tableFromArrays({
      x0: ones(),
      y0: y0 as Float64Array,
      z0: ones(),
      vx0: ones(),
      vy0: (rows.vy0 ?? new Float64Array(count).fill(-120)) as Float64Array,
      vz0: ones(),
      ax: ones(),
      ay: (rows.ay ?? ones()) as Float64Array,
      az: ones(),
      release_speed: new Float32Array(count).fill(94.5),
      pitch_type: rows.pitchTypes,
    }),
  ).buffer as ArrayBuffer;
}

afterEach(() => vi.unstubAllGlobals());

describe("loadPitchTable", () => {
  it("parses a valid IPC table into GPU-ready pitches", () => {
    const buf = ipcBuffer({ count: 2, pitchTypes: ["FF", "SL"] });
    const { table, pitches } = loadPitchTable(buf);

    expect(table.numRows).toBe(2);
    expect(pitches).toHaveLength(2);
    for (const p of pitches) {
      expect(p.path).toBeInstanceOf(Float32Array);
      expect(p.path.length).toBe(N * 3);
      expect(p.releaseSpeed).toBeCloseTo(94.5);
    }
    expect(pitches[0].pitchType).toBe("FF");
    expect(pitches[1].pitchType).toBe("SL");
    // Path ends at the plate plane (y = 0 in flat coords; front face is PLATE_Y).
    const last = pitches[0].path.subarray((N - 1) * 3);
    expect(last[1]).toBeLessThan(pitches[0].path[1]);
  });

  it("drops degenerate pitches that never reach the plate plane", () => {
    // y0 == PLATE_Y with zero y-velocity and zero y-accel: no future crossing.
    const buf = ipcBuffer({
      count: 2,
      pitchTypes: ["FF", "CU"],
      y0: [PLATE_Y, 55],
      vy0: [0, -120],
      ay: [0, 1],
    });
    const { pitches } = loadPitchTable(buf);
    expect(pitches).toHaveLength(1);
    expect(pitches[0].pitchType).toBe("CU");
  });

  it("handles an empty table", () => {
    const buf = ipcBuffer({ count: 0, pitchTypes: [] });
    const { table, pitches } = loadPitchTable(buf);
    expect(table.numRows).toBe(0);
    expect(pitches).toEqual([]);
  });
});

describe("fetchPitches", () => {
  it("parses a successful Arrow response", async () => {
    const buf = ipcBuffer({ count: 1, pitchTypes: ["CH"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(buf, { status: 200 })),
    );
    const t: PitchTable = await fetchPitches("/pitches/sample");
    expect(t.pitches).toHaveLength(1);
    expect(t.pitches[0].pitchType).toBe("CH");
    expect(fetch).toHaveBeenCalledWith("/pitches/sample");
  });

  it("propagates HTTP error statuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    await expect(fetchPitches("/pitches/missing")).rejects.toThrow(/404/);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );
    await expect(fetchPitches("/pitches/broken")).rejects.toThrow(/500/);
  });

  it("first load stores ETag and sends no If-None-Match", async () => {
    clearEtagCache();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(ipcBuffer({ count: 1, pitchTypes: ["FF"] }), {
        status: 200,
        headers: { ETag: '"abc123"' },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await fetchPitches("/pitches/sample");
    expect(fetchMock).toHaveBeenCalledWith("/pitches/sample");
    expect(getEtag("/pitches/sample")).toBe('"abc123"');
  });

  it("second load sends If-None-Match; 304 reuses cached table without re-parsing", async () => {
    clearEtagCache();
    const buf = ipcBuffer({ count: 2, pitchTypes: ["FF", "SL"] });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(buf, { status: 200, headers: { ETag: '"e1"' } }),
      )
      .mockResolvedValue(
        new Response(null, { status: 304, headers: { ETag: '"e1"' } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const first = await fetchPitches("/pitches/sample");
    const second = await fetchPitches("/pitches/sample");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/pitches/sample", {
      headers: { "If-None-Match": '"e1"' },
    });
    // Cached parsed table returned by identity — no re-parse, no re-decode.
    expect(second).toBe(first);
    expect(second.pitches).toHaveLength(2);
  });

  it("second load 200 with a new ETag updates the cache", async () => {
    clearEtagCache();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(ipcBuffer({ count: 1, pitchTypes: ["FF"] }), {
          status: 200,
          headers: { ETag: '"old"' },
        }),
      )
      .mockResolvedValue(
        new Response(ipcBuffer({ count: 3, pitchTypes: ["FF", "SL", "CH"] }), {
          status: 200,
          headers: { ETag: '"new"' },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await fetchPitches("/pitches/sample");
    const again = await fetchPitches("/pitches/sample");
    expect(getEtag("/pitches/sample")).toBe('"new"');
    expect(again.pitches).toHaveLength(3);
  });

  it("different URL sends no If-None-Match", async () => {
    clearEtagCache();
    const fetchMock = vi.fn(async (url: string) =>
      new Response(ipcBuffer({ count: 1, pitchTypes: ["CU"] }), {
        status: 200,
        headers: { ETag: '"u1"' },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await fetchPitches("/pitches?date=2024-04-01");
    await fetchPitches("/pitches?date=2024-04-02");
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/pitches?date=2024-04-01");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/pitches?date=2024-04-02");
    expect(getEtag("/pitches?date=2024-04-02")).toBe('"u1"');
  });
});
