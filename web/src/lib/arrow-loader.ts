/** Arrow IPC loader: byte stream -> columnar table -> per-pitch GPU data. */
import { tableFromIPC, type Table } from "apache-arrow";
import { trajectoryFlat, type PitchKinematics } from "./kinematics";
import type { PitchDatum } from "./deck-layers";

export interface PitchTable {
  table: Table;
  pitches: PitchDatum[];
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
    pitches.push({
      path,
      releaseSpeed: speed[i],
      pfxX: 0, // filled from query result when present
      pfxZ: 0,
      pitchType: String(table.getChild("pitch_type")?.get(i) ?? ""),
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
