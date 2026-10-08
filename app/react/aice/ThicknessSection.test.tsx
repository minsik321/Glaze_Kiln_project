import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ThicknessComputeResponse } from "../lib/api";
import { ThicknessSection } from "./ThicknessSection";

afterEach(cleanup);

function profile(overrides: Partial<ThicknessComputeResponse> = {}): ThicknessComputeResponse {
  return {
    points: [{ z: 0, radius: 30, t_abs: 1.0, t_flow: 0, total: 1.0 }],
    area_m2: 0.045,
    mean_mm: 1.0,
    areal_density_g_m2: 667,
    glaze_weight_g: 30,
    rho_dry: 1.5,
    has_distribution: true,
    within_model_scope: true,
    local_max_mm: 1.0,
    local_min_mm: 1.0,
    spread_mm: 0,
    provenance_notes: [],
    ...overrides,
  };
}

describe("ThicknessSection", () => {
  it("shows the real mm estimate alongside g/m² once the backend profile arrives", () => {
    const { container } = render(<ThicknessSection ware="bowl" profile={profile()} />);
    expect(container.querySelector(".thickness-measurement")?.textContent).toBe("평균 1.00mm · 667g/m²");
  });

  it("falls back to the unavailable style when there is no profile yet", () => {
    const { container } = render(<ThicknessSection ware="bowl" profile={null} />);
    expect(container.querySelectorAll(".glaze-segment.unavailable").length).toBeGreaterThan(0);
    expect(container.querySelector(".thickness-scale")).toBeNull();
  });

  it("draws thicker glaze (wider, redder) toward the foot than at the rim", () => {
    const points = [
      { z: 0, radius: 30, t_abs: 0.5, t_flow: 1.0, total: 1.5 },
      { z: 10, radius: 30, t_abs: 0.5, t_flow: 0, total: 0.5 },
    ];
    const { container } = render(<ThicknessSection ware="cylinder_vase" profile={profile({ points })} />);
    const widths = Array.from(container.querySelectorAll<SVGLineElement>(".glaze-segment")).map((line) => parseFloat(line.style.strokeWidth));
    expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(5);
  });
});
