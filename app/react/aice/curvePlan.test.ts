import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCurveComparison, SCENARIO_CONTROL_PLANS, curveSummary, simulateController, toFiringCurve } from "./curvePlan";

function mockSimulateResponse() {
  return new Response(
    JSON.stringify({
      samples: [
        { t_s: 0, minute: 0, sensor_c: 20, ware_c: 20, power_w: 0, phase: "승온", outer_mode: "감시", hold_extension_s: 0, message: "", paused: false },
        { t_s: 18000, minute: 300, sensor_c: 950, ware_c: 940, power_w: 5000, phase: "유지", outer_mode: "능동", hold_extension_s: 0, message: "", paused: false },
        { t_s: 28800, minute: 480, sensor_c: 640, ware_c: 650, power_w: 0, phase: "냉각", outer_mode: "감시", hold_extension_s: 0, message: "", paused: false },
      ],
      provenance_notes: ["12-2절: 생성기는 추정 모델과 구조적으로 다르게 오지정되어 있다"],
      e_note: "E=300000 J/mol (미정값 · 가정: 9-5절 외측 루프 운용을 위한 가정)",
      target_heat_work: 1.0,
      peak_c: 1199,
      max_power_w: 6000,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("curve comparison and real controller wiring", () => {
  it("provides four distinct roles with a change annotation", () => {
    const curves = buildCurveComparison("thick");
    expect(curves.map((curve) => curve.role)).toEqual(["baseline", "adjusted", "actual", "next"]);
    expect(curves[1].annotation?.text).toMatch(/두꺼운/);
    expect(curveSummary(curves)).toMatch(/실제 에너지 차이는 판정 불가/);
  });

  it("calls kiln.firing.simulate and maps the response into synchronized control samples", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => mockSimulateResponse());
    const adjusted = buildCurveComparison("target")[1];
    const sensorBiasPlan = SCENARIO_CONTROL_PLANS.sensor_bias;
    const run = await simulateController(adjusted, sensorBiasPlan.disturbance, sensorBiasPlan.constraints.sampleSeconds);

    expect(String(fetchMock.mock.calls[0][0])).toContain("/kiln/firing/simulate");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.schedule).toEqual(adjusted.points.map((point) => [point.minute, point.temperatureC]));
    expect(body.disturbance).toEqual(sensorBiasPlan.disturbance);

    expect(run.eNote).toContain("9-5절 외측 루프 운용을 위한 가정");
    expect(run.provenanceNotes.length).toBeGreaterThan(0);
    expect(run.samples[0]).toEqual(expect.objectContaining({ minute: 0, plannedC: 20, sensorC: 20, estimatedWareC: 20, heaterPercent: 0 }));
    expect(run.samples[1].heaterPercent).toBeCloseTo((5000 / 6000) * 100, 1);
  });

  it("marks disturbance parameters as synthetic and only turns an approved candidate into selected", () => {
    expect(Object.values(SCENARIO_CONTROL_PLANS.normal.parameters).every((value) => value.source_type === "synthetic")).toBe(true);
    const candidate = buildCurveComparison("thin")[1];
    expect(toFiringCurve(candidate, false).role).toBe("candidate");
    expect(toFiringCurve(candidate, true).role).toBe("selected");
  });
});
