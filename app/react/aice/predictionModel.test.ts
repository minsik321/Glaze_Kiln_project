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
});
