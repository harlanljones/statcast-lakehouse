/** Arrow IPC loader tests: byte stream -> PitchTable. */
import { describe, expect, it, vi, afterEach } from "vitest";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { loadPitchTable, fetchPitches, type PitchTable } from "./arrow-loader";
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
});
