import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

function summary(id: string, title: string, kind: "completed" | "imported" | "draft" = "completed", createdAt = "2026-09-15T00:00:00.000Z") {
  return { id, title, status: kind === "completed" ? "evaluated" : "draft", origin: kind === "imported" ? "imported" : "mine", recipe_name: "청록", peak_c: 1230, created_at: createdAt };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
const page = (items: unknown[], offset = 0) => json({ items, limit: 20, offset });

describe("작업 기록", () => {
  it("완료 기록과 가져온 기록만 나열하고 출처를 구분한다", async () => {
    const full = record("run-1", "청록 사틴 유약");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input).includes("/aice-runs/summaries")
      ? page([summary("run-1", "청록 사틴 유약"), summary("run-2", "미라님의 동적유", "imported"), summary("run-3", "후보 생성 초안", "draft")])
      : json(full));
    const onOpen = vi.fn();

    render(<AiceRecordsPanel token="token" onOpen={onOpen} />);

    const title = await screen.findByRole("button", { name: "청록 사틴 유약 작업기록 열기" });
    expect(screen.getByText("내 완료 기록")).toBeTruthy();
    expect(screen.getByText("다른 사람의 작업")).toBeTruthy();
    expect(screen.getAllByText("청록 · 최고 1230℃")).toHaveLength(2);
    expect(screen.queryByText("후보 생성 초안")).toBeNull();

    fireEvent.click(title);
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith(full, "mine"));
  });

  it("작업 기록이 없으면 빈 목록 안내만 보여준다", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => page([]));

    render(<AiceRecordsPanel token="token" />);

    expect(await screen.findByText("아직 완료하거나 가져온 작업이 없습니다.")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("출처로 필터링하고 날짜와 이름으로 정렬한다", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => page([
      summary("run-2", "가 작업", "completed", "2026-09-01T00:00:00.000Z"),
      summary("run-3", "다 작업", "imported", "2026-09-10T00:00:00.000Z"),
      summary("run-1", "나 작업", "completed", "2026-09-20T00:00:00.000Z"),
    ]));

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

  it("첫 페이지만 불러오고 더 보기를 눌러야 다음 페이지를 이어 붙인다", async () => {
    const first = Array.from({ length: 20 }, (_, index) => summary(`run-${index}`, `기록 ${index}`));
    const second = [summary("run-20", "마지막 기록")];
    const respond = (items: unknown[], offset: number) => page(items, offset);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input).includes("offset=20") ? respond(second, 20) : respond(first, 0));

    render(<AiceRecordsPanel token="token" />);
    await screen.findByRole("button", { name: "기록 0 작업기록 열기" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "마지막 기록 작업기록 열기" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
    await screen.findByRole("button", { name: "마지막 기록 작업기록 열기" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "더 보기" })).toBeNull();
  });
});
