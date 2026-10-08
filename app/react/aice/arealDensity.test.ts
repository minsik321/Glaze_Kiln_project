import { describe, expect, it } from "vitest";
import { arealDensityFromProfile } from "./arealDensity";
import type { ThicknessComputeResponse } from "../lib/api";

function profile(overrides: Partial<ThicknessComputeResponse> = {}): ThicknessComputeResponse {
  return {
    points: [],
    area_m2: 0.045,
    mean_mm: 0.9,
    areal_density_g_m2: 30 / 0.045,
    glaze_weight_g: 30,
    rho_dry: 1.5,
    has_distribution: false,
    within_model_scope: true,
    local_max_mm: 0.9,
    local_min_mm: 0.9,
    spread_mm: 0,
    provenance_notes: [],
    ...overrides,
  };
}

describe("arealDensityFromProfile", () => {
  it("maps the backend profile's real area/weight fields, not a local constant", () => {
    const result = arealDensityFromProfile(profile());
    expect(result).not.toBeNull();
    expect(result?.glazeWeightG).toBeCloseTo(30);
    expect(result?.areaM2).toBeCloseTo(0.045);
    expect(result?.gramsPerM2).toBeCloseTo(30 / 0.045);
  });

  it("returns null when there is no profile or no weight gain", () => {
    expect(arealDensityFromProfile(null)).toBeNull();
    expect(arealDensityFromProfile(profile({ glaze_weight_g: 0 }))).toBeNull();
    expect(arealDensityFromProfile(profile({ glaze_weight_g: -5 }))).toBeNull();
  });
});
