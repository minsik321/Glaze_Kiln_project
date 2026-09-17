import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AicePrototype } from "./AicePrototype";

afterEach(cleanup);

describe("AICE guided prototype", () => {
  it("finishes a sample simulation without numeric input", () => {
    render(<AicePrototype />);
    fireEvent.click(screen.getByRole("button", { name: /샘플 실험 시작/ }));
    fireEvent.click(screen.getByRole("button", { name: /사틴 청색/ }));
    fireEvent.click(screen.getByRole("button", { name: /^다음/ }));
    fireEvent.click(screen.getByRole("button", { name: /해안 사틴 01/ }));
    fireEvent.click(screen.getByRole("button", { name: /^다음/ }));
    fireEvent.click(screen.getByRole("button", { name: /사발/ }));
    fireEvent.click(screen.getByRole("button", { name: /백색 석기 소지/ }));
    fireEvent.click(screen.getByRole("button", { name: /^다음/ }));
    fireEvent.click(screen.getByRole("button", { name: /목표 근처/ }));
    fireEvent.click(screen.getByRole("button", { name: /가상 분포와 위험을 확인/ }));
    fireEvent.click(screen.getByRole("button", { name: /^다음/ }));
    fireEvent.click(screen.getByRole("button", { name: /상·중·하 3개/ }));
    fireEvent.click(screen.getByRole("button", { name: /^다음/ }));
    fireEvent.click(screen.getByRole("button", { name: /이대로 진행/ }));
    fireEvent.click(screen.getByRole("button", { name: /^다음/ }));
    fireEvent.click(screen.getByRole("button", { name: /가상 소성 재생/ }));
    expect(screen.getByText("가상 소성 완료")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^다음/ }));
    fireEvent.click(screen.getByRole("button", { name: /목표에 가까워요/ }));
    expect(screen.getByTestId("aice-step-9")).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getByText("실제 소성 품질이나 재현성을 검증한 결과가 아닙니다.")).toBeTruthy();
  });

  it("exports a versioned AiceRun with provenance and private consent", async () => {
    const onSnapshotReady = vi.fn();
    render(<AicePrototype onSnapshotReady={onSnapshotReady} />);
    const getter = onSnapshotReady.mock.calls.at(-1)?.[0];
    await expect(getter()).resolves.toMatchObject({
      schema_version: 3,
      sources: [{ source_type: "literature" }],
      consent: { share_allowed: false },
      versions: { rule_model: "aice-rule-rag-1", predictor: "aice-predictor-draft-1" },
    });
  });

  it("records only an approved curve and its synthetic controller samples", async () => {
    const onSnapshotReady = vi.fn();
    render(<AicePrototype onSnapshotReady={onSnapshotReady} />);
    for (const name of [/샘플 실험 시작/, /사틴 청색/, /^다음/, /해안 사틴 01/, /^다음/, /^사발/, /백색 석기 소지/, /^다음/, /목표 근처/, /가상 분포와 위험을 확인/, /^다음/, /상·중·하 3개/, /^다음/]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    let getter = onSnapshotReady.mock.calls.at(-1)?.[0];
    await expect(getter()).resolves.toMatchObject({ curves: { selected_id: null }, pid: { parameters: {}, samples: [] } });
    fireEvent.click(screen.getByRole("button", { name: /이대로 진행/ }));
    getter = onSnapshotReady.mock.calls.at(-1)?.[0];
    const run = await getter();
    expect(run.curves.selected_id).toMatch(/thickness-target/);
    expect(run.curves.candidates.find((curve: { id: string }) => curve.id === run.curves.selected_id)?.role).toBe("selected");
    expect(run.pid).toMatchObject({ decision: "accepted", controller_kind: "pid" });
    expect(run.pid.samples.length).toBeGreaterThan(0);
    expect(Object.values(run.pid.parameters).every((value: unknown) => (value as { source_type: string }).source_type === "synthetic")).toBe(true);
  });

  it("propagates a recipe candidate change through to the predicted next-run curve (Phase 6 integration check)", async () => {
    const onSnapshotReady = vi.fn();
    render(<AicePrototype onSnapshotReady={onSnapshotReady} />);
    fireEvent.click(screen.getByRole("button", { name: /샘플 실험 시작/ }));
    fireEvent.click(screen.getByRole("button", { name: /사틴 청색/ }));
    fireEvent.click(screen.getByRole("button", { name: /^다음/ }));

    fireEvent.click(screen.getByRole("button", { name: /해안 사틴 01/ }));
    const coastalRun = await onSnapshotReady.mock.calls.at(-1)?.[0]();
    const coastalNext = coastalRun.curves.candidates.find((curve: { role: string }) => curve.role === "next");

    fireEvent.click(screen.getByRole("button", { name: /웜 클리어 02/ }));
    const warmClearRun = await onSnapshotReady.mock.calls.at(-1)?.[0]();
    const warmClearNext = warmClearRun.curves.candidates.find((curve: { role: string }) => curve.role === "next");

    // 레시피 후보(예상 소성범위)를 바꾸면 predictionModel.predictNextRun()의
    // 보정값이 달라지고, 그 값이 "다음 실행 제안" 곡선 한 장에 그대로
    // 반영된다 — 레시피 선택 → 예측 → 소성곡선까지 이어지는 전파 확인.
    expect(warmClearNext.points).not.toEqual(coastalNext.points);
    // 레시피가 바뀌어도 곡선 개수·역할 구조(CurveBundle) 자체는 그대로다.
    expect(warmClearRun.curves.candidates.map((curve: { role: string }) => curve.role)).toEqual(coastalRun.curves.candidates.map((curve: { role: string }) => curve.role));
  });
});
