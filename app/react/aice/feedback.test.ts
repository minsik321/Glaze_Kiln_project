import { describe, expect, it } from "vitest";
import { sampleAiceRun } from "./contract";
import { canPublish, feedbackTrace, transformSharedCurve, type ResultEvaluation } from "./feedback";

const evaluation: ResultEvaluation = { match: "different", color: "darker", gloss: "satin", texture: "smooth", transparency: "opaque", defects: ["pinholes"], scope: "common_candidate" };

describe("feedback and sharing boundaries", () => {
  it("never applies common feedback automatically", () => {
    expect(feedbackTrace(evaluation)).toMatchObject({ sourceType: "observed", scope: "common_candidate", automaticCommonUpdate: false });
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
