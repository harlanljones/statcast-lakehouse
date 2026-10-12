/**
 * Kinematic trajectory solver (TDD §5.2).
 *
 * Statcast models each pitch as constant acceleration from release to the
 * plate plane (the "9 parameters"). The client re-derives the 60-point path
 * from those constants — the warehouse never ships precomputed paths.
 *
 * Units: feet, seconds. y is distance from the FRONT of home plate
 * (y = 1.417 ft is the plate's front face in Statcast convention... actually
 * y0 is measured to the plate front plane; we solve for y = 0 there, and
 * keep PLATE_Y as the front-face constant used by the TDD).
 */

export const PLATE_Y = 1.417; // ft, front face of home plate
export const GRAVITY_FT_S2 = 32.174; // standard gravity in ft/s^2
export const PITCHING_RUBBER_Y_FT = 60.5; // ft, pitching rubber distance from home plate
export const COMMITMENT_PLANE_Y_FT = 23.8; // ft, commitment / decision plane distance from home plate

export interface PitchKinematics {
  x0: number;
  y0: number;
  z0: number;
  vx0: number;
  vy0: number;
  vz0: number;
  ax: number;
  ay: number;
  az: number;
}

export interface BreakVector {
  hBreakInches: number; // horizontal break in inches (+ is catcher's right)
  vBreakInches: number; // induced vertical break (IVB) in inches (+ is upward Magnus lift)
  totalBreakInches: number;
}

/**
 * Kinematic parameters without aerodynamic Magnus force (gravity and drag only).
 * Drag acts along -v, so it is the part of the measured non-gravity
 * acceleration along the mid-flight velocity (Nathan's decomposition); the
 * rest is Magnus. Drag ay is preserved so flight time to home plate remains
 * identical. Mirrors ingestion/worker.py ghost_kinematics exactly.
 */
export function ghostKinematics(p: PitchKinematics): PitchKinematics {
  const tMid = 0.5 * flightTime(p);
  const vx = p.vx0 + p.ax * tMid;
  const vy = p.vy0 + p.ay * tMid;
  const vz = p.vz0 + p.az * tMid;
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  const drag = (p.ax * vx + p.ay * vy + (p.az + GRAVITY_FT_S2) * vz) / speed;
  return {
    ...p,
    ax: (drag * vx) / speed,
    ay: p.ay,
    az: -GRAVITY_FT_S2 + (drag * vz) / speed,
  };
}

/** Solve y(t) = y0 + vy0 t + 1/2 ay t^2 = yEnd for the larger root. */
export function flightTime(p: PitchKinematics, yEnd = PLATE_Y): number {
  const a = 0.5 * p.ay;
  const b = p.vy0;
  const c = p.y0 - yEnd;
  const disc = b * b - 4 * a * c;
  if (disc < 0) throw new Error("pitch never reaches the target plane");
  if (Math.abs(a) < 1e-12) {
    if (b === 0) throw new Error("degenerate pitch: y is constant");
    const t = -c / b;
    if (t <= 0 || b > 0) throw new Error("plane crossing not in the future");
    return t;
  }
  // Earliest positive root at which the ball is still approaching the plate.
  // Scanned without an array/filter/spread: this runs several times per pitch
  // (path, ghost, break vector, commitment plane) on the load path.
  const root = Math.sqrt(disc);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  let best = Infinity;
  if (t1 > 0 && b + 2 * a * t1 < 0) best = t1;
  if (t2 > 0 && b + 2 * a * t2 < 0 && t2 < best) best = t2;
  if (!Number.isFinite(best)) throw new Error("plane crossing not in the future");
  return best;
}

/**
 * Position at time t (seconds since release).
 *
 * Horner form of the same closed form (x0 + vx0*t + 0.5*ax*t*t): two
 * multiplies per coordinate instead of three, evaluated in the same order as
 * `trajectory`/`trajectoryFlat` and as `position_at` in ingestion/worker.py.
 */
export function positionAt(p: PitchKinematics, t: number): [number, number, number] {
  return [
    p.x0 + t * (p.vx0 + 0.5 * p.ax * t),
    p.y0 + t * (p.vy0 + 0.5 * p.ay * t),
    p.z0 + t * (p.vz0 + 0.5 * p.az * t),
  ];
}

/**
 * n-point path from release to the plate plane (n=60 matches Statcast).
 * Timestamps accumulate from tEnd/(n-1), the sequence `trajectoryFlat` and the
 * mirrored Python `trajectory` also accumulate.
 */
export function trajectory(p: PitchKinematics, n = 60): Array<[number, number, number]> {
  const tEnd = flightTime(p);
  const dt = tEnd / (n - 1);
  const path: Array<[number, number, number]> = new Array(n);
  let t = 0;
  for (let i = 0; i < n; i++) {
    path[i] = positionAt(p, t);
    t += dt;
  }
  return path;
}

/** Path as a flat Float32Array [x0,y0,z0, x1,y1,z1, ...] for zero-copy GPU upload. */
export function trajectoryFlat(p: PitchKinematics, n = 60): Float32Array {
  // Same closed form and same expression order as positionAt (Horner form,
  // 0.5 * a hoisted, timestamps accumulated), written straight into the typed
  // array: the GPU path needs the flat buffer, never the tuple list, and the
  // intermediate array of 60 points is the loader's biggest per-pitch
  // allocation. ingestion/worker.py trajectory accumulates the same sequence,
  // so both solvers produce the same floats to the last bit.
  const tEnd = flightTime(p);
  const { x0, y0, z0, vx0, vy0, vz0 } = p;
  const halfAx = 0.5 * p.ax;
  const halfAy = 0.5 * p.ay;
  const halfAz = 0.5 * p.az;
  const dt = tEnd / (n - 1);
  const flat = new Float32Array(n * 3);
  let t = 0;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    flat[j] = x0 + t * (vx0 + halfAx * t);
    flat[j + 1] = y0 + t * (vy0 + halfAy * t);
    flat[j + 2] = z0 + t * (vz0 + halfAz * t);
    t += dt;
  }
  return flat;
}

/** Ghost trajectory under pure gravity and drag (no aerodynamic Magnus force). */
export function ghostTrajectory(p: PitchKinematics, n = 60): Array<[number, number, number]> {
  return trajectory(ghostKinematics(p), n);
}

/** Ghost trajectory as a flat Float32Array for zero-copy GPU upload. */
export function ghostTrajectoryFlat(p: PitchKinematics, n = 60): Float32Array {
  return trajectoryFlat(ghostKinematics(p), n);
}

/**
 * Aerodynamic break vector in inches at plate arrival (Nathan 2012 definition).
 * Measures the displacement between the actual pitch and the ghost pitch.
 */
export function computeBreakVector(p: PitchKinematics): BreakVector {
  const tEnd = flightTime(p);
  const ghost = ghostKinematics(p);
  const dxFt = 0.5 * (p.ax - ghost.ax) * tEnd * tEnd;
  const dzFt = 0.5 * (p.az - ghost.az) * tEnd * tEnd;
  const hBreakInches = dxFt * 12;
  const vBreakInches = dzFt * 12;
  const totalBreakInches = Math.hypot(hBreakInches, vBreakInches);
  return { hBreakInches, vBreakInches, totalBreakInches };
}

/**
 * Segment connecting ghost arrival point to actual arrival point at the plate.
 */
export function breakVectorSegment(p: PitchKinematics): [[number, number, number], [number, number, number]] {
  const tEnd = flightTime(p);
  const actual = positionAt(p, tEnd);
  const ghost = positionAt(ghostKinematics(p), tEnd);
  return [ghost, actual];
}

/**
 * Move the Statcast release parameters from the y = 50 ft measurement plane to
 * the actual release point.
 *
 * Statcast reports x0/y0/z0 (and the velocities/accelerations) at y = 50 ft,
 * not at the pitcher's hand. Given the pitcher's extension (ft in front of the
 * rubber) the hand is at yRel = 60.5 - extension, so we run the constant-
 * acceleration model backwards to the time t <= 0 (closest to zero) at which
 * y(t) = yRel and re-express the nine parameters there. y0 is set to yRel
 * exactly; the remaining time to the plate grows by |t|.
 *
 * Returns p unchanged when extension is missing, non-finite, outside (0, 12)
 * ft, or when no real root exists. Mirrors ingestion/worker.py
 * extrapolate_to_release exactly.
 */
export function extrapolateToRelease(
  p: PitchKinematics,
  extensionFt: number | null | undefined,
): PitchKinematics {
  if (extensionFt == null || !Number.isFinite(extensionFt) || extensionFt <= 0 || extensionFt >= 12) return p;
  const yRel = PITCHING_RUBBER_Y_FT - extensionFt;
  const a = 0.5 * p.ay;
  const b = p.vy0;
  const c = p.y0 - yRel;
  let roots: number[];
  if (Math.abs(a) < 1e-12) {
    if (b === 0) return p;
    roots = [-c / b];
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return p;
    const sq = Math.sqrt(disc);
    roots = [(-b - sq) / (2 * a), (-b + sq) / (2 * a)];
  }
  const past = roots.filter((r) => r <= 0);
  if (past.length === 0) return p;
  const t = Math.max(...past);
  return {
    x0: p.x0 + p.vx0 * t + 0.5 * p.ax * t * t,
    y0: yRel,
    z0: p.z0 + p.vz0 * t + 0.5 * p.az * t * t,
    vx0: p.vx0 + p.ax * t,
    vy0: p.vy0 + p.ay * t,
    vz0: p.vz0 + p.az * t,
    ax: p.ax,
    ay: p.ay,
    az: p.az,
  };
}

/**
  * Flight time until crossing the commitment plane (y = 23.8 ft).
  */
export function solveCommitmentTime(p: PitchKinematics): number {
  return flightTime(p, COMMITMENT_PLANE_Y_FT);
}

/**
  * Position (x, y, z) in feet at the commitment plane (y = 23.8 ft).
  */
export function commitmentPosition(p: PitchKinematics): [number, number, number] {
  return positionAt(p, solveCommitmentTime(p));
}

/**
  * Tunneling separation distance in inches between two pitches at the commitment plane (y = 23.8 ft).
  */
export function tunnelingDistance(p1: PitchKinematics, p2: PitchKinematics): number {
  const c1 = commitmentPosition(p1);
  const c2 = commitmentPosition(p2);
  return Math.hypot(c1[0] - c2[0], c1[2] - c2[2]) * 12;
}


