import { describe, expect, it } from "vitest";
import { buildCurveComparison, CONTROL_PLANS, curveSummary, simulateController, toFiringCurve } from "./curvePlan";

describe("curve comparison and synthetic control", () => {
  it("provides four distinct roles with a change annotation", () => {
    const curves = buildCurveComparison("thick");
    expect(curves.map((curve) => curve.role)).toEqual(["baseline", "adjusted", "actual", "next"]);
    expect(curves[1].annotation?.text).toMatch(/두꺼운/);
    expect(curveSummary(curves)).toMatch(/실제 에너지 차이는 판정 불가/);
  });

  it("is deterministic and exposes synchronized control samples", () => {
    const adjusted = buildCurveComparison("target")[1];
    const first = simulateController(adjusted, "balanced");
    expect(first).toEqual(simulateController(adjusted, "balanced"));
    expect(first[0]).toEqual(expect.objectContaining({ minute: 0, plannedC: 20, sensorC: expect.any(Number), estimatedWareC: expect.any(Number), heaterPercent: expect.any(Number) }));
  });

  it("marks all gains as synthetic and only turns an approved candidate into selected", () => {
    expect(Object.values(CONTROL_PLANS.fast.parameters).every((value) => value.source_type === "synthetic")).toBe(true);
    const candidate = buildCurveComparison("thin")[1];
    expect(toFiringCurve(candidate, false).role).toBe("candidate");
    expect(toFiringCurve(candidate, true).role).toBe("selected");
  });
});
