/** Data-status lib: distinct pitch types, game_date extraction, formatting. */
import { describe, expect, it } from "vitest";
import { tableFromArrays, tableToIPC, type Table } from "apache-arrow";
import { loadPitchTable } from "./arrow-loader";
import { distinctPitchTypes, extractGameDate, formatDataStatus, computeWhiffRate } from "./data-status";
import type { PitchDatum } from "./deck-layers";

describe("distinctPitchTypes", () => {
  it("returns distinct codes ordered by frequency then code", () => {
    const pitches = [
      { pitchType: "FF" }, { pitchType: "SL" }, { pitchType: "FF" },
      { pitchType: "CU" }, { pitchType: "SL" }, { pitchType: "FF" },
    ];
    expect(distinctPitchTypes(pitches)).toEqual(["FF", "SL", "CU"]);
  });

  it("breaks count ties alphabetically for determinism", () => {
    const pitches = [{ pitchType: "SL" }, { pitchType: "FF" }, { pitchType: "CU" }];
    expect(distinctPitchTypes(pitches)).toEqual(["CU", "FF", "SL"]);
  });

  it("drops empty codes and handles empty input", () => {
    expect(distinctPitchTypes([{ pitchType: "" }, { pitchType: "FF" }])).toEqual(["FF"]);
    expect(distinctPitchTypes([])).toEqual([]);
  });
});

describe("extractGameDate", () => {
  function ipc(withDate: boolean, rows: string[]): ArrayBuffer {
    const arrays: Record<string, readonly unknown[]> = withDate
      ? { pitch_type: rows.map(() => "FF"), game_date: rows }
      : { pitch_type: rows.map(() => "FF") };
    return tableToIPC(tableFromArrays(arrays)).buffer as ArrayBuffer;
  }

  it("returns the first game_date value in the table", () => {
    const { table } = loadPitchTable(ipc(true, ["2024-04-01", "2024-04-01"]));
    expect(extractGameDate(table)).toBe("2024-04-01");
  });

  // BigQuery DATE columns reach the client as Arrow date values, not strings.
  const tableWithFirstValue = (v: unknown) =>
    ({ numRows: 1, getChild: () => ({ get: () => v }) }) as unknown as Table;

  it("formats a date given as days since the epoch", () => {
    expect(extractGameDate(tableWithFirstValue(19889))).toBe("2024-06-15");
  });

  it("formats a date given as epoch milliseconds", () => {
    expect(extractGameDate(tableWithFirstValue(19889 * 86400000))).toBe("2024-06-15");
  });

  it("formats a Date object", () => {
    expect(extractGameDate(tableWithFirstValue(new Date("2024-06-15T00:00:00Z")))).toBe("2024-06-15");
  });

  it("returns null for a null first value", () => {
    expect(extractGameDate(tableWithFirstValue(null))).toBeNull();
  });

  it("returns null when the column is missing or empty", () => {
    const missing = loadPitchTable(ipc(false, ["FF"]));
    expect(extractGameDate(missing.table)).toBeNull();
    const empty = loadPitchTable(ipc(true, []));
    expect(extractGameDate(empty.table)).toBeNull();
  });
});

describe("formatDataStatus", () => {
  it("formats row count and game date", () => {
    expect(formatDataStatus(1234, "2024-04-01")).toBe("1,234 rows · 2024-04-01");
  });

  it("omits the date when none is available", () => {
    expect(formatDataStatus(12, null)).toBe("12 rows");
    expect(formatDataStatus(0, null)).toBe("0 rows");
  });

  it("groups thousands with commas", () => {
    expect(formatDataStatus(1000000, "2024-04-01")).toBe("1,000,000 rows · 2024-04-01");
  });
});

describe("computeWhiffRate", () => {
  const dummyPitch = (swing?: number, whiff?: number): PitchDatum => ({
    path: new Float32Array(180),
    releaseSpeed: 95,
    pfxX: 0,
    pfxZ: 0,
    plateX: 0,
    plateZ: 0,
    pitchType: "FF",
    isSwing: swing,
    isWhiff: whiff,
  });

  it("calculates whiff percentage when swings are present", () => {
    const pitches = [
      dummyPitch(1, 1),
      dummyPitch(1, 0),
      dummyPitch(1, 0),
      dummyPitch(1, 0),
    ];
    const res = computeWhiffRate(pitches);
    expect(res.swings).toBe(4);
    expect(res.whiffs).toBe(1);
    expect(res.whiffPct).toBeCloseTo(25.0);
  });

  it("returns null whiffPct when there are zero swings", () => {
    const takesOnly = [dummyPitch(0, 0), dummyPitch(0, 0)];
    expect(computeWhiffRate(takesOnly)).toEqual({
      swings: 0,
      whiffs: 0,
      whiffPct: null,
    });

    expect(computeWhiffRate([])).toEqual({
      swings: 0,
      whiffs: 0,
      whiffPct: null,
    });
  });

  it("handles 100% whiff rate", () => {
    const allWhiffs = [dummyPitch(1, 1), dummyPitch(1, 1)];
    const res = computeWhiffRate(allWhiffs);
    expect(res.swings).toBe(2);
    expect(res.whiffs).toBe(2);
    expect(res.whiffPct).toBeCloseTo(100.0);
  });
});
