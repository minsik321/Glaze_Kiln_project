import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleAiceRun } from "../aice/contract";
import { AiceRecordsPanel } from "./AiceRecordsPanel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function record(isPublic = false) {
  const run = sampleAiceRun();
  return { id: "run-1", title: run.title, run, schema_version: 2, status: run.status, goal_gloss: run.goal.gloss, goal_transparency: run.goal.transparency, recipe_id: run.recipe.id, ware_preset: run.ware.preset, is_public: isPublic, created_at: run.created_at, updated_at: run.updated_at };
}

describe("AiceRun records", () => {
  it("lists details, paginates, and restores a validated run", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ items: [record()], limit: 20, offset: 0 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const onRestore = vi.fn();
    render(<AiceRecordsPanel token="token" onRestore={onRestore} />);
    fireEvent.click(await screen.findByRole("button", { name: /사틴 청색 사발 샘플/ }));
    expect(screen.getByText(/aice-sample-1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "이 실행 복원" }));
    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ schema_version: 2 }));
    expect(screen.getByRole("button", { name: "다음 20개" }).hasAttribute("disabled")).toBe(true);
  });

  it("keeps publish disabled until every consent is checked", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith("/publish")) return new Response(JSON.stringify(record(true)), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ items: [record()], limit: 20, offset: 0 }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    render(<AiceRecordsPanel token="token" />);
    fireEvent.click(await screen.findByRole("button", { name: /사틴 청색 사발 샘플/ }));
    const publish = screen.getByRole("button", { name: "동의 확인 후 공개" });
    expect(publish.hasAttribute("disabled")).toBe(true);
    for (const label of [/사진 권리를/, /개인정보를/, /위치정보를/, /철회 시/]) fireEvent.click(screen.getByLabelText(label));
    expect(publish.hasAttribute("disabled")).toBe(false);
    fireEvent.click(publish);
    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/publish") && call[1]?.method === "POST")).toBe(true));
  });
});
