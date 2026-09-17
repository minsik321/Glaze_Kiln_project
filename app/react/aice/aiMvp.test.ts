import { describe, expect, it } from "vitest";
import { EVIDENCE_CARDS, generateSyntheticScenario, MVP_TRAINING_GATE, productPredictorStatus, rankRecommendations } from "./aiMvp";

describe("patent and literature rule/RAG MVP", () => {
  it("structures four patents and non-patent references without copied media", () => {
    expect(EVIDENCE_CARDS.filter((card) => card.publication.match(/^(TW|CN|US|DE)/))).toHaveLength(4);
    expect(EVIDENCE_CARDS.every((card) => card.locator && card.originalCondition && card.conversion && card.interpretation && card.limitation)).toBe(true);
    expect(JSON.stringify(EVIDENCE_CARDS)).not.toMatch(/image|photo|사진 경로|storage_path/);
  });

  it("reproduces ranking for the same input and version with explicit origins", () => {
    const input = { goal: "satin-blue", clayBody: "white-stoneware", version: "test-rule-1" };
    const first = rankRecommendations(input);
    expect(first).toEqual(rankRecommendations(input));
    expect(first[0]).toMatchObject({ recipeId: "coastal-satin", origins: expect.arrayContaining(["rule"]), modelVersion: "test-rule-1" });
    expect(first.every((result) => !result.origins.includes("trained_model"))).toBe(true);
  });

  it("blocks product training and uses a structurally separate deterministic generator", () => {
    expect(MVP_TRAINING_GATE).toMatchObject({ passed: false, decision: "blocked" });
    expect(productPredictorStatus()).toMatchObject({ enabled: false, version: null });
    expect(generateSyntheticScenario(42)).toEqual(generateSyntheticScenario(42));
    expect(generateSyntheticScenario(42)).not.toEqual(generateSyntheticScenario(43));
  });
});
