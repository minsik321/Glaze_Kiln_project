import { describe, expect, it } from "vitest";
import { findSimilarHistory } from "./historyMatch";
import { sampleAiceRun } from "./contract";
import type { AiceRunRecord } from "../lib/api";
import type { RecipeCandidate } from "./contract";

function candidate(overrides: Partial<RecipeCandidate> = {}): RecipeCandidate {
  return {
    id: "cand-1",
    name: "테스트 후보",
    materials: { 장석: 40, 석회석: 20, 규석: 25, 카올린: 15 },
    colorants: {},
    colorant_note: "",
    predicted_firing_range: { value: [1180, 1230], unit: "°C", source_type: "inferred", confidence: 0.4, note: "" },
    predicted_firing_note: "",
    photo: { id: "photo-1", kind: "recipe", storage_path: null, placeholder: true, source_type: "synthetic", rights_confirmed: true, alt: "" },
    source_type: "inferred",
    source_ids: [],
    target_gloss: "SATIN",
    target_transparency: "OPAQUE",
    ...overrides,
  };
}

function record(overrides: Partial<{ id: string; title: string; promptText: string; candidates: RecipeCandidate[] }> = {}): AiceRunRecord {
  const run = sampleAiceRun();
  const title = overrides.title ?? "이전 질문";
  return {
    id: overrides.id ?? "run-1",
    title,
    run: {
      ...run,
      intake: {
        prompt_text: overrides.promptText ?? title,
        prompt_photos: [],
        candidates: { candidates: overrides.candidates ?? [candidate()], selected_id: null },
      },
    },
    schema_version: 3,
    status: run.status,
    goal_gloss: run.goal.gloss,
    goal_transparency: run.goal.transparency,
    recipe_id: run.recipe.id,
    ware_preset: run.ware.preset,
    is_public: false,
    created_at: run.created_at,
    updated_at: run.updated_at,
  };
}

describe("findSimilarHistory", () => {
  it("matches a past run when the new prompt shares keywords with it", () => {
    const history = [record({ title: "사발 청록 사틴 유약", promptText: "사발 청록 사틴 유약" })];
    const matches = findSimilarHistory("사발에 어울리는 청록 사틴 유약을 또 찾고 있어요", [], history);
    expect(matches).toHaveLength(1);
    expect(matches[0].runTitle).toBe("사발 청록 사틴 유약");
    expect(matches[0].matchedTerms.length).toBeGreaterThan(0);
    expect(matches[0].remark).toContain("사발 청록 사틴 유약");
  });

  it("matches a past run by target coordinate distance even without keyword overlap", () => {
    const history = [record({
      title: "예전 다른 표현",
      promptText: "완전히 다른 낱말들",
      candidates: [candidate({ id: "hist-1", target_gloss: "SATIN", target_transparency: "OPAQUE" })],
    })];
    const fresh = [candidate({ id: "fresh-1", target_gloss: "SATIN", target_transparency: "OPAQUE" })];
    const matches = findSimilarHistory("전혀 겹치지 않는 새 문장", fresh, history);
    expect(matches).toHaveLength(1);
    expect(matches[0].distance).toBe(0);
  });

  it("does not match unrelated history with neither keyword overlap nor close coordinates", () => {
    const history = [record({
      title: "무광 백색 항아리",
      promptText: "무광 백색 항아리 유약",
      candidates: [candidate({ id: "hist-2", target_gloss: "MATTE", target_transparency: "OPAQUE" })],
    })];
    const fresh = [candidate({ id: "fresh-2", target_gloss: "GLOSS", target_transparency: "TRANSPARENT" })];
    const matches = findSimilarHistory("청록 사틴 투명 유약을 찾아요", fresh, history);
    expect(matches).toHaveLength(0);
  });

  it("limits the number of returned matches", () => {
    const history = Array.from({ length: 5 }, (_, index) =>
      record({ id: `run-${index}`, title: `청록 사틴 유약 ${index}`, promptText: `청록 사틴 유약 ${index}` }));
    const matches = findSimilarHistory("청록 사틴 유약을 찾고 있어요", [], history, 2);
    expect(matches).toHaveLength(2);
  });
});
