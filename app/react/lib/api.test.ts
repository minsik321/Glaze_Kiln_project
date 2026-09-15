import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, recordsApi } from "./api";

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
