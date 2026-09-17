import { describe, expect, it } from "vitest";
import type { ThicknessComputeResponse } from "../lib/api";
import { SOURCE_TYPES, sampleAiceRun } from "./contract";
import { buildCurveComparison } from "./curvePlan";
import { sensorPreset, simulateKilnFrame } from "./kilnSimulation";
import { buildThicknessView } from "./thicknessView";

//: coating은 여전히 curvePlan.ts·kilnSimulation.ts의 합성 삽화 입력이다
//: (이번 수정 범위 밖) — thickness 쪽만 실제 무게 프로필(profile)로
//: 갈아탔으므로, 여기서는 두 종류의 입력을 각자의 자리에 따로 준다.
function projection(coating: "thin" | "target" | "thick", meanMm: number) {
  const profile: ThicknessComputeResponse = {
    points: [{ z: 0, radius: 30, t_abs: meanMm, t_flow: 0, total: meanMm }],
    area_m2: 0.05, mean_mm: meanMm, areal_density_g_m2: meanMm * 1500,
    glaze_weight_g: meanMm * 75, rho_dry: 1.5, has_distribution: true, within_model_scope: true,
    local_max_mm: meanMm, local_min_mm: meanMm, spread_mm: 0, provenance_notes: [],
  };
  return {
    thickness: buildThicknessView({ ware: "bowl", profile }),
    curves: buildCurveComparison(coating),
    kiln: simulateKilnFrame({ minute: 320, sensors: sensorPreset("three"), coating }),
    version: "aice-integrated-v2",
  };
}

describe("AICE cross-view integration and provenance regression", () => {
  it("propagates a real thickness change through thickness/risk, and a coating change through curve/kiln, under one run version", () => {
    const thin = projection("thin", 0.3); const thick = projection("thick", 1.6);
    expect(thin.thickness.segments).not.toEqual(thick.thickness.segments);
    expect(thin.thickness.risk).not.toEqual(thick.thickness.risk);
    expect(thin.curves[1].id).not.toEqual(thick.curves[1].id);
    expect(thin.kiln.physical.estimatedWareTemperatureC).not.toEqual(thick.kiln.physical.estimatedWareTemperatureC);
    expect(thin.version).toBe(thick.version);
  });

  it("never promotes non-observed values to observed", () => {
    const run = sampleAiceRun();
    const serialized = JSON.stringify(run);
    expect(run.thickness.mean.source_type).toBe("inferred");
    expect(run.thickness.uncertainty.source_type).toBe("synthetic");
    expect(run.recipe.firing_range.source_type).toBe("literature");
    expect(run.recipe.photo.source_type).toBe("synthetic");
    expect(SOURCE_TYPES).toEqual(["observed", "patent_example", "patent_range", "literature", "inferred", "synthetic"]);
    expect(serialized).not.toContain('"source_type":"measured"');
  });
});
