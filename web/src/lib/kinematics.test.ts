import { describe, expect, it } from "vitest";
import { flightTime, positionAt, trajectory, trajectoryFlat, PLATE_Y } from "./kinematics";

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

describe("trajectory benchmark", () => {
  it("computes 1,000 pitch trajectories in <5ms", () => {
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
    for (let i = 0; i < 100; i++) {
      trajectory(pitches[i]);
    }

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      trajectory(pitches[i]);
    }
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(5);
  });
});

