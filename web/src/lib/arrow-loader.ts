/** Arrow IPC loader: byte stream -> columnar table -> per-pitch GPU data. */
import { tableFromIPC, compressionRegistry, CompressionType, type Table } from "apache-arrow";
import { decompress as zstdDecompress } from "fzstd";
import {
  trajectoryFlat,
  computeBreakVector,
  releaseExtension,
  commitmentPosition,
  type PitchKinematics,
} from "./kinematics";
import type { PitchDatum } from "./deck-layers";
export type { PitchDatum } from "./deck-layers";

export interface PitchTable {
  table: Table;
  pitches: PitchDatum[];
}

export interface DatePartition {
  game_date: string;
  rows: number;
}

// The server and export_batch.py write zstd-compressed IPC bodies; arrow-js
// decodes them only with a registered codec (decode-only is all we need).
// fzstd can return a view at an unaligned offset, and arrow-js builds
// BigInt64Array/Float64Array views straight onto it, so realign when needed.
compressionRegistry.set(CompressionType.ZSTD, {
  decode: (bytes) => {
    const out = zstdDecompress(bytes);
    return out.byteOffset % 8 === 0 ? out : out.slice();
  },
});

/** Arrow int64 ids arrive as bigint; the UI only needs plain numbers (MLB ids are far below 2^53). */
function idNumber(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function idString(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v);
  return s === "" ? undefined : s;
}

/** Nullable Arrow UTF-8 fields arrive as strings; omit empty display names. */
function displayName(v: unknown): string | undefined {
  if (v == null) return undefined;
  const name = String(v).trim();
  return name === "" ? undefined : name;
}

function sourcePlayId(explicitPlayId: unknown, pitchId: unknown): string | undefined {
  const explicit = idString(explicitPlayId);
  if (explicit) return explicit;
  const id = idString(pitchId);
  return id && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ? id : undefined;
}

/**
 * Parse an Arrow IPC response and precompute GPU-ready paths.
 * Column access is zero-copy typed arrays; trajectory math runs once per
 * pitch at load time, never during interaction.
 */
export function loadPitchTable(buffer: ArrayBuffer): PitchTable {
  const table = tableFromIPC(buffer);
  const col = (name: string) => table.getChild(name)?.toArray() ?? [];
  const x0 = col("x0"), y0 = col("y0"), z0 = col("z0");
  const vx0 = col("vx0"), vy0 = col("vy0"), vz0 = col("vz0");
  const ax = col("ax"), ay = col("ay"), az = col("az");
  const speed = col("release_speed");

  const plateXCol = table.getChild("plate_x");
  const plateZCol = table.getChild("plate_z");
  const isSwingCol = table.getChild("is_swing");
  const isWhiffCol = table.getChild("is_whiff");
  const spinCol = table.getChild("release_spin_rate");
  const szTopCol = table.getChild("sz_top");
  const szBotCol = table.getChild("sz_bot");
  const pitcherCol = table.getChild("pitcher_id");
  const batterCol = table.getChild("batter_id");
  const pitcherNameCol = table.getChild("pitcher_name");
  const batterNameCol = table.getChild("batter_name");
  const gameCol = table.getChild("game_id");
  const pitchIdCol = table.getChild("pitch_id");
  const playIdCol = table.getChild("play_id");

  const pitches: PitchDatum[] = [];
  for (let i = 0; i < table.numRows; i++) {
    const k: PitchKinematics = {
      x0: x0[i], y0: y0[i], z0: z0[i],
      vx0: vx0[i], vy0: vy0[i], vz0: vz0[i],
      ax: ax[i], ay: ay[i], az: az[i],
    };
    let path: Float32Array;
    try {
      path = trajectoryFlat(k);
    } catch {
      continue; // degenerate row (never reaches plate) — drop, don't crash
    }

    const N = path.length / 3;
    const fallbackX = path[(N - 1) * 3];
    const fallbackZ = path[(N - 1) * 3 + 2];

    const rawPlateX = plateXCol?.get(i);
    const rawPlateZ = plateZCol?.get(i);
    const plateX = rawPlateX != null && !isNaN(Number(rawPlateX)) ? Number(rawPlateX) : fallbackX;
    const plateZ = rawPlateZ != null && !isNaN(Number(rawPlateZ)) ? Number(rawPlateZ) : fallbackZ;

    const rawSwing = isSwingCol?.get(i);
    const rawWhiff = isWhiffCol?.get(i);
    const isSwing = rawSwing != null ? Number(rawSwing) : undefined;
    const isWhiff = rawWhiff != null ? Number(rawWhiff) : undefined;

    const rawSpin = spinCol?.get(i);
    const spinRate = rawSpin != null && !isNaN(Number(rawSpin)) ? Number(rawSpin) : undefined;
    const extension = releaseExtension(k.y0);

    const rawSzTop = szTopCol?.get(i);
    const rawSzBot = szBotCol?.get(i);
    const szTop = rawSzTop != null && !isNaN(Number(rawSzTop)) ? Number(rawSzTop) : undefined;
    const szBot = rawSzBot != null && !isNaN(Number(rawSzBot)) ? Number(rawSzBot) : undefined;

    pitches.push({
      pitcherId: idNumber(pitcherCol?.get(i)),
      batterId: idNumber(batterCol?.get(i)),
      pitcherName: displayName(pitcherNameCol?.get(i)),
      batterName: displayName(batterNameCol?.get(i)),
      gameId: idNumber(gameCol?.get(i)),
      pitchId: idString(pitchIdCol?.get(i)),
      playId: sourcePlayId(playIdCol?.get(i), pitchIdCol?.get(i)),
      path,
      releaseSpeed: speed[i],
      spinRate,
      extension,
      szTop,
      szBot,
      plateX,
      plateZ,
      pfxX: plateX,
      pfxZ: plateZ,
      pitchType: String(table.getChild("pitch_type")?.get(i) ?? ""),
      isSwing,
      isWhiff,
      kinematics: k,
      breakVector: computeBreakVector(k),
      commitmentPoint: commitmentPosition(k),
    });
  }
  return { table, pitches };
}

/**
 * ETag cache for conditional revalidation: url -> { etag, parsed }.
 *
 * Design choice (304 seam): the cache stores the fully parsed PitchTable,
 * not the raw bytes. On a 304 we return the cached table by identity,
 * skipping IPC decoding, tableFromIPC, and all trajectory math — strictly
 * cheaper than caching bytes and re-parsing. Raw bytes are never needed
 * downstream (callers consume PitchTable only).
 *
 * Cache-Control is intentionally NOT read or honored client-side: expiry/
 * freshness is a server/CDN concern. The client revalidates with
 * If-None-Match on every load and lets the server decide 200 vs 304.
 */
const etagCache = new Map<string, { etag: string; parsed: PitchTable }>();

/** Cached ETag for a URL, or undefined. Test/inspection helper. */
export function getEtag(url: string): string | undefined {
  return etagCache.get(url)?.etag;
}

/** Clear the ETag cache (test isolation). */
export function clearEtagCache(): void {
  etagCache.clear();
}

export async function fetchPitches(url: string): Promise<PitchTable> {
  const cached = etagCache.get(url);
  const res = cached
    ? await fetch(url, { headers: { "If-None-Match": cached.etag } })
    : await fetch(url);
  if (res.status === 304 && cached) {
    return cached.parsed;
  }
  if (res.status === 304) {
    // 304 without a local cache entry: server/proxy mismatch.
    throw new Error(`fetch ${url}: 304 without cached ETag`);
  }
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const parsed = loadPitchTable(await res.arrayBuffer());
  const etag = res.headers.get("ETag");
  if (etag) etagCache.set(url, { etag, parsed });
  else etagCache.delete(url); // keep the cache honest: no ETag, no entry
  return parsed;
}

/**
 * Fetch available date partitions from /pitches/dates.
 * Returns default [{ game_date: "2026-09-14", rows: 300 }] if 503 or network error.
 */
export async function fetchDatePartitions(): Promise<DatePartition[]> {
  try {
    const res = await fetch("/pitches/dates");
    if (!res.ok) {
      return [{ game_date: "2026-09-14", rows: 300 }];
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [{ game_date: "2026-09-14", rows: 300 }];
  } catch {
    return [{ game_date: "2026-09-14", rows: 300 }];
  }
}
