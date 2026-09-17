import { describe, expect, it } from "vitest";
import { AICE_SCHEMA_VERSION, SOURCE_TYPES, aiceRunToLegacyWorkRecord, assertAiceRun, legacyWorkRecordToAiceRun, sampleAiceRun, validateAiceRun } from "./contract";

describe("AiceRun frontend contract", () => {
  it("round-trips the deterministic sample without losing versions or provenance", () => {
    const sample = sampleAiceRun();
    const restored: unknown = JSON.parse(JSON.stringify(sample));
    assertAiceRun(restored);
    expect(restored).toEqual(sample);
    expect(restored.schema_version).toBe(AICE_SCHEMA_VERSION);
    expect(restored.sources[0].source_type).toBe("literature");
    expect(restored.versions.predictor).toBeNull();
  });

  it("keeps the exact six source types and rejects masquerading values", () => {
    expect(SOURCE_TYPES).toEqual(["observed", "patent_example", "patent_range", "literature", "inferred", "synthetic"]);
    const sample = sampleAiceRun() as unknown as Record<string, unknown>;
    sample.sources = [{ source_type: "measured", limitation: "" }];
    expect(validateAiceRun(sample)).toContain("sources are invalid");
  });

  it("converts legacy records without presenting missing fields as observed", () => {
    const run = legacyWorkRecordToAiceRun({ id: "old-1", title: "Old", payload: { cone: 6 } });
    expect(run.run_id).toBe("old-1");
    expect(run.schema_version).toBe(2);
    expect(run.sources.at(-1)?.source_type).toBe("inferred");
    expect(run.thickness.mean.value).toBeNull();
    const legacy = aiceRunToLegacyWorkRecord(run);
    expect(legacy.schema_version).toBe(1);
    expect(legacy.is_public).toBe(false);
    expect(legacy.payload.compatibility).toBe("read_only");
  });
});
