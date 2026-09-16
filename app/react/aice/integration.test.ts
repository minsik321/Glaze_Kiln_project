import { describe, expect, it } from "vitest";
import { SOURCE_TYPES, sampleAiceRun } from "./contract";
import { buildCurveComparison } from "./curvePlan";
import { sensorPreset, simulateKilnFrame } from "./kilnSimulation";
import { buildThicknessView } from "./thicknessView";

function projection(coating: "thin" | "target" | "thick") {
  return {
    thickness: buildThicknessView({ ware: "bowl", coating, meanMm: null }),
    curves: buildCurveComparison(coating),
    kiln: simulateKilnFrame({ minute: 320, sensors: sensorPreset("three"), coating }),
    version: "aice-integrated-v2",
  };
}

describe("AICE cross-view integration and provenance regression", () => {
  it("propagates one coating change through thickness, risk, curve, kiln and one run version", () => {
    const thin = projection("thin"); const thick = projection("thick");
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
