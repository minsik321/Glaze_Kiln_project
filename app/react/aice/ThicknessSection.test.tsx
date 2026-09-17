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
    expect(container.querySelector(".status-badge")?.textContent).toBe("평균 추정 1.00 mm · 667 g/m²");
  });

  it("falls back to the unavailable label when there is no profile yet", () => {
    const { container } = render(<ThicknessSection ware="bowl" profile={null} />);
    expect(container.querySelector(".status-badge")?.textContent).toBe("판정 불가");
  });
});
