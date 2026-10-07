import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleAiceRun } from "../aice/contract";
import { RecordsPanel } from "./RecordsPanel";

//: 실제 AuthProvider처럼 세션 객체는 렌더 사이에 같은 참조를 유지한다.
const SESSION = { access_token: "token" };
vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ session: SESSION }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("작업 기록 상세", () => {
  it("목록에서 기록 상세를 열고 시작 버튼으로 선택한 기록을 전달한다", async () => {
    const run = sampleAiceRun();
    run.title = "청록 사틴 유약";
    run.status = "evaluated";
    run.result = {
      ...run.result,
      match: "close",
      color: "close",
      gloss: "satin",
      texture: "smooth",
      transparency: "opaque",
      defects: ["pinholes"],
      defects_reviewed: true,
      defect_severities: { pinholes: 3 },
      gloss_comparison: "match",
      texture_comparison: "less",
      transparency_comparison: "match",
    };
    const record = {
      id: "run-1",
      title: run.title,
      run,
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
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ items: [record], limit: 20, offset: 0 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    const onStart = vi.fn();
    const onDetailOpenChange = vi.fn();

    render(<RecordsPanel onStart={onStart} onDetailOpenChange={onDetailOpenChange} />);
    fireEvent.click(await screen.findByRole("button", { name: "청록 사틴 유약 작업기록 열기" }));

    expect(onDetailOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByText("저장된 작업을 확인해요")).toBeNull();
    expect(screen.queryByText("레시피와 이전 소성 기록을 확인한 뒤 같은 흐름으로 새 작업을 시작합니다.")).toBeNull();
    expect(screen.getByRole("heading", { name: "유약 레시피" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "소성 방법" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "이전 작업 기록" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "결과 관찰 기록" })).toBeTruthy();
    expect(screen.getByText("핀홀 3단계")).toBeTruthy();
    expect(screen.getByText("비교적 매끈함")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "이 기록으로 작업 시작" }));
    expect(onDetailOpenChange).toHaveBeenCalledWith(false);
    expect(onStart).toHaveBeenCalledWith(run, "mine", null);
  });

  it("확인 후 본인 작업기록을 삭제하고 목록을 갱신한다", async () => {
    const run = sampleAiceRun();
    run.title = "삭제할 작업";
    run.status = "evaluated";
    const record = {
      id: "run-to-delete", title: run.title, run, schema_version: 3, status: run.status,
      goal_gloss: run.goal.gloss, goal_transparency: run.goal.transparency,
      recipe_id: run.recipe.id, ware_preset: run.ware.preset, is_public: false,
      created_at: run.created_at, updated_at: run.updated_at,
    };
    let deleted = false;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "DELETE") {
        deleted = true;
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ items: deleted ? [] : [record], limit: 20, offset: 0 }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    });

    render(<RecordsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "삭제할 작업 작업기록 열기" }));
    fireEvent.click(screen.getByRole("button", { name: "작업기록 삭제" }));
    expect(screen.getByRole("dialog", { name: "작업기록을 삭제할까요?" })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "작업기록 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: /^삭제$/ }));

    await screen.findByText("아직 완료하거나 가져온 작업이 없습니다.");
    const deletion = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
    expect(deletion?.[0]).toContain("/aice-runs/run-to-delete");
    expect(new Headers(deletion?.[1]?.headers).get("Authorization")).toBe("Bearer token");
  });

  it("삭제 요청이 실패하면 확인 창에 오류를 보여주고 기록을 유지한다", async () => {
    const run = sampleAiceRun();
    run.title = "보존할 작업";
    run.status = "evaluated";
    const record = {
      id: "run-keep", title: run.title, run, schema_version: 3, status: run.status,
      goal_gloss: run.goal.gloss, goal_transparency: run.goal.transparency,
      recipe_id: run.recipe.id, ware_preset: run.ware.preset, is_public: false,
      created_at: run.created_at, updated_at: run.updated_at,
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => init?.method === "DELETE"
      ? new Response(JSON.stringify({ detail: { message: "삭제 권한이 없습니다." } }), { status: 403, headers: { "Content-Type": "application/json" } })
      : new Response(JSON.stringify({ items: [record], limit: 20, offset: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }));

    render(<RecordsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "보존할 작업 작업기록 열기" }));
    fireEvent.click(screen.getByRole("button", { name: "작업기록 삭제" }));
    fireEvent.click(screen.getByRole("button", { name: /^삭제$/ }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("삭제 권한이 없습니다."));
    expect(screen.getByRole("heading", { name: "결과 관찰 기록" })).toBeTruthy();
  });

  it("내 완료 기록 상세의 작업 게시 버튼이 그 기록을 전달한다", async () => {
    const run = sampleAiceRun();
    run.title = "게시할 유약";
    run.status = "evaluated";
    const record = { id: "run-9", title: run.title, run, schema_version: 3, status: run.status, goal_gloss: run.goal.gloss, goal_transparency: run.goal.transparency, recipe_id: run.recipe.id, ware_preset: run.ware.preset, is_public: false, created_at: run.created_at, updated_at: run.updated_at };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ items: [record], limit: 20, offset: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const onPublish = vi.fn();

    render(<RecordsPanel onPublish={onPublish} />);
    fireEvent.click(await screen.findByRole("button", { name: "게시할 유약 작업기록 열기" }));
    fireEvent.click(screen.getByRole("button", { name: "작업 게시" }));

    expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({ id: "run-9" }));
  });

  it("상세 폼에서 바로 제목·메모·결과 관찰을 고쳐 저장하고 다음 시도 제안을 다시 불러온다", async () => {
    const run = sampleAiceRun();
    run.title = "수정할 작업";
    run.status = "evaluated";
    run.result = { ...run.result, match: "close", color: "close", gloss: "satin", texture: "smooth", transparency: "opaque", defects: [], defects_reviewed: true, gloss_comparison: "match", texture_comparison: "match", transparency_comparison: "match" };
    const record = { id: "run-edit", title: run.title, run, schema_version: 3, status: run.status, goal_gloss: run.goal.gloss, goal_transparency: run.goal.transparency, recipe_id: run.recipe.id, ware_preset: run.ware.preset, is_public: false, created_at: run.created_at, updated_at: run.updated_at };
    let patchBody: { title?: string; memo?: string; result?: { texture_comparison?: string; defects?: string[] } } | null = null;
    let nextTrialCalls = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ ...record, title: patchBody!.title, run: { ...run, title: patchBody!.title, memo: patchBody!.memo, result: { ...run.result, ...patchBody!.result } } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/next-trial")) {
        nextTrialCalls += 1;
        return new Response("null", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ items: [record], limit: 20, offset: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    render(<RecordsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "수정할 작업 작업기록 열기" }));
    await waitFor(() => expect(nextTrialCalls).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "수정" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.change(screen.getByLabelText("작업 제목"), { target: { value: "고친 제목" } });
    fireEvent.change(screen.getByLabelText("메모"), { target: { value: "다음엔 얇게" } });
    fireEvent.change(screen.getByLabelText("질감"), { target: { value: "more" } });
    fireEvent.click(screen.getByRole("button", { name: "핀홀" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.getByText("고친 제목")).toBeTruthy());
    expect(patchBody).toMatchObject({ title: "고친 제목", memo: "다음엔 얇게", result: { texture_comparison: "more", defects: ["pinholes"] } });
    expect(fetchMock.mock.calls.some(([input, init]) => init?.method === "PATCH" && String(input).includes("/aice-runs/run-edit"))).toBe(true);
    await waitFor(() => expect(nextTrialCalls).toBe(2));
    expect(screen.getByText("다음엔 얇게")).toBeTruthy();
  });
});
