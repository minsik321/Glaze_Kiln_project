import { describe, expect, it } from "vitest";
import { normalizeGlossLevel, normalizeTransparencyLevel } from "./targetCoordinate";

describe("target coordinate normalization", () => {
  it("normalizes API and legacy spellings", () => {
    expect(normalizeGlossLevel("SEMI-GLOSS")).toBe("semi_gloss");
    expect(normalizeTransparencyLevel(" semi opaque ")).toBe("semi_opaque");
  });

  it("does not let unknown values reach a completed run", () => {
    expect(normalizeGlossLevel("unknown")).toBeNull();
    expect(normalizeTransparencyLevel(undefined)).toBeNull();
  });
});
