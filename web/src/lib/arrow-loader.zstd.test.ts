/** zstd-compressed IPC (what serving/app.py and the static export now write). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadPitchTable } from "./arrow-loader";

// Written by ingestion.scenarios.ipc_write_options() from data/scenarios/freeman-walk-off.arrow.
const fixture = readFileSync(new URL("./__fixtures__/freeman-walk-off.zstd.arrow", import.meta.url));

describe("loadPitchTable with zstd IPC bodies", () => {
  it("decodes every pitch through the registered codec", () => {
    const buf = fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength);
    const { table, pitches } = loadPitchTable(buf);
    expect(table.numRows).toBe(13);
    expect(pitches).toHaveLength(13);
    expect(pitches[0].pitchId).toBe("b2c83bbd-2022-4802-a1ba-d69fcd8c7aca");
    expect(pitches[0].releaseSpeed).toBeCloseTo(96.6, 5);
    expect(pitches.every((p) => p.path.length === 180)).toBe(true);
  });
});
