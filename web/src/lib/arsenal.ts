/**
 * Pitch Arsenal Clustering & Pitch-Pair Tunneling Analysis (Sprint 9).
 *
 * Implements cluster centroid calculations per pitch type and pairwise tunneling
 * metrics (Powers & Yurko 2025; Nathan 2012), including the Deception Tunnel Ratio:
 * R_tunnel = Delta_plate / max(Delta_tunnel, 0.01).
 */
import {
  flightTime,
  positionAt,
  computeBreakVector,
  commitmentPosition,
  type PitchKinematics,
  type BreakVector,
} from "./kinematics";
import type { PitchDatum, WireSegment } from "./deck-layers";

export interface ArsenalCentroid {
  pitchType: string;
  count: number;
  releaseSpeed: number;
  releaseSpinRate?: number;
  kinematics: PitchKinematics;
  plateX: number;
  plateZ: number;
  breakVector: BreakVector;
  commitmentPoint: [number, number, number];
}

export interface PitchPairMetrics {
  typeA: string;
  typeB: string;
  releaseSeparationInches: number;
  tunnelingSeparationInches: number;
  plateDivergenceInches: number;
  breakDivergenceInches: number;
  velocityDeltaMph: number;
  tunnelRatio: number;
}

/**
 * Group pitches by pitchType and compute mean kinematic parameters and break vectors.
 */
export function computeArsenalCentroids(pitches: PitchDatum[]): Map<string, ArsenalCentroid> {
  const byType = new Map<string, PitchDatum[]>();
  for (const p of pitches) {
    if (!p.pitchType) continue;
    let list = byType.get(p.pitchType);
    if (!list) {
      list = [];
      byType.set(p.pitchType, list);
    }
    list.push(p);
  }

  const centroids = new Map<string, ArsenalCentroid>();
  for (const [pt, list] of byType.entries()) {
    const valid = list.filter((p) => p.kinematics != null);
    if (valid.length === 0) continue;

    const n = valid.length;
    let sumSpeed = 0;
    let sumSpin = 0;
    let spinCount = 0;
    let sumX0 = 0, sumY0 = 0, sumZ0 = 0;
    let sumVx0 = 0, sumVy0 = 0, sumVz0 = 0;
    let sumAx = 0, sumAy = 0, sumAz = 0;
    let sumPlateX = 0, sumPlateZ = 0;

    for (const p of valid) {
      sumSpeed += p.releaseSpeed;
      if (p.spinRate != null && !isNaN(p.spinRate)) {
        sumSpin += p.spinRate;
        spinCount++;
      }
      const k = p.kinematics!;
      sumX0 += k.x0; sumY0 += k.y0; sumZ0 += k.z0;
      sumVx0 += k.vx0; sumVy0 += k.vy0; sumVz0 += k.vz0;
      sumAx += k.ax; sumAy += k.ay; sumAz += k.az;
      sumPlateX += p.plateX ?? p.pfxX ?? 0;
      sumPlateZ += p.plateZ ?? p.pfxZ ?? 0;
    }

    const kMean: PitchKinematics = {
      x0: sumX0 / n, y0: sumY0 / n, z0: sumZ0 / n,
      vx0: sumVx0 / n, vy0: sumVy0 / n, vz0: sumVz0 / n,
      ax: sumAx / n, ay: sumAy / n, az: sumAz / n,
    };

    const bv = computeBreakVector(kMean);
    const cp = commitmentPosition(kMean);

    centroids.set(pt, {
      pitchType: pt,
      count: n,
      releaseSpeed: sumSpeed / n,
      releaseSpinRate: spinCount > 0 ? sumSpin / spinCount : undefined,
      kinematics: kMean,
      plateX: sumPlateX / n,
      plateZ: sumPlateZ / n,
      breakVector: bv,
      commitmentPoint: cp,
    });
  }

  return centroids;
}

/**
 * Calculate pairwise tunneling divergence metrics between two pitch centroids.
 */
export function computePitchPairMetrics(c1: ArsenalCentroid, c2: ArsenalCentroid): PitchPairMetrics {
  const k1 = c1.kinematics;
  const k2 = c2.kinematics;

  // Release separation in inches
  const relSep = Math.hypot(k1.x0 - k2.x0, k1.z0 - k2.z0) * 12;

  // Tunneling separation in inches at commitment plane (y = 23.8 ft)
  const cp1 = c1.commitmentPoint;
  const cp2 = c2.commitmentPoint;
  const tunnelSep = Math.hypot(cp1[0] - cp2[0], cp1[2] - cp2[2]) * 12;

  // Plate divergence in inches at plate plane (y = 1.417 ft)
  const tEnd1 = flightTime(k1);
  const tEnd2 = flightTime(k2);
  const pos1 = positionAt(k1, tEnd1);
  const pos2 = positionAt(k2, tEnd2);
  const plateSep = Math.hypot(pos1[0] - pos2[0], pos1[2] - pos2[2]) * 12;

  // Break divergence in inches
  const breakSep = Math.hypot(
    c1.breakVector.hBreakInches - c2.breakVector.hBreakInches,
    c1.breakVector.vBreakInches - c2.breakVector.vBreakInches,
  );

  // Velocity delta in mph
  const deltaSpeed = Math.abs(c1.releaseSpeed - c2.releaseSpeed);

  // Tunnel Ratio (Deception Index)
  const tunnelRatio = plateSep / Math.max(tunnelSep, 0.01);

  return {
    typeA: c1.pitchType,
    typeB: c2.pitchType,
    releaseSeparationInches: relSep,
    tunnelingSeparationInches: tunnelSep,
    plateDivergenceInches: plateSep,
    breakDivergenceInches: breakSep,
    velocityDeltaMph: deltaSpeed,
    tunnelRatio,
  };
}

/**
 * 3D wireframe segments connecting two paired pitch centroids across key flight thresholds:
 * release points bridge, commitment points bridge, and plate crossings bridge.
 */
export function tunnelingEnvelopeSegments(c1: ArsenalCentroid, c2: ArsenalCentroid): WireSegment[] {
  const k1 = c1.kinematics;
  const k2 = c2.kinematics;
  const tEnd1 = flightTime(k1);
  const tEnd2 = flightTime(k2);
  const pos1 = positionAt(k1, tEnd1);
  const pos2 = positionAt(k2, tEnd2);

  return [
    // Bridge at release point
    [[k1.x0, k1.y0, k1.z0], [k2.x0, k2.y0, k2.z0]],
    // Bridge at commitment plane
    [c1.commitmentPoint, c2.commitmentPoint],
    // Bridge at plate plane
    [pos1, pos2],
  ];
}
