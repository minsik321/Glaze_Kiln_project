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
    fireEvent.click(screen.getByRole("button", { name: /가상 소성 준비/ }));
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
      schema_version: 2,
      sources: [{ source_type: "literature" }],
      consent: { share_allowed: false },
      versions: { rule_model: "aice-rule-rag-1", predictor: null },
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
    fireEvent.click(screen.getByRole("button", { name: /안정 우선/ }));
    fireEvent.click(screen.getByRole("button", { name: /이 후보로 가상 소성 준비/ }));
    getter = onSnapshotReady.mock.calls.at(-1)?.[0];
    const run = await getter();
    expect(run.curves.selected_id).toMatch(/thickness-target/);
    expect(run.curves.candidates.find((curve: { id: string }) => curve.id === run.curves.selected_id)?.role).toBe("selected");
    expect(run.pid).toMatchObject({ preset: "stable", controller_kind: "pid" });
    expect(run.pid.samples.length).toBeGreaterThan(0);
    expect(Object.values(run.pid.parameters).every((value: unknown) => (value as { source_type: string }).source_type === "synthetic")).toBe(true);
  });
});
