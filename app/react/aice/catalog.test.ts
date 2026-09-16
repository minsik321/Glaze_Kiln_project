import { describe, expect, it } from "vitest";
import { RECIPE_CANDIDATES, WARE_CATALOG } from "./catalog";

describe("selection catalogs", () => {
  it("contains the seven required ware choices including other", () => {
    expect(WARE_CATALOG.map((item) => item.label)).toEqual(["사발", "접시", "컵/머그", "원통 화병", "병", "타일/평판", "기타"]);
    expect(new Set(WARE_CATALOG.map((item) => item.id)).size).toBe(7);
  });

  it("limits comparison to three honest placeholders", () => {
    expect(RECIPE_CANDIDATES.length).toBeLessThanOrEqual(3);
    expect(RECIPE_CANDIDATES.every((candidate) => !candidate.photoAvailable)).toBe(true);
    expect(RECIPE_CANDIDATES.every((candidate) => candidate.uncertainty && candidate.risk)).toBe(true);
  });
});

