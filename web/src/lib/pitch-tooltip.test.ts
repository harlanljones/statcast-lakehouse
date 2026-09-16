import { describe, expect, it } from "vitest";
import { PITCH_COLORS, pitchColor, type PitchDatum } from "./deck-layers";
import { clampTooltipPos, pitchTooltip, pitchTooltipSummary, TOOLTIP_OFFSET } from "./pitch-tooltip";

function pitch(overrides: Partial<PitchDatum> = {}): PitchDatum {
  const pfxX = overrides.pfxX ?? overrides.plateX ?? 0.12;
  const pfxZ = overrides.pfxZ ?? overrides.plateZ ?? 2.34;
  return {
    path: new Float32Array([0, 55, 5, 0.5, 20, 4, 0, 1.417, 2.5]),
    releaseSpeed: 94.5,
    pfxX,
    pfxZ,
    plateX: pfxX,
    plateZ: pfxZ,
    pitchType: "FF",
    ...overrides,
  };
}

describe("clampTooltipPos", () => {
  const OFFSET = TOOLTIP_OFFSET.x;
  it("anchors the card at the pointer plus the offset when it fits", () => {
    expect(clampTooltipPos(200, 150, 120, 60, 800, 600)).toEqual({
      x: 200 + OFFSET,
      y: 150 + OFFSET,
    });
  });

  it("clamps to the canvas right edge near it", () => {
    expect(clampTooltipPos(700, 150, 120, 60, 800, 600)).toEqual({ x: 800 - 120, y: 150 + OFFSET });
  });

  it("clamps to the canvas bottom edge near it", () => {
    expect(clampTooltipPos(200, 560, 120, 60, 800, 600)).toEqual({ x: 200 + OFFSET, y: 600 - 60 });
  });

  it("pins an oversized card to the canvas origin on the overflowing axis", () => {
    expect(clampTooltipPos(300, 200, 900, 60, 800, 600)).toEqual({ x: 0, y: 212 });
    expect(clampTooltipPos(300, 200, 120, 700, 800, 600)).toEqual({ x: 312, y: 0 });
  });

  it("keeps a card that exactly fits the remaining space", () => {
    // pointer + offset + card size == canvas size on both axes: the card sits
    // flush with the canvas edge, which is still fully inside.
    expect(clampTooltipPos(800 - 120 - OFFSET, 600 - 60 - OFFSET, 120, 60, 800, 600)).toEqual({
      x: 800 - 120,
      y: 600 - 60,
    });
  });
});

describe("pitchTooltip", () => {
  it("carries the pitch type and its palette color", () => {
    const info = pitchTooltip(pitch({ pitchType: "SL" }))!;
    expect(info.pitchType).toBe("SL");
    expect(info.color).toEqual(PITCH_COLORS.SL);
    expect(pitchTooltip(pitch({ pitchType: "zz" }))!.color).toEqual(pitchColor("zz"));
  });

  it("formats speed in mph with one decimal", () => {
    expect(pitchTooltip(pitch({ releaseSpeed: 94.5 }))!.speed).toBe("94.5 mph");
    expect(pitchTooltip(pitch({ releaseSpeed: 99 }))!.speed).toBe("99.0 mph");
  });

  it("formats location in feet rounded to one decimal", () => {
    expect(pitchTooltip(pitch({ plateX: 0.12, plateZ: 2.34 }))!.location).toBe("0.1 ft, 2.3 ft");
    expect(pitchTooltip(pitch({ plateX: -0.75, plateZ: 1.0 }))!.location).toBe("-0.8 ft, 1.0 ft");
  });

  it("rounds half values away from zero to the visible decimal", () => {
    expect(pitchTooltip(pitch({ plateX: 0.25 }))!.location).toContain("0.3 ft");
    // Sign symmetry: the negative half rounds away from zero too.
    expect(pitchTooltip(pitch({ plateX: -0.25 }))!.location).toContain("-0.3 ft");
  });

  it("reports zone status as In Zone or Ball", () => {
    expect(pitchTooltip(pitch({ plateX: 0.1, plateZ: 2.5 }))!.zone).toBe("In Zone");
    expect(pitchTooltip(pitch({ plateX: 1.5, plateZ: 2.5 }))!.zone).toBe("Ball");
  });

  it("reports outcome as Whiff, Swing, Take, or undefined", () => {
    expect(pitchTooltip(pitch({ isSwing: 1, isWhiff: 1 }))!.outcome).toBe("Whiff");
    expect(pitchTooltip(pitch({ isSwing: 1, isWhiff: 0 }))!.outcome).toBe("Swing");
    expect(pitchTooltip(pitch({ isSwing: 0, isWhiff: 0 }))!.outcome).toBe("Take");
    expect(pitchTooltip(pitch({ isSwing: undefined, isWhiff: undefined }))!.outcome).toBeUndefined();
  });

  it("summarizes the hovered pitch for the aria-live region including zone and outcome", () => {
    expect(
      pitchTooltipSummary(
        pitch({ releaseSpeed: 94.5, plateX: 0.12, plateZ: 2.34, isSwing: 1, isWhiff: 1 }),
      ),
    ).toBe("FF: 94.5 mph, 0.1 ft, 2.3 ft, In Zone, Whiff");

    expect(
      pitchTooltipSummary(
        pitch({ releaseSpeed: 94.5, plateX: 0.12, plateZ: 2.34 }),
      ),
    ).toBe("FF: 94.5 mph, 0.1 ft, 2.3 ft, In Zone");

    expect(
      pitchTooltipSummary(
        pitch({ releaseSpeed: 92.0, plateX: 1.2, plateZ: 1.0, isSwing: 0 }),
      ),
    ).toBe("FF: 92.0 mph, 1.2 ft, 1.0 ft, Ball, Take");
  });

  it("handles a null datum (nothing hovered)", () => {
    expect(pitchTooltip(null)).toBeNull();
    expect(pitchTooltip(undefined)).toBeNull();
    expect(pitchTooltipSummary(null)).toBe("");
  });
});
