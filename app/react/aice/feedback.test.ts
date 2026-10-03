import { describe, expect, it } from "vitest";
import { sampleAiceRun } from "./contract";
import { canPublish, feedbackTrace, resolveGlossObservation, resolveTransparencyObservation, transformSharedCurve, type ResultEvaluation } from "./feedback";

const evaluation: ResultEvaluation = { match: "different", color: "darker", gloss: "less", texture: "match", transparency: "much_less", defects: ["pinholes"], defectSeverities: { pinholes: 3 }, scope: "common_candidate", resultPhoto: null };

describe("feedback and sharing boundaries", () => {
  it("never applies common feedback automatically", () => {
    expect(feedbackTrace(evaluation)).toMatchObject({ sourceType: "observed", scope: "common_candidate", automaticCommonUpdate: false });
  });

  it("resolves target-relative answers to persisted observation levels", () => {
    expect(resolveGlossObservation("satin", "much_less")).toBe("dry");
    expect(resolveGlossObservation("satin", "more")).toBe("semi_gloss");
    expect(resolveTransparencyObservation("semi_opaque", "much_more")).toBe("transparent");
  });

  it("requires every consent check before publication", () => {
    expect(canPublish({ photoRights: true, piiReviewed: true, locationRemoved: true, withdrawalUnderstood: false })).toBe(false);
    expect(canPublish({ photoRights: true, piiReviewed: true, locationRemoved: true, withdrawalUnderstood: true })).toBe(true);
  });

  it("transforms a shared curve into an inferred candidate instead of copying it", () => {
    const source = sampleAiceRun().curves.baseline;
    const transformed = transformSharedCurve(source, { sourceKilnProfile: "shared-kiln", targetKilnProfile: "my-kiln", targetLoad: "dense" });
    expect(transformed.id).not.toBe(source.id);
    expect(transformed.source_type).toBe("inferred");
    expect(transformed.role).toBe("candidate");
    expect(transformed.reason).toMatch(/복사하지 않고.*재시뮬레이션 필요/);
  });
});
