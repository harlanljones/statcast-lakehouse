/** Arrow IPC loader: byte stream -> columnar table -> per-pitch GPU data. */
import { tableFromIPC, compressionRegistry, CompressionType, type Table } from "apache-arrow";
import { decompress as zstdDecompress } from "fzstd";
import {
  trajectoryFlat,
  computeBreakVector,
  extrapolateToRelease,
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

/** Row accessor over one Arrow column, or null when the column is absent. */
type Getter = (i: number) => unknown;

/**
 * Hoisted per-column accessor. A column with no nulls and a typed-array
 * representation is read straight from `toArray()` (zero-copy for a single
 * chunk); anything else (nullable columns, strings, int64) goes through the
 * Vector's `get`, because `toArray()` would silently turn NULLs into 0/NaN.
 */
function columnGetter(table: Table, name: string): Getter | null {
  const vec = table.getChild(name);
  if (!vec) return null;
  if (vec.nullCount === 0) {
    const arr = vec.toArray();
    if (ArrayBuffer.isView(arr) && !(arr instanceof DataView)) {
      const typed = arr as unknown as ArrayLike<unknown>;
      return (i) => typed[i];
    }
  }
  return (i) => vec.get(i);
}

/** Finite number or undefined (NULL, NaN and non-numeric all read as missing). */
function finiteOrUndefined(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse an Arrow IPC response and precompute GPU-ready paths.
 * Column access is hoisted out of the row loop (typed arrays where the column
 * has no nulls); trajectory math runs once per pitch at load time, never
 * during interaction.
 *
 * Statcast's x0/y0/z0 sit on the y = 50 ft plane, not at the hand. When the
 * optional nullable `extension` column (ft) is present the nine parameters are
 * moved back to the true release point before any path/break/commitment math.
 */
export function loadPitchTable(buffer: ArrayBuffer): PitchTable {
  const table = tableFromIPC(buffer);
  const col = (name: string) => table.getChild(name)?.toArray() ?? [];
  const x0 = col("x0"), y0 = col("y0"), z0 = col("z0");
  const vx0 = col("vx0"), vy0 = col("vy0"), vz0 = col("vz0");
  const ax = col("ax"), ay = col("ay"), az = col("az");
  const speed = col("release_speed");

  const plateX = columnGetter(table, "plate_x");
  const plateZ = columnGetter(table, "plate_z");
  const isSwing = columnGetter(table, "is_swing");
  const isWhiff = columnGetter(table, "is_whiff");
  const spin = columnGetter(table, "release_spin_rate");
  const szTop = columnGetter(table, "sz_top");
  const szBot = columnGetter(table, "sz_bot");
  const extension = columnGetter(table, "extension");
  const atBat = columnGetter(table, "at_bat_number");
  const pitchNum = columnGetter(table, "pitch_number");
  const pitcherId = columnGetter(table, "pitcher_id");
  const batterId = columnGetter(table, "batter_id");
  const pitcherName = columnGetter(table, "pitcher_name");
  const batterName = columnGetter(table, "batter_name");
  const gameId = columnGetter(table, "game_id");
  const pitchId = columnGetter(table, "pitch_id");
  const playId = columnGetter(table, "play_id");
  const pitchType = columnGetter(table, "pitch_type");

  const pitches: PitchDatum[] = [];
  const n = table.numRows;
  for (let i = 0; i < n; i++) {
    const ext = extension ? finiteOrUndefined(extension(i)) : undefined;
    const measured: PitchKinematics = {
      x0: x0[i], y0: y0[i], z0: z0[i],
      vx0: vx0[i], vy0: vy0[i], vz0: vz0[i],
      ax: ax[i], ay: ay[i], az: az[i],
    };
    const k = extrapolateToRelease(measured, ext);
    let path: Float32Array;
    try {
      path = trajectoryFlat(k);
    } catch {
      continue; // degenerate row (never reaches plate) — drop, don't crash
    }

    const N = path.length / 3;
    const fallbackX = path[(N - 1) * 3];
    const fallbackZ = path[(N - 1) * 3 + 2];

    const px = plateX ? finiteOrUndefined(plateX(i)) ?? fallbackX : fallbackX;
    const pz = plateZ ? finiteOrUndefined(plateZ(i)) ?? fallbackZ : fallbackZ;

    const rawSwing = isSwing?.(i);
    const rawWhiff = isWhiff?.(i);

    pitches.push({
      pitcherId: idNumber(pitcherId?.(i)),
      batterId: idNumber(batterId?.(i)),
      pitcherName: displayName(pitcherName?.(i)),
      batterName: displayName(batterName?.(i)),
      gameId: idNumber(gameId?.(i)),
      pitchId: idString(pitchId?.(i)),
      playId: sourcePlayId(playId?.(i), pitchId?.(i)),
      atBatNumber: idNumber(atBat?.(i)),
      pitchNumber: idNumber(pitchNum?.(i)),
      path,
      releaseSpeed: speed[i],
      spinRate: spin ? finiteOrUndefined(spin(i)) : undefined,
      extension: ext,
      szTop: szTop ? finiteOrUndefined(szTop(i)) : undefined,
      szBot: szBot ? finiteOrUndefined(szBot(i)) : undefined,
      plateX: px,
      plateZ: pz,
      pfxX: px,
      pfxZ: pz,
      pitchType: String(pitchType?.(i) ?? ""),
      isSwing: rawSwing != null ? Number(rawSwing) : undefined,
      isWhiff: rawWhiff != null ? Number(rawWhiff) : undefined,
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
 * Returns [] on any error or non-array body: never a fabricated partition.
 */
export async function fetchDatePartitions(): Promise<DatePartition[]> {
  try {
    const res = await fetch("/pitches/dates");
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
