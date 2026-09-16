/** Data-status lib: distinct pitch types, game_date extraction, formatting. */
import { describe, expect, it } from "vitest";
import { tableFromArrays, tableToIPC } from "apache-arrow";
import { loadPitchTable } from "./arrow-loader";
import { distinctPitchTypes, extractGameDate, formatDataStatus } from "./data-status";

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
