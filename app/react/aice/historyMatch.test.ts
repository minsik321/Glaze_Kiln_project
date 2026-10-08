import { describe, expect, it } from "vitest";
import { completedRunCandidate, dedupeByRecipe, findSimilarHistory, recipeKey } from "./historyMatch";
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

type RecordOptions = {
  id?: string;
  title?: string;
  promptText?: string;
  status?: "draft" | "simulated" | "evaluated";
  resultGloss?: string | null;
  resultTransparency?: string | null;
  goalGloss?: "dry" | "matte" | "satin" | "semi_gloss" | "gloss";
  goalTransparency?: "opaque" | "semi_opaque" | "translucent" | "transparent";
  materials?: Record<string, number>;
};

//: 기본값은 "끝까지 작업해 결과를 기록한" 내 기록이다.
function record(options: RecordOptions = {}): AiceRunRecord {
  const run = sampleAiceRun();
  const title = options.title ?? "이전 작업";
  return {
    id: options.id ?? "run-1",
    title,
    run: {
      ...run,
      title,
      status: options.status ?? "evaluated",
      goal: { ...run.goal, gloss: options.goalGloss ?? "satin", transparency: options.goalTransparency ?? "opaque" },
      recipe: { ...run.recipe, name: title, materials: options.materials ?? run.recipe.materials },
      result: {
        ...run.result,
        gloss: options.resultGloss === undefined ? "satin" : options.resultGloss,
        transparency: options.resultTransparency === undefined ? "opaque" : options.resultTransparency,
      },
      intake: options.promptText === undefined ? null : {
        prompt_text: options.promptText,
        prompt_photos: [],
        candidates: { candidates: [candidate()], selected_id: null },
      },
    },
    schema_version: 3,
    status: options.status ?? "evaluated",
    goal_gloss: run.goal.gloss,
    goal_transparency: run.goal.transparency,
    recipe_id: run.recipe.id,
    ware_preset: run.ware.preset,
    is_public: false,
    created_at: run.created_at,
    updated_at: run.updated_at,
  };
}

describe("completedRunCandidate", () => {
  it("uses the recorded result coordinate, not the goal", () => {
    const converted = completedRunCandidate(record({ goalGloss: "matte", resultGloss: "gloss", resultTransparency: "transparent" }));
    expect(converted?.target_gloss).toBe("GLOSS");
    expect(converted?.target_transparency).toBe("TRANSPARENT");
  });

  it("falls back to the goal when no result was recorded", () => {
    const converted = completedRunCandidate(record({ goalGloss: "matte", resultGloss: null, resultTransparency: null }));
    expect(converted?.target_gloss).toBe("MATTE");
    expect(converted?.target_transparency).toBe("OPAQUE");
  });

  it("skips drafts and records without a stored recipe", () => {
    expect(completedRunCandidate(record({ status: "draft" }))).toBeNull();
    expect(completedRunCandidate(record({ materials: {} }))).toBeNull();
  });
});

describe("findSimilarHistory", () => {
  it("ignores AI-generated drafts that were never worked through", () => {
    const history = [record({ status: "draft", title: "청록 사틴 사발", promptText: "청록 사틴 사발" })];
    const fresh = [candidate({ target_gloss: "SATIN", target_transparency: "OPAQUE" })];
    expect(findSimilarHistory("청록 사틴 사발", fresh, history)).toHaveLength(0);
  });

  it("matches a completed record by the result coordinate close to the new target", () => {
    const history = [record({ title: "예전 다른 표현", resultGloss: "satin", resultTransparency: "opaque" })];
    const fresh = [candidate({ id: "fresh-1", materials: { 장석: 10, 규석: 60, 석회석: 10, 카올린: 20 }, target_gloss: "SATIN", target_transparency: "OPAQUE" })];
    const matches = findSimilarHistory("전혀 겹치지 않는 새 문장", fresh, history);
    expect(matches).toHaveLength(1);
    expect(matches[0].distance).toBe(0);
    expect(matches[0].candidate.id).toBe("completed-run-1");
    expect(matches[0].remark).toContain("끝까지 작업해 기록한");
  });

  it("drops a completed record whose result is far from the new target even if keywords overlap", () => {
    const history = [record({ title: "청록 사틴 유약", promptText: "청록 사틴 유약", resultGloss: "gloss", resultTransparency: "transparent" })];
    const fresh = [candidate({ target_gloss: "SATIN", target_transparency: "OPAQUE" })];
    expect(findSimilarHistory("청록 사틴 유약을 찾아요", fresh, history)).toHaveLength(0);
  });

  it("matches by keywords when the new candidates have no comparable coordinate", () => {
    const history = [record({ title: "사발 청록 사틴 유약", promptText: "사발 청록 사틴 유약" })];
    const matches = findSimilarHistory("사발에 어울리는 청록 사틴 유약을 또 찾고 있어요", [], history);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedTerms.length).toBeGreaterThanOrEqual(2);
  });

  it("does not match on generic words alone", () => {
    const history = [record({ title: "유약 레시피 추천", promptText: "유약 레시피 추천 부탁해요" })];
    expect(findSimilarHistory("유약 레시피 추천해 주세요", [], history)).toHaveLength(0);
  });

  it("needs two shared keywords when coordinates cannot be compared", () => {
    const history = [record({ title: "청록 사발", promptText: "청록 사발" })];
    expect(findSimilarHistory("청록 느낌 머그", [], history)).toHaveLength(0);
  });

  it("ranks closer coordinates first and limits the result count", () => {
    const history = [
      record({ id: "r1", title: "하나", materials: { 장석: 50, 규석: 30, 석회석: 10, 카올린: 10 }, resultGloss: "semi_gloss", resultTransparency: "opaque" }),
      record({ id: "r2", title: "둘", materials: { 장석: 40, 규석: 30, 석회석: 20, 카올린: 10 }, resultGloss: "satin", resultTransparency: "opaque" }),
      record({ id: "r3", title: "셋", materials: { 장석: 30, 규석: 30, 석회석: 30, 카올린: 10 }, resultGloss: "matte", resultTransparency: "opaque" }),
    ];
    const fresh = [candidate({ materials: { 장석: 10, 규석: 60, 석회석: 10, 카올린: 20 }, target_gloss: "SATIN", target_transparency: "OPAQUE" })];
    const matches = findSimilarHistory("전혀 다른 요청", fresh, history, 2);
    expect(matches.map((match) => match.runId)).toEqual(["r2", "r1"]);
  });
});

describe("recipe de-duplication", () => {
  const other = { 장석: 30, 규석: 30, 석회석: 20, 카올린: 20 };

  it("treats the same blend as one recipe regardless of name, scale or tiny rounding", () => {
    const a = candidate({ id: "a", name: "A", materials: { 장석: 40, 석회석: 20, 규석: 25, 카올린: 15 } });
    const b = candidate({ id: "b", name: "B", materials: { 규석: 25.2, 장석: 39.8, 카올린: 15, 석회석: 20 } });
    const scaled = candidate({ id: "c", materials: { 장석: 80, 석회석: 40, 규석: 50, 카올린: 30 } });
    expect(recipeKey(a)).toBe(recipeKey(b));
    expect(recipeKey(a)).toBe(recipeKey(scaled));
    expect(recipeKey(a)).not.toBe(recipeKey(candidate({ materials: other })));
    expect(recipeKey(a)).not.toBe(recipeKey(candidate({ colorants: { 산화철: 2 } })));
  });

  it("keeps only the closest of several past runs that used the same blend", () => {
    const history = [
      record({ id: "run-far", title: "같은 배합 먼 결과", materials: other, resultGloss: "semi_gloss", resultTransparency: "opaque" }),
      record({ id: "run-near", title: "같은 배합 가까운 결과", materials: other, resultGloss: "satin", resultTransparency: "opaque" }),
    ];
    const fresh = [candidate({ materials: { 장석: 10, 규석: 60, 석회석: 10, 카올린: 20 }, target_gloss: "SATIN", target_transparency: "OPAQUE" })];
    const matches = findSimilarHistory("새 문장", fresh, history);
    expect(matches.map((m) => m.runId)).toEqual(["run-near"]);
  });

  it("does not repeat a past record whose blend the AI just proposed again", () => {
    const history = [record({ id: "run-same", materials: other, resultGloss: "satin", resultTransparency: "opaque" })];
    const fresh = [candidate({ id: "fresh-1", materials: other, target_gloss: "SATIN", target_transparency: "OPAQUE" })];
    expect(findSimilarHistory("새 문장", fresh, history)).toHaveLength(0);
  });

  it("dedupeByRecipe keeps the first occurrence and honours already-seen keys", () => {
    expect(dedupeByRecipe(["a", "b", "a", "c"], (x) => x, ["c"])).toEqual(["a", "b"]);
  });
});
