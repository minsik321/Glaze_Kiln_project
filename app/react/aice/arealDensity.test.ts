import { describe, expect, it } from "vitest";
import { computeArealDensity } from "./arealDensity";

describe("computeArealDensity", () => {
  it("divides the weighed glaze mass by the representative area for the ware", () => {
    const result = computeArealDensity(400, 430, "bowl");
    expect(result).not.toBeNull();
    expect(result?.glazeWeightG).toBeCloseTo(30);
    expect(result?.gramsPerM2).toBeCloseTo(30 / 0.045);
  });

  it("returns null for missing or non-positive weight gain", () => {
    expect(computeArealDensity(Number.NaN, 430, "bowl")).toBeNull();
    expect(computeArealDensity(430, 430, "bowl")).toBeNull();
    expect(computeArealDensity(430, 400, "bowl")).toBeNull();
  });
});
