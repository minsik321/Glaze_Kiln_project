import { describe, expect, it } from "vitest";
import { SECTION_ASSETS, buildThicknessView } from "./thicknessView";
import type { ThicknessComputeResponse } from "../lib/api";

function profile(totals: [number, number, number], overrides: Partial<ThicknessComputeResponse> = {}): ThicknessComputeResponse {
  return {
    points: totals.map((total, index) => ({ z: index * 20, radius: 30 + index * 10, t_abs: total, t_flow: 0, total })),
    area_m2: 0.05,
    mean_mm: totals[1],
    areal_density_g_m2: 700,
    glaze_weight_g: 35,
    rho_dry: 1.5,
    has_distribution: true,
    within_model_scope: true,
    local_max_mm: Math.max(...totals),
    local_min_mm: Math.min(...totals),
    spread_mm: Math.max(...totals) - Math.min(...totals),
    provenance_notes: [],
    ...overrides,
  };
}

describe("thickness section model", () => {
  it("defines normalized assets for every ware preset", () => {
    expect(Object.keys(SECTION_ASSETS).sort()).toEqual(["bottle", "bowl", "cylinder_vase", "mug", "other", "plate", "tile"]);
    expect(Object.values(SECTION_ASSETS).every((asset) => asset.glazePaths.length === 3)).toBe(true);
  });

  it("classifies segments from real profile points against the safe range, not a coating lookup table", () => {
    const view = buildThicknessView({ ware: "bowl", profile: profile([1.0, 1.0, 1.0]) });
    expect(view.mean.valueMm).toBe(1.0);
    expect(view.segments.map((s) => s.status)).toEqual(["target", "target", "target"]);
    expect(view.segments.every((segment) => segment.sourceType === "inferred")).toBe(true);
  });

  it("flags a thick segment when the real total exceeds the safe upper bound", () => {
    const view = buildThicknessView({ ware: "bowl", profile: profile([0.9, 1.0, 1.6]) });
    expect(view.segments[2].status).toBe("thick");
    expect(view.risk).toContain("흘러내림");
  });

  it("flags a thin segment when the real total is below the safe lower bound", () => {
    const view = buildThicknessView({ ware: "bowl", profile: profile([0.3, 1.0, 1.0]) });
    expect(view.segments[0].status).toBe("thin");
    expect(view.risk).toContain("부족");
  });

  it("uses unavailable instead of a fake default when there is no profile yet", () => {
    const view = buildThicknessView({ ware: "other", profile: null });
    expect(view.mean.label).toBe("판정 불가");
    expect(view.segments.every((segment) => segment.status === "unavailable")).toBe(true);
    expect(view.evidence).toBe("unavailable");
  });
});
