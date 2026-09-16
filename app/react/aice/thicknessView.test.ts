import { describe, expect, it } from "vitest";
import { SECTION_ASSETS, buildThicknessView } from "./thicknessView";

describe("thickness section model", () => {
  it("defines normalized assets for every ware preset", () => {
    expect(Object.keys(SECTION_ASSETS).sort()).toEqual(["bottle", "bowl", "cylinder_vase", "mug", "other", "plate", "tile"]);
    expect(Object.values(SECTION_ASSETS).every((asset) => asset.glazePaths.length === 3)).toBe(true);
  });

  it("keeps mass-only position values synthetic while preserving the mean estimate", () => {
    const view = buildThicknessView({ ware: "bowl", coating: "target", evidence: "mass_only", meanMm: .9 });
    expect(view.mean.valueMm).toBe(.9);
    expect(view.positionClaim).toBe("형상 기반 가상 분포");
    expect(view.segments.every((segment) => segment.sourceType === "synthetic")).toBe(true);
  });

  it("strengthens positions only with evidence and propagates coating changes", () => {
    const observed = buildThicknessView({ ware: "bowl", coating: "thick", evidence: "position_observed" });
    const thin = buildThicknessView({ ware: "bowl", coating: "thin", evidence: "mass_only" });
    expect(observed.segments.every((segment) => segment.sourceType === "observed")).toBe(true);
    expect(observed.risk).toContain("흘러내림");
    expect(observed.curveReason).not.toBe(thin.curveReason);
  });

  it("uses unavailable instead of safe when evidence is missing", () => {
    const view = buildThicknessView({ ware: "other", coating: "target", evidence: "unavailable", meanMm: null });
    expect(view.mean.label).toBe("판정 불가");
    expect(view.segments.every((segment) => segment.status === "unavailable")).toBe(true);
  });
});

