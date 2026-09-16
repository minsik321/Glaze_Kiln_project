import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleAiceRun } from "../aice/contract";
import { ApiError, aiceRunsApi, recordsApi } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("records API client", () => {
  it("sends the user bearer token and versioned snapshot", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "record-1",
          title: "첫 소성",
          payload: { run: 1 },
          schema_version: 1,
          is_public: false,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );

    await recordsApi.create("user-token", {
      title: "첫 소성",
      payload: { run: 1 },
      is_public: false,
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer user-token",
    );
    expect(JSON.parse(String(init?.body))).toMatchObject({
      schema_version: 1,
      is_public: false,
    });
  });

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

    const failure = await recordsApi
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
    const response = { id: "run-1", title: run.title, run, schema_version: 2, status: run.status, goal_gloss: run.goal.gloss, goal_transparency: run.goal.transparency, recipe_id: run.recipe.id, ware_preset: run.ware.preset, is_public: false, created_at: run.created_at, updated_at: run.updated_at };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(response), { status: 201, headers: { "Content-Type": "application/json" } }));
    const saved = await aiceRunsApi.create("token", { title: run.title, run });
    expect(saved.run.sources).toEqual(run.sources);
    expect(saved.run.versions).toEqual(run.versions);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.run.schema_version).toBe(2);
  });
});
