import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleAiceRun } from "../aice/contract";
import { AiceRecordsPanel } from "./AiceRecordsPanel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function record(id: string, title: string, generated = true) {
  const run = sampleAiceRun();
  run.title = title;
  run.intake = generated
    ? {
        prompt_text: title,
        prompt_photos: [],
        candidates: { candidates: [], selected_id: null },
      }
    : null;

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

describe("후보 생성 기록", () => {
  it("후보를 생성한 기록의 제목만 나열하고 클릭하면 복원한다", async () => {
    const generated = record("run-1", "청록 사틴 유약");
    const firingLog = record("run-2", "소성 테스트 기록", false);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ items: [generated, firingLog], limit: 20, offset: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const onRestore = vi.fn();

    render(<AiceRecordsPanel token="token" onRestore={onRestore} />);

    const title = await screen.findByRole("button", { name: "청록 사틴 유약" });
    expect(screen.queryByText("소성 테스트 기록")).toBeNull();
    expect(screen.queryByText(/공개|비공개|후보 ·|레시피|소성 결과/)).toBeNull();

    fireEvent.click(title);
    expect(onRestore).toHaveBeenCalledWith(generated.run);
  });

  it("생성 기록이 없으면 빈 목록 안내만 보여준다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [], limit: 20, offset: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    render(<AiceRecordsPanel token="token" />);

    expect(await screen.findByText("아직 생성한 유약 후보가 없습니다.")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
  });
});
