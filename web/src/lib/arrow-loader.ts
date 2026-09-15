/** Arrow IPC loader: byte stream -> columnar table -> per-pitch GPU data. */
import { tableFromIPC } from "apache-arrow";
import { trajectoryFlat, type PitchKinematics } from "./kinematics";
import type { PitchDatum } from "./deck-layers";

export interface PitchTable {
  table: ReturnType<typeof tableFromIPC>;
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

export async function fetchPitches(url: string): Promise<PitchTable> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return loadPitchTable(await res.arrayBuffer());
}
