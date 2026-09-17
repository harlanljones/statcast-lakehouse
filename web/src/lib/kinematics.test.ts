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
  PLATE_Y,
  GRAVITY_FT_S2,
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

  it("ghostKinematics clears lateral break and sets standard downward gravity", () => {
    const ghost = ghostKinematics(SLIDER);
    expect(ghost.ax).toBe(0);
    expect(ghost.ay).toBe(SLIDER.ay);
    expect(ghost.az).toBe(-GRAVITY_FT_S2);
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

    const expectedDxInches = 0.5 * SLIDER.ax * tEnd * tEnd * 12;
    const expectedDzInches = 0.5 * (SLIDER.az - (-GRAVITY_FT_S2)) * tEnd * tEnd * 12;

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

    expect(elapsed).toBeLessThan(10);
  });
});


