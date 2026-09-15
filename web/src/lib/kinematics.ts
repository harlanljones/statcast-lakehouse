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

/** Solve y(t) = y0 + vy0 t + 1/2 ay t^2 = PLATE_Y for the larger root. */
export function flightTime(p: PitchKinematics): number {
  const a = 0.5 * p.ay;
  const b = p.vy0;
  const c = p.y0 - PLATE_Y;
  const disc = b * b - 4 * a * c;
  if (disc < 0) throw new Error("pitch never reaches the plate plane");
  if (Math.abs(a) < 1e-12) {
    if (b === 0) throw new Error("degenerate pitch: y is constant");
    const t = -c / b;
    if (t <= 0 || b > 0) throw new Error("plate crossing not in the future");
    return t;
  }
  const roots = [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)];
  const t = Math.min(...roots.filter((r) => r > 0 && b + 2 * a * r < 0));
  if (!Number.isFinite(t)) throw new Error("plate crossing not in the future");
  return t;
}

/** Position at time t (seconds since release). */
export function positionAt(p: PitchKinematics, t: number): [number, number, number] {
  return [
    p.x0 + p.vx0 * t + 0.5 * p.ax * t * t,
    p.y0 + p.vy0 * t + 0.5 * p.ay * t * t,
    p.z0 + p.vz0 * t + 0.5 * p.az * t * t,
  ];
}

/** n-point path from release to the plate plane (n=60 matches Statcast). */
export function trajectory(p: PitchKinematics, n = 60): Array<[number, number, number]> {
  const tEnd = flightTime(p);
  const path: Array<[number, number, number]> = new Array(n);
  for (let i = 0; i < n; i++) path[i] = positionAt(p, (tEnd * i) / (n - 1));
  return path;
}

/** Path as a flat Float32Array [x0,y0,z0, x1,y1,z1, ...] for zero-copy GPU upload. */
export function trajectoryFlat(p: PitchKinematics, n = 60): Float32Array {
  const path = trajectory(p, n);
  const flat = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) flat.set(path[i], i * 3);
  return flat;
}
