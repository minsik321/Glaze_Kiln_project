import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleAiceRun } from "../aice/contract";
import { AiceRecordsPanel } from "./AiceRecordsPanel";
import { FEED_IMPORT_SOURCE_REFERENCE } from "./workRecords";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function record(id: string, title: string, kind: "completed" | "imported" | "draft" = "completed") {
  const run = sampleAiceRun();
  run.title = title;
  run.status = kind === "completed" ? "evaluated" : "draft";
  if (kind === "imported") run.sources.push({ source_type: "observed", reference: FEED_IMPORT_SOURCE_REFERENCE, limitation: "테스트", confidence: "medium" });

  return {
    id,
    title,
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
}

describe("작업 기록", () => {
  it("완료 기록과 가져온 기록만 나열하고 출처를 구분한다", async () => {
    const completed = record("run-1", "청록 사틴 유약");
    const imported = record("run-2", "미라님의 동적유", "imported");
    const draft = record("run-3", "후보 생성 초안", "draft");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ items: [completed, imported, draft], limit: 20, offset: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const onOpen = vi.fn();

    render(<AiceRecordsPanel token="token" onOpen={onOpen} />);

    const title = await screen.findByRole("button", { name: "청록 사틴 유약 작업기록 열기" });
    expect(screen.getByText("내 완료 기록")).toBeTruthy();
    expect(screen.getByText("다른 사람의 작업")).toBeTruthy();
    expect(screen.queryByText("후보 생성 초안")).toBeNull();

    fireEvent.click(title);
    expect(onOpen).toHaveBeenCalledWith(completed, "mine");
  });

  it("작업 기록이 없으면 빈 목록 안내만 보여준다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [], limit: 20, offset: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<AiceRecordsPanel token="token" />);

    expect(await screen.findByText("아직 완료하거나 가져온 작업이 없습니다.")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("출처로 필터링하고 날짜와 이름으로 정렬한다", async () => {
    const newestMine = record("run-1", "나 작업");
    newestMine.created_at = "2026-09-20T00:00:00.000Z";
    const oldestMine = record("run-2", "가 작업");
    oldestMine.created_at = "2026-09-01T00:00:00.000Z";
    const imported = record("run-3", "다 작업", "imported");
    imported.created_at = "2026-09-10T00:00:00.000Z";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ items: [oldestMine, imported, newestMine], limit: 20, offset: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(<AiceRecordsPanel token="token" />);
    await screen.findByRole("button", { name: "나 작업 작업기록 열기" });

    expect(screen.getByRole("button", { name: "전체" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("button", { name: /작업 작업기록 열기/ }).map((button) => button.getAttribute("aria-label"))).toEqual([
      "나 작업 작업기록 열기",
      "다 작업 작업기록 열기",
      "가 작업 작업기록 열기",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "불러온 작업" }));
    expect(screen.getByRole("button", { name: "다 작업 작업기록 열기" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "나 작업 작업기록 열기" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "전체" }));
    fireEvent.change(screen.getByRole("combobox", { name: "작업 기록 정렬" }), { target: { value: "title-asc" } });
    expect(screen.getAllByRole("button", { name: /작업 작업기록 열기/ }).map((button) => button.getAttribute("aria-label"))).toEqual([
      "가 작업 작업기록 열기",
      "나 작업 작업기록 열기",
      "다 작업 작업기록 열기",
    ]);
  });
});
