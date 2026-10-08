import { describe, expect, it } from "vitest";
import { parseFiringRangeC, predictNextRun } from "./predictionModel";

describe("parseFiringRangeC", () => {
  it("extracts the two bounds from a display string", () => {
    expect(parseFiringRangeC("1180–1230 °C")).toEqual([1180, 1230]);
  });

  it("returns null when it cannot find two numbers", () => {
    expect(parseFiringRangeC("판정 불가")).toBeNull();
  });
});

describe("predictNextRun", () => {
  it("nudges the hold-temperature correction by ware size and firing range", () => {
    const large = predictNextRun({ coating: "target", ware: "cylinder_vase", recipeFiringRangeC: null, priorRunCount: 0 });
    const small = predictNextRun({ coating: "target", ware: "mug", recipeFiringRangeC: null, priorRunCount: 0 });
    expect(large.holdDeltaC).toBeLessThan(small.holdDeltaC);
  });

  it("dampens the correction as prior run count grows", () => {
    const first = predictNextRun({ coating: "target", ware: "bowl", recipeFiringRangeC: null, priorRunCount: 0 });
    const later = predictNextRun({ coating: "target", ware: "bowl", recipeFiringRangeC: null, priorRunCount: 4 });
    expect(Math.abs(later.holdDeltaC)).toBeLessThan(Math.abs(first.holdDeltaC));
  });

  it("never claims an observed prediction in its reason text", () => {
    const result = predictNextRun({ coating: "thick", ware: "bowl", recipeFiringRangeC: [1180, 1230], priorRunCount: 1 });
    expect(result.reason).toMatch(/실제 소성 결과를 예측하지 않습니다/);
  });

  it("lowers the suggested hold temperature when accumulated gloss bias is positive (overfired)", () => {
    const noBias = predictNextRun({ coating: "target", ware: "bowl", recipeFiringRangeC: null, priorRunCount: 0, firingGlossBiasLevel: null });
    const overfired = predictNextRun({ coating: "target", ware: "bowl", recipeFiringRangeC: null, priorRunCount: 0, firingGlossBiasLevel: 1 });
    expect(overfired.holdDeltaC).toBeLessThan(noBias.holdDeltaC);
    expect(overfired.reason).toMatch(/실측 광택 편향/);
  });

  it("raises the suggested hold temperature when accumulated gloss bias is negative (underfired)", () => {
    const noBias = predictNextRun({ coating: "target", ware: "bowl", recipeFiringRangeC: null, priorRunCount: 0, firingGlossBiasLevel: null });
    const underfired = predictNextRun({ coating: "target", ware: "bowl", recipeFiringRangeC: null, priorRunCount: 0, firingGlossBiasLevel: -1 });
    expect(underfired.holdDeltaC).toBeGreaterThan(noBias.holdDeltaC);
  });

  it("clamps an extreme bias to the correction limit instead of an unbounded swing", () => {
    const extreme = predictNextRun({ coating: "target", ware: "bowl", recipeFiringRangeC: null, priorRunCount: 0, firingGlossBiasLevel: 100 });
    const moderate = predictNextRun({ coating: "target", ware: "bowl", recipeFiringRangeC: null, priorRunCount: 0, firingGlossBiasLevel: 2 });
    expect(extreme.holdDeltaC).toBe(moderate.holdDeltaC);
  });

  it("omits the bias clause and leaves holdDeltaC unchanged when no bias has been observed yet", () => {
    const omitted = predictNextRun({ coating: "target", ware: "bowl", recipeFiringRangeC: null, priorRunCount: 0 });
    const explicitNull = predictNextRun({ coating: "target", ware: "bowl", recipeFiringRangeC: null, priorRunCount: 0, firingGlossBiasLevel: null });
    expect(omitted.holdDeltaC).toBe(explicitNull.holdDeltaC);
    expect(omitted.reason).not.toMatch(/실측 광택 편향/);
  });
});
