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
    fireEvent.click(screen.getByRole("button", { name: /^다음/ }));
    fireEvent.click(screen.getByRole("button", { name: /가상 분포를 확인/ }));
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

  it("exports a simulation-only snapshot", async () => {
    const onSnapshotReady = vi.fn();
    render(<AicePrototype onSnapshotReady={onSnapshotReady} />);
    const getter = onSnapshotReady.mock.calls.at(-1)?.[0];
    await expect(getter()).resolves.toMatchObject({
      prototype: true,
      safety: { simulation_only: true, quality_guaranteed: false, real_kiln_control: false },
    });
  });
});

