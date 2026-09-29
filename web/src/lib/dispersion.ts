/**
 * 3D Release Point Dispersion & Pitcher Fatigue Degradation (Sprint 11).
 *
 * Implements 3D spatial covariance matrix and 1-sigma / 2-sigma confidence
 * wireframe ellipsoids, along with pitch-count degradation bucketing.
 *
 * All formulas must remain numerically identical to ingestion/worker.py.
 */

import type { PitchDatum } from "./deck-layers";

export interface ReleaseDispersion {
  count: number;
  meanX: number;
  meanY: number;
  meanZ: number;
  stdX: number;
  stdY: number;
  stdZ: number;
  covXY: number;
  covXZ: number;
  covYZ: number;
  volumeCuFt: number;
  wireframeSegments: Array<Array<[number, number, number]>>;
}

export interface FatigueBucket {
  bucketIndex: number;
  pitchCountStart: number;
  pitchCountEnd: number;
  pitchCount: number;
  avgReleaseSpeed: number;
  avgReleaseZ: number;
  avgReleaseX: number;
  /** Mean of the pitches' reported extension (ft); null when none report it. */
  avgExtension: number | null;
  whiffPct: number;
  deltaVelocityMph: number;
  deltaReleaseZInches: number;
  deltaExtensionInches: number | null;
}

/**
 * Generate wireframe segments for a 3D dispersion ellipsoid.
 * Includes equator (XY), 2 meridians (XZ, YZ), and upper/lower latitude parallels.
 */
export function generateEllipsoidWireframe(
  center: [number, number, number],
  radii: [number, number, number],
  nSegments = 24
): Array<Array<[number, number, number]>> {
  const [cx, cy, cz] = center;
  const [rx, ry, rz] = radii;
  const segments: Array<Array<[number, number, number]>> = [];

  if (rx <= 0 || ry <= 0 || rz <= 0) {
    return segments;
  }

  // 1. Equator in XY plane at z = cz
  const xyLoop: Array<[number, number, number]> = [];
  for (let i = 0; i <= nSegments; i++) {
    const angle = (2.0 * Math.PI * i) / nSegments;
    xyLoop.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle), cz]);
  }
  segments.push(xyLoop);

  // 2. Meridian in XZ plane at y = cy
  const xzLoop: Array<[number, number, number]> = [];
  for (let i = 0; i <= nSegments; i++) {
    const angle = (2.0 * Math.PI * i) / nSegments;
    xzLoop.push([cx + rx * Math.cos(angle), cy, cz + rz * Math.sin(angle)]);
  }
  segments.push(xzLoop);

  // 3. Meridian in YZ plane at x = cx
  const yzLoop: Array<[number, number, number]> = [];
  for (let i = 0; i <= nSegments; i++) {
    const angle = (2.0 * Math.PI * i) / nSegments;
    yzLoop.push([cx, cy + ry * Math.cos(angle), cz + rz * Math.sin(angle)]);
  }
  segments.push(yzLoop);

  // 4. Upper and lower parallel latitude rings at z = cz +/- 0.5 * rz
  for (const sign of [-0.5, 0.5]) {
    const latZ = cz + sign * rz;
    const scale = Math.sqrt(Math.max(0.0, 1.0 - sign * sign));
    const latLoop: Array<[number, number, number]> = [];
    for (let i = 0; i <= nSegments; i++) {
      const angle = (2.0 * Math.PI * i) / nSegments;
      latLoop.push([
        cx + rx * scale * Math.cos(angle),
        cy + ry * scale * Math.sin(angle),
        latZ,
      ]);
    }
    segments.push(latLoop);
  }

  return segments;
}

/**
 * Compute 3D release point covariance, standard deviations, and dispersion ellipsoid.
 */
export function computeReleaseDispersion(
  pitches: PitchDatum[],
  kSigma = 1.0
): ReleaseDispersion {
  const valid = pitches.filter((p) => p.kinematics != null);
  const n = valid.length;

  if (n < 2) {
    return {
      count: n,
      meanX: 0.0,
      meanY: 0.0,
      meanZ: 0.0,
      stdX: 0.0,
      stdY: 0.0,
      stdZ: 0.0,
      covXY: 0.0,
      covXZ: 0.0,
      covYZ: 0.0,
      volumeCuFt: 0.0,
      wireframeSegments: [],
    };
  }

  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;

  for (const p of valid) {
    const k = p.kinematics!;
    sumX += k.x0;
    sumY += k.y0;
    sumZ += k.z0;
  }

  const mx = sumX / n;
  const my = sumY / n;
  const mz = sumZ / n;

  let varX = 0;
  let varY = 0;
  let varZ = 0;
  let covXY = 0;
  let covXZ = 0;
  let covYZ = 0;

  for (const p of valid) {
    const k = p.kinematics!;
    const dx = k.x0 - mx;
    const dy = k.y0 - my;
    const dz = k.z0 - mz;
    varX += dx * dx;
    varY += dy * dy;
    varZ += dz * dz;
    covXY += dx * dy;
    covXZ += dx * dz;
    covYZ += dy * dz;
  }

  varX /= n - 1;
  varY /= n - 1;
  varZ /= n - 1;
  covXY /= n - 1;
  covXZ /= n - 1;
  covYZ /= n - 1;

  const stdX = Math.sqrt(varX);
  const stdY = Math.sqrt(varY);
  const stdZ = Math.sqrt(varZ);

  const radii: [number, number, number] = [
    kSigma * stdX,
    kSigma * stdY,
    kSigma * stdZ,
  ];
  const volume = (4.0 / 3.0) * Math.PI * radii[0] * radii[1] * radii[2];
  const wireframe = generateEllipsoidWireframe([mx, my, mz], radii);

  return {
    count: n,
    meanX: mx,
    meanY: my,
    meanZ: mz,
    stdX,
    stdY,
    stdZ,
    covXY,
    covXZ,
    covYZ,
    volumeCuFt: volume,
    wireframeSegments: wireframe,
  };
}

/**
 * The pitcher a fatigue analysis is about: the pinned pitch's pitcher when
 * given, else the pitcher who threw the most pitches (ties: lowest id), else
 * undefined when the data carries no pitcher ids.
 */
export function fatiguePitcher(
  pitches: readonly PitchDatum[],
  pinnedPitcherId?: number | null,
): number | undefined {
  if (pinnedPitcherId != null) return pinnedPitcherId;
  const counts = new Map<number, number>();
  for (const p of pitches) {
    if (p.pitcherId == null) continue;
    counts.set(p.pitcherId, (counts.get(p.pitcherId) ?? 0) + 1);
  }
  let best: number | undefined;
  let bestCount = 0;
  for (const [id, n] of counts) {
    if (n > bestCount || (n === bestCount && best !== undefined && id < best)) {
      best = id;
      bestCount = n;
    }
  }
  return best;
}

/** Distinct pitcher ids present in the pitches. */
export function distinctPitcherCount(pitches: readonly PitchDatum[]): number {
  return new Set(pitches.filter((p) => p.pitcherId != null).map((p) => p.pitcherId)).size;
}

/**
 * One pitcher's pitches in throwing order: sorted by (atBatNumber, pitchNumber)
 * when every pitch carries both; otherwise the data's own order is kept.
 */
export function pitcherPitchesInOrder(
  pitches: readonly PitchDatum[],
  pitcherId: number | undefined,
): PitchDatum[] {
  const own = pitcherId === undefined ? [...pitches] : pitches.filter((p) => p.pitcherId === pitcherId);
  if (own.length > 0 && own.every((p) => p.atBatNumber != null && p.pitchNumber != null)) {
    return own
      .map((p, i) => ({ p, i }))
      .sort((a, b) => a.p.atBatNumber! - b.p.atBatNumber! || a.p.pitchNumber! - b.p.pitchNumber! || a.i - b.i)
      .map((e) => e.p);
  }
  return own;
}

/**
 * Partition ONE pitcher's pitches into count buckets to quantify velocity drop
 * and arm-slot fatigue. `pitcherId` defaults to fatiguePitcher(pitches); other
 * pitchers' pitches are ignored so mixed pitchers are never pooled. Extension
 * is averaged only over pitches that report it (null when none do).
 */
export function computeFatigueBuckets(
  pitches: PitchDatum[],
  bucketSize = 25,
  pitcherId: number | undefined = fatiguePitcher(pitches),
): FatigueBucket[] {
  if (!pitches || pitches.length === 0 || bucketSize <= 0) {
    return [];
  }
  const ordered = pitcherPitchesInOrder(pitches, pitcherId);

  const buckets: FatigueBucket[] = [];
  let baseSpeed: number | null = null;
  let baseZ: number | null = null;
  let baseExt: number | null = null;

  for (let i = 0; i < ordered.length; i += bucketSize) {
    const chunk = ordered.slice(i, i + bucketSize);
    const count = chunk.length;
    if (count === 0) continue;

    let sumSpeed = 0;
    let sumZ = 0;
    let sumX = 0;
    let sumExt = 0;
    let extCount = 0;
    let swings = 0;
    let whiffs = 0;

    for (const p of chunk) {
      sumSpeed += p.releaseSpeed;
      sumZ += p.kinematics ? p.kinematics.z0 : p.plateZ ?? 5.5;
      sumX += p.kinematics ? p.kinematics.x0 : p.plateX ?? 0.0;
      if (p.extension != null && Number.isFinite(p.extension)) {
        sumExt += p.extension;
        extCount++;
      }
      if (p.isSwing) swings++;
      if (p.isWhiff) whiffs++;
    }

    const avgSpeed = sumSpeed / count;
    const avgZ = sumZ / count;
    const avgX = sumX / count;
    const avgExt = extCount > 0 ? sumExt / extCount : null;
    const whiffPct = swings > 0 ? (whiffs / swings) * 100.0 : 0.0;

    if (baseSpeed === null || baseZ === null) {
      baseSpeed = avgSpeed;
      baseZ = avgZ;
    }
    if (baseExt === null && avgExt !== null) baseExt = avgExt;

    buckets.push({
      bucketIndex: buckets.length,
      pitchCountStart: i + 1,
      pitchCountEnd: i + count,
      pitchCount: count,
      avgReleaseSpeed: avgSpeed,
      avgReleaseZ: avgZ,
      avgReleaseX: avgX,
      avgExtension: avgExt,
      whiffPct,
      deltaVelocityMph: avgSpeed - baseSpeed,
      deltaReleaseZInches: (avgZ - baseZ) * 12.0,
      deltaExtensionInches: avgExt !== null && baseExt !== null ? (avgExt - baseExt) * 12.0 : null,
    });
  }

  return buckets;
}

/** One-line note for the fatigue panel when the visible pitches span several pitchers. */
export function fatigueNote(label: string | undefined, pitcherCount: number | undefined): string | null {
  if (!pitcherCount || pitcherCount <= 1) return null;
  return `Showing ${label ?? "one pitcher"} (1 of ${pitcherCount} pitchers); pin a pitch to choose`;
}
