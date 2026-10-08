import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleAiceRun } from "../aice/contract";
import { ApiError, aiceRunsApi, recipeCandidatesApi, recipesApi } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("API client errors", () => {
  it("surfaces the backend's stable error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            code: "authentication_required",
            message: "로그인이 필요합니다.",
          },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );

    const failure = await aiceRunsApi
      .listMine("expired")
      .catch((error) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 401,
      code: "authentication_required",
      message: "로그인이 필요합니다.",
    });
  });
});

describe("AiceRun API client", () => {
  it("validates a create response without losing provenance", async () => {
    const run = sampleAiceRun();
    const response = { id: "run-1", title: run.title, run, schema_version: 3, status: run.status, goal_gloss: run.goal.gloss, goal_transparency: run.goal.transparency, recipe_id: run.recipe.id, ware_preset: run.ware.preset, is_public: false, created_at: run.created_at, updated_at: run.updated_at };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(response), { status: 201, headers: { "Content-Type": "application/json" } }));
    const saved = await aiceRunsApi.create("token", { title: run.title, run });
    expect(saved.run.sources).toEqual(run.sources);
    expect(saved.run.versions).toEqual(run.versions);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.run.schema_version).toBe(3);
  });

  it("sends all publication consent fields and supports withdrawal", async () => {
    const run = sampleAiceRun();
    const response = { id: "run-1", title: run.title, run, schema_version: 3, status: run.status, goal_gloss: run.goal.gloss, goal_transparency: run.goal.transparency, recipe_id: run.recipe.id, ware_preset: run.ware.preset, is_public: true, created_at: run.created_at, updated_at: run.updated_at };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } }));
    await aiceRunsApi.publish("token", "run-1", { photo_rights_confirmed: true, pii_reviewed: true, location_removed: true, withdrawal_understood: true });
    expect(fetchMock.mock.calls[0][0]).toContain("/aice-runs/run-1/publish");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ photo_rights_confirmed: true, pii_reviewed: true, location_removed: true, withdrawal_understood: true });
    await aiceRunsApi.withdraw("token", "run-1");
    expect(fetchMock.mock.calls[1][1]?.method).toBe("DELETE");
  });
});


describe("recipe candidates API client", () => {
  it("explains when the local backend is not running", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(recipeCandidatesApi.suggest("token", "유약")).rejects.toMatchObject({
      status: 0,
      code: "backend_unreachable",
      message: "후보 생성 서버에 연결할 수 없습니다. 개발 서버를 다시 실행해 주세요.",
    });
  });

  it("posts the prompt and candidate count, returns validated candidates", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          prompt_text: "청록색 사틴 유약",
          candidates: [{ id: "cand-1", name: "후보 1" }],
          dropped: ["cand-2: 목회는 원료 DB에 없다"],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await recipeCandidatesApi.suggest("token", "청록색 사틴 유약", 5);

    expect(fetchMock.mock.calls[0][0]).toContain("/aice/recipe-candidates");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      prompt_text: "청록색 사틴 유약",
      candidate_count: 5,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.dropped).toHaveLength(1);
  });

  it("requests a candidate image and returns base64", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ image_base64: "Zm9v", media_type: "image/webp" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await recipeCandidatesApi.image("token", {
      candidate_name: "후보 1",
      materials: { 장석: 40, 석회석: 20, 규석: 25, 카올린: 15 },
      style_note: "청록색",
    });

    expect(fetchMock.mock.calls[0][0]).toContain("/aice/recipe-candidates/image");
    expect(result.image_base64).toBe("Zm9v");
    expect(result.media_type).toBe("image/webp");
  });

  it("surfaces the backend error when the LLM call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ detail: { code: "aimlapi_unavailable", message: "aimlapi.com에 연결할 수 없습니다." } }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(recipeCandidatesApi.suggest("token", "유약")).rejects.toMatchObject({
      status: 502,
      code: "aimlapi_unavailable",
    });
  });
});

describe("recipe links", () => {
  it("forwards the recipe a run started from", async () => {
    const run = sampleAiceRun();
    const response = { id: "run-1", title: run.title, run, schema_version: 3, status: run.status, goal_gloss: run.goal.gloss, goal_transparency: run.goal.transparency, recipe_id: run.recipe.id, recipe_ref_id: "recipe-mine", ware_preset: run.ware.preset, is_public: false, created_at: run.created_at, updated_at: run.updated_at };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(response), { status: 201, headers: { "Content-Type": "application/json" } }));
    const saved = await aiceRunsApi.create("token", { title: run.title, run, recipe_ref_id: "recipe-original" });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).recipe_ref_id).toBe("recipe-original");
    expect(saved.recipe_ref_id).toBe("recipe-mine");
  });

  it("reads a recipe with its fork parent", async () => {
    const recipe = { id: "r2", name: "내 변형", materials: { 장석: 45 }, colorants: {}, composition_key: "glaze-v1-x", forked_from_id: "r1", forked_from: { id: "r1", name: "원본" }, is_public: false, is_mine: true, created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(recipe), { status: 200, headers: { "Content-Type": "application/json" } }));
    const got = await recipesApi.get("token", "r2");
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/recipes\/r2$/);
    expect(got.forked_from?.name).toBe("원본");
  });
});
