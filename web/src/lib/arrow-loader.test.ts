/** Arrow IPC loader tests: byte stream -> PitchTable. */
import { describe, expect, it, vi, afterEach } from "vitest";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import {
  loadPitchTable,
  fetchPitches,
  fetchDatePartitions,
  clearEtagCache,
  getEtag,
  type PitchTable,
} from "./arrow-loader";
import { PLATE_Y } from "./kinematics";

const N = 60;

/** Build an IPC byte buffer with the worker.SCHEMA column set. */
function ipcBuffer(rows: {
  count: number;
  pitchTypes: string[];
  y0?: Float64Array | number[];
  vy0?: Float64Array | number[];
  ay?: Float64Array | number[];
  plateX?: Float64Array | number[];
  plateZ?: Float64Array | number[];
  isSwing?: Int32Array | number[];
  isWhiff?: Int32Array | number[];
  releaseSpinRate?: Float64Array | number[];
  szTop?: Float64Array | number[];
  szBot?: Float64Array | number[];
  /** int64 ids (arrive as bigint) and string ids, as in the real schema. */
  ids?: {
    pitcherId?: bigint[];
    batterId?: bigint[];
    pitcherName?: string[];
    batterName?: string[];
    gameId?: bigint[];
    pitchId?: string[];
    playId?: string[];
  };
}): ArrayBuffer {
  const count = rows.count;
  // Release point ~55.5 ft from the plate front, moving toward it at 120 ft/s.
  const ones = () => new Float64Array(count).fill(1);
  const y0 = rows.y0 ?? new Float64Array(count).fill(55.5);
  const arrays: Record<string, any> = {
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
  };
  if (rows.plateX) arrays.plate_x = new Float64Array(rows.plateX);
  if (rows.plateZ) arrays.plate_z = new Float64Array(rows.plateZ);
  if (rows.isSwing) arrays.is_swing = new Int32Array(rows.isSwing);
  if (rows.isWhiff) arrays.is_whiff = new Int32Array(rows.isWhiff);
  if (rows.releaseSpinRate) arrays.release_spin_rate = new Float64Array(rows.releaseSpinRate);
  if (rows.szTop) arrays.sz_top = new Float64Array(rows.szTop);
  if (rows.szBot) arrays.sz_bot = new Float64Array(rows.szBot);
  if (rows.ids?.pitcherId) arrays.pitcher_id = new BigInt64Array(rows.ids.pitcherId);
  if (rows.ids?.batterId) arrays.batter_id = new BigInt64Array(rows.ids.batterId);
  if (rows.ids?.pitcherName) arrays.pitcher_name = rows.ids.pitcherName;
  if (rows.ids?.batterName) arrays.batter_name = rows.ids.batterName;
  if (rows.ids?.gameId) arrays.game_id = new BigInt64Array(rows.ids.gameId);
  if (rows.ids?.pitchId) arrays.pitch_id = rows.ids.pitchId;
  if (rows.ids?.playId) arrays.play_id = rows.ids.playId;
  return tableToIPC(tableFromArrays(arrays)).buffer as ArrayBuffer;
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

  it("extracts plate_x, plate_z, is_swing, and is_whiff when present", () => {
    const buf = ipcBuffer({
      count: 2,
      pitchTypes: ["FF", "SL"],
      plateX: [0.25, -0.5],
      plateZ: [2.5, 1.8],
      isSwing: [1, 0],
      isWhiff: [1, 0],
    });
    const { pitches } = loadPitchTable(buf);
    expect(pitches).toHaveLength(2);
    expect(pitches[0].plateX).toBeCloseTo(0.25);
    expect(pitches[0].plateZ).toBeCloseTo(2.5);
    expect(pitches[0].pfxX).toBe(pitches[0].plateX);
    expect(pitches[0].pfxZ).toBe(pitches[0].plateZ);
    expect(pitches[0].isSwing).toBe(1);
    expect(pitches[0].isWhiff).toBe(1);

    expect(pitches[1].plateX).toBeCloseTo(-0.5);
    expect(pitches[1].plateZ).toBeCloseTo(1.8);
    expect(pitches[1].pfxX).toBe(pitches[1].plateX);
    expect(pitches[1].pfxZ).toBe(pitches[1].plateZ);
    expect(pitches[1].isSwing).toBe(0);
    expect(pitches[1].isWhiff).toBe(0);
  });

  it("extracts release_spin_rate and derives extension from kinematics y0", () => {
    const buf = ipcBuffer({
      count: 2,
      pitchTypes: ["FF", "SL"],
      y0: [54.5, 55.0],
      releaseSpinRate: [2420, 2680],
    });
    const { pitches } = loadPitchTable(buf);
    expect(pitches).toHaveLength(2);
    expect(pitches[0].spinRate).toBeCloseTo(2420);
    expect(pitches[0].extension).toBeCloseTo(6.0); // 60.5 - 54.5
    expect(pitches[1].spinRate).toBeCloseTo(2680);
    expect(pitches[1].extension).toBeCloseTo(5.5); // 60.5 - 55.0
  });

  it("extracts sz_top and sz_bot when present", () => {
    const buf = ipcBuffer({
      count: 2,
      pitchTypes: ["FF", "SL"],
      szTop: [3.5, 3.2],
      szBot: [1.6, 1.4],
    });
    const { pitches } = loadPitchTable(buf);
    expect(pitches).toHaveLength(2);
    expect(pitches[0].szTop).toBeCloseTo(3.5);
    expect(pitches[0].szBot).toBeCloseTo(1.6);
    expect(pitches[1].szTop).toBeCloseTo(3.2);
    expect(pitches[1].szBot).toBeCloseTo(1.4);
  });

  it("extracts pitcher, batter, game, pitch and play ids; int64 columns become plain numbers", () => {
    const buf = ipcBuffer({
      count: 2,
      pitchTypes: ["FF", "SL"],
      ids: {
        pitcherId: [543037n, 605151n],
        batterId: [500001n, 500002n],
        gameId: [745321n, 745321n],
        pitchId: ["745321_1_1", "745321_1_2"],
        playId: ["7970bd19-d633-4ea1-be2f-2af453d0ec46", "b2f0c6a4-0000-4000-8000-000000000001"],
      },
    });
    const { pitches } = loadPitchTable(buf);
    expect(pitches[0]).toMatchObject({
      pitcherId: 543037,
      batterId: 500001,
      gameId: 745321,
      pitchId: "745321_1_1",
      playId: "7970bd19-d633-4ea1-be2f-2af453d0ec46",
    });
    expect(typeof pitches[1].pitcherId).toBe("number");
    expect(pitches[1].pitcherId).toBe(605151);
  });

  it("extracts optional real-player display names and leaves blank names unset", () => {
    const { pitches } = loadPitchTable(ipcBuffer({
      count: 2,
      pitchTypes: ["FF", "FS"],
      ids: {
        pitcherName: ["Shota Imanaga", "  "],
        batterName: ["Tommy Pham", "Mike Tauchman"],
      },
    }));
    expect(pitches[0]).toMatchObject({ pitcherName: "Shota Imanaga", batterName: "Tommy Pham" });
    expect(pitches[1].pitcherName).toBeUndefined();
    expect(pitches[1].batterName).toBe("Mike Tauchman");
  });

  it("leaves the id fields undefined when the columns are absent", () => {
    const { pitches } = loadPitchTable(ipcBuffer({ count: 1, pitchTypes: ["FF"] }));
    expect(pitches[0].pitcherId).toBeUndefined();
    expect(pitches[0].gameId).toBeUndefined();
    expect(pitches[0].playId).toBeUndefined();
  });

  it("falls back to terminal path coordinates when plate_x/plate_z are absent", () => {
    const buf = ipcBuffer({ count: 1, pitchTypes: ["FF"] });
    const { pitches } = loadPitchTable(buf);
    expect(pitches).toHaveLength(1);
    const p = pitches[0];
    const termX = p.path[(N - 1) * 3];
    const termZ = p.path[(N - 1) * 3 + 2];
    expect(p.plateX).toBe(termX);
    expect(p.plateZ).toBe(termZ);
    expect(p.pfxX).toBe(termX);
    expect(p.pfxZ).toBe(termZ);
    expect(p.isSwing).toBeUndefined();
    expect(p.isWhiff).toBeUndefined();
  });

  it("computes commitmentPoint at y = 23.8 ft when kinematics are parsed", () => {
    const buf = ipcBuffer({ count: 1, pitchTypes: ["FF"] });
    const { pitches } = loadPitchTable(buf);
    expect(pitches).toHaveLength(1);
    const cp = pitches[0].commitmentPoint;
    expect(cp).toBeDefined();
    expect(cp![1]).toBeCloseTo(23.8, 5);
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

describe("fetchDatePartitions", () => {
  it("returns partition list on 200 response", async () => {
    const partitions = [
      { game_date: "2026-09-14", rows: 350 },
      { game_date: "2026-09-13", rows: 420 },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(partitions), { status: 200 })),
    );
    const result = await fetchDatePartitions();
    expect(result).toEqual(partitions);
    expect(fetch).toHaveBeenCalledWith("/pitches/dates");
  });

  it("returns default partition on 503 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Service Unavailable", { status: 503 })),
    );
    const result = await fetchDatePartitions();
    expect(result).toEqual([{ game_date: "2026-09-14", rows: 300 }]);
  });

  it("returns default partition on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Network offline");
      }),
    );
    const result = await fetchDatePartitions();
    expect(result).toEqual([{ game_date: "2026-09-14", rows: 300 }]);
  });
});
