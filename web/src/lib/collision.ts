/**
 * Ball-Bat Collision & Contact Quality Simulation (Sprint 10).
 *
 * Implements physics from Cross & Nathan (2006, arXiv:physics/0605040)
 * and Statcast Barrel classification formulas.
 *
 * All formulas must remain numerically identical to ingestion/worker.py.
 */

import { flightTime, positionAt, GRAVITY_FT_S2, type PitchKinematics } from "./kinematics";

export type ContactQuality =
  | "Barrel"
  | "Solid Contact"
  | "Flare/Burner"
  | "Under"
  | "Topped"
  | "Weak"
  | "Whiff";

export interface CollisionResult {
  exitSpeedMph: number;
  launchAngleDeg: number;
  sprayAngleDeg: number;
  contactQuality: ContactQuality;
  distanceFt: number;
  hangTimeS: number;
}

export const CONTACT_QUALITY_COLORS: Record<ContactQuality, readonly [number, number, number]> = {
  Barrel: [255, 60, 40],
  "Solid Contact": [30, 220, 100],
  "Flare/Burner": [0, 190, 255],
  Under: [180, 120, 255],
  Topped: [230, 170, 30],
  Weak: [150, 150, 150],
  Whiff: [80, 80, 80],
};

/**
 * Classify contact quality according to Statcast Barrel and batted ball zones.
 */
export function classifyContactQuality(
  exitSpeedMph: number,
  launchAngleDeg: number
): ContactQuality {
  if (exitSpeedMph <= 0.0) {
    return "Whiff";
  }

  if (exitSpeedMph >= 98.0) {
    const minAngle = Math.max(8.0, 26.0 - (exitSpeedMph - 98.0) * 1.0);
    const maxAngle = Math.min(50.0, 30.0 + (exitSpeedMph - 98.0) * 1.1);
    if (launchAngleDeg >= minAngle && launchAngleDeg <= maxAngle) {
      return "Barrel";
    }
  }

  if (exitSpeedMph >= 90.0 && launchAngleDeg >= 10.0 && launchAngleDeg <= 38.0) {
    return "Solid Contact";
  }

  if (exitSpeedMph >= 80.0 && launchAngleDeg >= 0.0 && launchAngleDeg <= 25.0) {
    return "Flare/Burner";
  }

  if (launchAngleDeg > 38.0) {
    return "Under";
  }

  if (launchAngleDeg < 0.0) {
    return "Topped";
  }

  return "Weak";
}

/**
 * Simulate ball-bat collision (Cross & Nathan 2006).
 *
 * @param pitch Kinematics of the pitch reaching the plate
 * @param batSpeed Bat speed at sweet spot in mph (default: 75.0 mph)
 * @param attackAngleDeg Vertical bat attack angle in degrees (default: 10.0 deg)
 * @param offsetZIn Vertical impact offset from bat center in inches (default: 0.0 in)
 * @param offsetXIn Horizontal impact offset from bat sweet spot in inches (default: 0.0 in)
 */
export function computeCollision(
  pitch: PitchKinematics,
  batSpeed = 75.0,
  attackAngleDeg = 10.0,
  offsetZIn = 0.0,
  offsetXIn = 0.0
): CollisionResult {
  const tEnd = flightTime(pitch);
  const vxEnd = pitch.vx0 + pitch.ax * tEnd;
  const vyEnd = pitch.vy0 + pitch.ay * tEnd;
  const vzEnd = pitch.vz0 + pitch.az * tEnd;
  const arrivalSpeedFps = Math.sqrt(vxEnd * vxEnd + vyEnd * vyEnd + vzEnd * vzEnd);
  const arrivalSpeedMph = arrivalSpeedFps / 1.467;

  const rEff = 2.5; // effective bat radius in inches
  const d = Math.hypot(offsetXIn, offsetZIn);

  if (d > rEff) {
    return {
      exitSpeedMph: 0.0,
      launchAngleDeg: 0.0,
      sprayAngleDeg: 0.0,
      contactQuality: "Whiff",
      distanceFt: 0.0,
      hangTimeS: 0.0,
    };
  }

  // Collision efficiency q = 0.22 (wood bat on baseball)
  const q = 0.22;
  const flushExit = q * arrivalSpeedMph + (1.0 + q) * batSpeed;

  const fOffset = Math.sqrt(Math.max(0.0, 1.0 - Math.pow(d / rEff, 2)));
  const exitSpeed = flushExit * fOffset;

  // Offset shifts launch angle & spray angle
  const angleOffset = Math.asin(offsetZIn / rEff) * (180.0 / Math.PI) * 0.6;
  const launchAngle = attackAngleDeg - angleOffset;

  const sprayAngle = Math.asin(offsetXIn / rEff) * (180.0 / Math.PI) * 0.6;

  const quality = classifyContactQuality(exitSpeed, launchAngle);

  // Ballistics
  const v0Fps = exitSpeed * 1.467;
  const thetaRad = (launchAngle * Math.PI) / 180.0;
  const phiRad = (sprayAngle * Math.PI) / 180.0;
  const vz0 = v0Fps * Math.sin(thetaRad);
  const vy0 = v0Fps * Math.cos(thetaRad) * Math.cos(phiRad);

  const posEnd = positionAt(pitch, tEnd);
  const zPlate = Math.max(0.5, posEnd[2]);

  const disc = vz0 * vz0 + 2.0 * GRAVITY_FT_S2 * zPlate;
  let tHang = disc >= 0 ? (vz0 + Math.sqrt(Math.max(0.0, disc))) / GRAVITY_FT_S2 : 0.0;
  tHang = Math.max(0.0, Math.min(tHang, 7.5));

  const distanceFt = tHang > 0 ? vy0 * tHang * Math.exp(-0.12 * tHang) : 0.0;

  return {
    exitSpeedMph: exitSpeed,
    launchAngleDeg: launchAngle,
    sprayAngleDeg: sprayAngle,
    contactQuality: quality,
    distanceFt: Math.max(0.0, distanceFt),
    hangTimeS: tHang,
  };
}

/**
 * Project n-point 3D flight path of a batted ball into field coordinates.
 */
export function projectBattedTrajectory(
  origin: [number, number, number],
  exitSpeedMph: number,
  launchAngleDeg: number,
  sprayAngleDeg = 0.0,
  hangTimeS = 4.0,
  n = 40
): Array<[number, number, number]> {
  const v0 = exitSpeedMph * 1.467;
  const theta = (launchAngleDeg * Math.PI) / 180.0;
  const phi = (sprayAngleDeg * Math.PI) / 180.0;
  const vx0 = v0 * Math.sin(phi) * Math.cos(theta);
  const vy0 = v0 * Math.cos(phi) * Math.cos(theta);
  const vz0 = v0 * Math.sin(theta);

  const points: Array<[number, number, number]> = [];
  const [x0, y0, z0] = origin;
  const tTotal = Math.max(0.1, hangTimeS);

  for (let i = 0; i < n; i++) {
    const t = (tTotal * i) / (n - 1);
    const damping = Math.exp(-0.12 * t);
    const x = x0 + vx0 * t * damping;
    const y = y0 + vy0 * t * damping;
    const z = Math.max(0.0, z0 + vz0 * t - 0.5 * GRAVITY_FT_S2 * t * t);
    points.push([x, y, z]);
  }

  return points;
}

/**
 * Project batted trajectory as a flat Float32Array for zero-copy GPU upload.
 */
export function projectBattedTrajectoryFlat(
  origin: [number, number, number],
  exitSpeedMph: number,
  launchAngleDeg: number,
  sprayAngleDeg = 0.0,
  hangTimeS = 4.0,
  n = 40
): Float32Array {
  const pts = projectBattedTrajectory(
    origin,
    exitSpeedMph,
    launchAngleDeg,
    sprayAngleDeg,
    hangTimeS,
    n
  );
  const flat = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    flat[i * 3] = pts[i][0];
    flat[i * 3 + 1] = pts[i][1];
    flat[i * 3 + 2] = pts[i][2];
  }
  return flat;
}
