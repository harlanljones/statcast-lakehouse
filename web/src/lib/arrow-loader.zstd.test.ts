/** zstd-compressed IPC (what serving/app.py and the static export now write). */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureZstdDecoder,
  loadPitchTable,
  resetZstdDecoder,
  zstdDecoderActive,
  type ZstdCodec,
} from "./arrow-loader";

// Written by ingestion.scenarios.ipc_write_options() from data/scenarios/freeman-walk-off.arrow.
const fixture = readFileSync(new URL("./__fixtures__/freeman-walk-off.zstd.arrow", import.meta.url));

function body(): ArrayBuffer {
  return fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength) as ArrayBuffer;
}

beforeEach(() => resetZstdDecoder());
afterEach(() => resetZstdDecoder());

describe("loadPitchTable with zstd IPC bodies", () => {
  it("decodes every pitch through the registered codec", () => {
    const { table, pitches } = loadPitchTable(body());
    expect(table.numRows).toBe(13);
    expect(pitches).toHaveLength(13);
    expect(pitches[0].pitchId).toBe("b2c83bbd-2022-4802-a1ba-d69fcd8c7aca");
    expect(pitches[0].releaseSpeed).toBeCloseTo(96.6, 5);
    expect(pitches.every((p) => p.path.length === 180)).toBe(true);
  });
});

describe("WASM zstd decoder", () => {
  it("is installed by ensureZstdDecoder and decodes the same table", async () => {
    expect(zstdDecoderActive()).toBe(false);
    const before = loadPitchTable(body());

    expect(await ensureZstdDecoder()).toBe(true);
    expect(zstdDecoderActive()).toBe(true);

    const after = loadPitchTable(body());
    expect(after.table.numRows).toBe(before.table.numRows);
    expect(after.pitches.map((p) => p.pitchId)).toEqual(before.pitches.map((p) => p.pitchId));
    expect(after.pitches.map((p) => [p.path[0], p.path[177], p.breakVector?.vBreakInches])).toEqual(
      before.pitches.map((p) => [p.path[0], p.path[177], p.breakVector?.vBreakInches])
    );
  });

  it("shares one init between concurrent callers", async () => {
    let builds = 0;
    const factory = async (): Promise<ZstdCodec> => {
      builds++;
      return { decode: (bytes) => bytes };
    };
    expect(await Promise.all([ensureZstdDecoder(factory), ensureZstdDecoder(factory)])).toEqual([true, true]);
    expect(builds).toBe(1);
  });

  it("keeps the pure-JS codec when the WASM decoder cannot be built", async () => {
    expect(
      await ensureZstdDecoder(async () => {
        throw new Error("wasm unavailable");
      })
    ).toBe(false);
    expect(zstdDecoderActive()).toBe(false);
    expect(loadPitchTable(body()).pitches).toHaveLength(13);
  });
});
