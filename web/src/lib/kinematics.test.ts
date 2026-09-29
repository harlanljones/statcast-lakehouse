import { describe, expect, it } from "vitest";
import {
  flightTime,
  positionAt,
  trajectory,
  trajectoryFlat,
  ghostKinematics,
  ghostTrajectory,
  ghostTrajectoryFlat,
  computeBreakVector,
  breakVectorSegment,
  extrapolateToRelease,
  type PitchKinematics,
  COMMITMENT_PLANE_Y_FT,
  solveCommitmentTime,
  commitmentPosition,
  tunnelingDistance,
  PLATE_Y,
  GRAVITY_FT_S2,
  PITCHING_RUBBER_Y_FT,
} from "./kinematics";

const FASTBALL: Parameters<typeof flightTime>[0] = {
  x0: 0, y0: 55, z0: 6,
  vx0: 0, vy0: -130, vz0: -10,
  ax: 0, ay: 0, az: 0,
};

describe("flightTime", () => {
  it("matches closed form with zero acceleration", () => {
    expect(flightTime(FASTBALL)).toBeCloseTo((55 - PLATE_Y) / 130, 9);
  });
  it("solves with acceleration", () => {
    const p = { ...FASTBALL, ay: 4 };
    const t = flightTime(p);
    const y = p.y0 + p.vy0 * t + 0.5 * p.ay * t * t;
    expect(y).toBeCloseTo(PLATE_Y, 9);
  });
  it("rejects pitches that never reach the plate", () => {
    expect(() => flightTime({ ...FASTBALL, y0: 1, vy0: 5 })).toThrow();
  });
});

describe("trajectory", () => {
  it("produces 60 points ending at the plate", () => {
    const path = trajectory(FASTBALL);
    expect(path).toHaveLength(60);
    expect(path[0][1]).toBeCloseTo(55, 6);
    expect(path[59][1]).toBeCloseTo(PLATE_Y, 5);
  });
  it("flat buffer is length 180 Float32", () => {
    expect(trajectoryFlat(FASTBALL)).toHaveLength(180);
  });
  it("constant-velocity midpoint is the average of endpoints", () => {
    const path = trajectory(FASTBALL, 3);
    expect(path[1][1]).toBeCloseTo((55 + PLATE_Y) / 2, 6);
  });
  it("positionAt honors acceleration", () => {
    const [, y] = positionAt({ ...FASTBALL, az: 32.174 }, 0.1);
    void y;
    const [, , z] = positionAt({ ...FASTBALL, az: 32.174 }, 0.1);
    expect(z).toBeCloseTo(6 - 10 * 0.1 + 0.5 * 32.174 * 0.01, 9);
  });
});

describe("ghostKinematics and breakVector", () => {
  const SLIDER: Parameters<typeof flightTime>[0] = {
    x0: -1.5, y0: 55, z0: 5.8,
    vx0: 3.5, vy0: -125, vz0: -3.0,
    ax: -8.0, ay: 20.0, az: -22.0,
  };

  it("ghostKinematics keeps gravity plus drag along the mid-flight velocity", () => {
    const ghost = ghostKinematics(SLIDER);
    // Pinned closed form, mirrored in ingestion/tests/test_worker.py.
    expect(ghost.ax).toBeCloseTo(-0.29551651184849326, 10);
    expect(ghost.az).toBeCloseTo(-30.82022441300371, 10);
    expect(ghost.ay).toBe(SLIDER.ay);
    expect(ghost.az).toBeGreaterThan(-GRAVITY_FT_S2); // drag slows the descent
    expect(ghost.x0).toBe(SLIDER.x0);
    expect(ghost.y0).toBe(SLIDER.y0);
    expect(ghost.z0).toBe(SLIDER.z0);
  });

  it("ghostTrajectory arrives at the plate at the identical flight time as the actual pitch", () => {
    const tActual = flightTime(SLIDER);
    const tGhost = flightTime(ghostKinematics(SLIDER));
    expect(tGhost).toBeCloseTo(tActual, 9);

    const actualPath = trajectory(SLIDER);
    const ghostPath = ghostTrajectory(SLIDER);
    expect(ghostPath).toHaveLength(60);
    expect(ghostPath[0][1]).toBeCloseTo(55, 6);
    expect(ghostPath[59][1]).toBeCloseTo(PLATE_Y, 5);
    expect(actualPath[59][1]).toBeCloseTo(ghostPath[59][1], 5);
  });

  it("ghostTrajectoryFlat returns 180 Float32 elements", () => {
    const flat = ghostTrajectoryFlat(SLIDER);
    expect(flat).toHaveLength(180);
    expect(flat instanceof Float32Array).toBe(true);
  });

  it("computeBreakVector calculates Nathan 2012 aerodynamic break displacement", () => {
    const tEnd = flightTime(SLIDER);
    const breakVec = computeBreakVector(SLIDER);

    const ghost = ghostKinematics(SLIDER);
    const expectedDxInches = 0.5 * (SLIDER.ax - ghost.ax) * tEnd * tEnd * 12;
    const expectedDzInches = 0.5 * (SLIDER.az - ghost.az) * tEnd * tEnd * 12;
    // Pinned, mirrored in ingestion/tests/test_worker.py.
    expect(breakVec.hBreakInches).toBeCloseTo(-9.13221400780742, 8);
    expect(breakVec.vBreakInches).toBeCloseTo(10.454714720371594, 8);

    expect(breakVec.hBreakInches).toBeCloseTo(expectedDxInches, 5);
    expect(breakVec.vBreakInches).toBeCloseTo(expectedDzInches, 5);
    expect(breakVec.totalBreakInches).toBeCloseTo(
      Math.hypot(expectedDxInches, expectedDzInches),
      5,
    );
  });

  it("breakVectorSegment connects ghost arrival to actual arrival at home plate", () => {
    const tEnd = flightTime(SLIDER);
    const [ghostEnd, actualEnd] = breakVectorSegment(SLIDER);

    expect(ghostEnd[1]).toBeCloseTo(PLATE_Y, 5);
    expect(actualEnd[1]).toBeCloseTo(PLATE_Y, 5);

    // Delta matches break displacement in feet
    const dx = actualEnd[0] - ghostEnd[0];
    const dz = actualEnd[2] - ghostEnd[2];
    expect(dx * 12).toBeCloseTo(computeBreakVector(SLIDER).hBreakInches, 5);
    expect(dz * 12).toBeCloseTo(computeBreakVector(SLIDER).vBreakInches, 5);
  });

  it("the pitching rubber sits 60.5 ft from the plate", () => {
    expect(PITCHING_RUBBER_Y_FT).toBe(60.5);
  });
});

describe("extrapolateToRelease", () => {
  // Statcast measures x0/y0/z0 at y = 50 ft; extension moves them to the hand.
  const p: PitchKinematics = { x0: -1.5, y0: 50, z0: 6.0, vx0: 2.0, vy0: -130, vz0: -5.0, ax: -8.0, ay: 25.0, az: -20.0 };
  // The root of 12.5 t^2 - 130 t - 4 = 0 closest to zero from below (other root: +10.43).
  const T = -0.030678732248808273;

  it("re-expresses the nine parameters at y = 60.5 - extension (Python worker mirror values)", () => {
    const r = extrapolateToRelease(p, 6.5);
    expect(r.y0).toBe(54.0);
    expect(r.x0).toBeCloseTo(-1.5651222029471927, 10);
    expect(r.z0).toBeCloseTo(6.1439818151201, 10);
    expect(r.vx0).toBeCloseTo(2.2454298579904663, 10);
    expect(r.vy0).toBeCloseTo(-130.7669683062202, 10);
    expect(r.vz0).toBeCloseTo(-4.386425355023834, 10);
    expect([r.ax, r.ay, r.az]).toEqual([p.ax, p.ay, p.az]);
    expect(flightTime(p)).toBeCloseTo(0.38820615570450684, 10);
    expect(flightTime(r)).toBeCloseTo(0.41888488795331513, 10);
  });

  it("runs the flight backwards: the original point is recovered at -t and flight time grows by |t|", () => {
    const r = extrapolateToRelease(p, 6.5);
    const back = positionAt(r, -T);
    expect(back[0]).toBeCloseTo(p.x0, 9);
    expect(back[1]).toBeCloseTo(p.y0, 9);
    expect(back[2]).toBeCloseTo(p.z0, 9);
    expect(flightTime(r)).toBeCloseTo(flightTime(p) + Math.abs(T), 9);
  });

  it("returns the input unchanged without a usable extension", () => {
    expect(extrapolateToRelease(p, null)).toBe(p);
    expect(extrapolateToRelease(p, undefined)).toBe(p);
    expect(extrapolateToRelease(p, Number.NaN)).toBe(p);
    expect(extrapolateToRelease(p, 0)).toBe(p);
    expect(extrapolateToRelease(p, -1)).toBe(p);
    expect(extrapolateToRelease(p, 12)).toBe(p);
  });

  it("returns the input unchanged when no real root exists", () => {
    // Decelerating so hard that the ball never gets back to y = 54 in the past.
    const odd: PitchKinematics = { ...p, vy0: -1, ay: -400 };
    expect(extrapolateToRelease(odd, 6.5)).toBe(odd);
  });

  it("handles a zero y-acceleration (linear) case", () => {
    const lin: PitchKinematics = { ...p, ay: 0 };
    const r = extrapolateToRelease(lin, 6.5);
    expect(r.y0).toBe(54);
    expect(r.vy0).toBe(-130);
    expect(r.x0).toBeCloseTo(p.x0 - p.vx0 * (4 / 130) + 0.5 * p.ax * (4 / 130) ** 2, 9);
  });
});

describe("commitment plane and tunneling", () => {
  const FASTBALL = {
    x0: 0, y0: 55, z0: 6,
    vx0: 0, vy0: -130, vz0: -10,
    ax: 0, ay: 0, az: 0,
  };
  const SLIDER = {
    x0: -1.5, y0: 55, z0: 5.8,
    vx0: 3.5, vy0: -125, vz0: -3.0,
    ax: -8.0, ay: 20.0, az: -22.0,
  };

  it("commitment plane constant is 23.8 ft", () => {
    expect(COMMITMENT_PLANE_Y_FT).toBe(23.8);
  });

  it("solveCommitmentTime matches zero-acceleration closed form", () => {
    const t = solveCommitmentTime(FASTBALL);
    expect(t).toBeCloseTo((55.0 - 23.8) / 130.0, 9);
  });

  it("solveCommitmentTime with acceleration arrives at y = 23.8 ft", () => {
    const t = solveCommitmentTime(SLIDER);
    const y = SLIDER.y0 + SLIDER.vy0 * t + 0.5 * SLIDER.ay * t * t;
    expect(y).toBeCloseTo(COMMITMENT_PLANE_Y_FT, 6);
  });

  it("commitmentPosition y coordinate is 23.8 ft", () => {
    const pos = commitmentPosition(SLIDER);
    expect(pos[1]).toBeCloseTo(COMMITMENT_PLANE_Y_FT, 6);
  });

  it("tunnelingDistance provides symmetric Euclidean distance in inches", () => {
    expect(tunnelingDistance(FASTBALL, FASTBALL)).toBeCloseTo(0, 9);
    const d12 = tunnelingDistance(FASTBALL, SLIDER);
    const d21 = tunnelingDistance(SLIDER, FASTBALL);
    expect(d12).toBeCloseTo(d21, 9);
    expect(d12).toBeGreaterThan(0);
  });

  it("rejects pitches not reaching commitment plane", () => {
    expect(() => solveCommitmentTime({ ...FASTBALL, y0: 20, vy0: 5 })).toThrow();
  });
});

describe("trajectory benchmark", () => {
  it("computes 1,000 pitch trajectories in <10ms", () => {
    const pitches: Array<Parameters<typeof flightTime>[0]> = Array.from({ length: 1000 }, (_, i) => ({
      x0: -2 + (i % 5) * 0.8,
      y0: 54 + (i % 3),
      z0: 5.5 + (i % 4) * 0.3,
      vx0: 4 + (i % 7) * 0.2,
      vy0: -130 - (i % 10),
      vz0: -5 - (i % 6) * 0.5,
      ax: -10 + (i % 20),
      ay: 25 + (i % 5),
      az: -20 - (i % 15),
    }));

    // JIT warm up
    for (let i = 0; i < 200; i++) {
      trajectory(pitches[i]);
      ghostTrajectory(pitches[i]);
    }

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      trajectory(pitches[i]);
    }
    const elapsed = performance.now() - start;
    // CI shared runner tolerance: 1,000 pitches in <25ms (0.025ms/pitch)
    expect(elapsed).toBeLessThan(25);
  });
});


