import { describe, expect, it } from "vitest";
import { assessDensity } from "./densityAdvice";

describe("assessDensity (mirrors src/kiln/batch/density.py assess_density)", () => {
  it("marks values inside the target band as ok and never blocks progress", () => {
    const advice = assessDensity(1.45, 0);
    expect(advice.status).toBe("ok");
    expect(advice.blocksProgress).toBe(false);
    expect(advice.remeasureRecommended).toBe(false);
  });

  it("classifies too-thin, too-thick, and out-of-range bands", () => {
    expect(assessDensity(1.35, 0).status).toBe("too_thin");
    expect(assessDensity(1.55, 0).status).toBe("too_thick");
    expect(assessDensity(1.05, 0).status).toBe("out_of_range");
    expect(assessDensity(1.9, 0).status).toBe("out_of_range");
  });

  it("recommends remeasurement after the settling window even when ok", () => {
    const advice = assessDensity(1.45, 15);
    expect(advice.status).toBe("ok");
    expect(advice.remeasureRecommended).toBe(true);
    expect(advice.message).toMatch(/15분 경과/);
  });

  it("never sets blocksProgress even for extreme values", () => {
    expect(assessDensity(2.0, 0).blocksProgress).toBe(false);
  });
});
