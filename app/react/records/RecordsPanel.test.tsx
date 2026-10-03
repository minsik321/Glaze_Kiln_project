import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleAiceRun } from "../aice/contract";
import { RecordsPanel } from "./RecordsPanel";

vi.mock("../auth/AuthProvider", () => ({
  useAuth: () => ({ session: { access_token: "token" } }),
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
    expect(onStart).toHaveBeenCalledWith(run, "mine");
  });
});
