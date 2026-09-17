import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CurveControlPanel } from "./CurveControlPanel";

afterEach(cleanup);

describe("curve control explanation", () => {
  it("toggles four roles and explains the curve change", () => {
    render(<CurveControlPanel coating="thick" approved={false} onApprove={vi.fn()} />);
    expect(screen.getByRole("img", { name: /기준 계획과 두께 반영 수정 계획 비교/ })).toBeTruthy();
    const next = screen.getByRole("checkbox", { name: /다음 실행 제안/ }) as HTMLInputElement;
    expect(next.checked).toBe(true);
    fireEvent.click(next);
    expect(next.checked).toBe(false);
    fireEvent.click(screen.getByText("왜 바뀌었는지 · PID 게인·포화·원시 로그 보기"));
    expect(screen.getByText(/두꺼운 형상 기반 분포/)).toBeTruthy();
  });

  it("keeps gains and named presets out of the primary UI and reports a binary decision on approval", () => {
    const onApprove = vi.fn();
    render(<CurveControlPanel coating="target" approved={false} onApprove={onApprove} />);
    expect(screen.queryByText("설명형 제어 프리셋")).toBeNull();
    expect(screen.queryByRole("button", { name: /안정 우선/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /빠른 반응/ })).toBeNull();
    const summary = screen.getByText("왜 바뀌었는지 · PID 게인·포화·원시 로그 보기");
    expect(summary.closest("details")?.open).toBe(false);
    fireEvent.click(summary);
    expect(summary.closest("details")?.open).toBe(true);
    expect(screen.getByText("proportional_gain")).toBeTruthy();
    expect(screen.getAllByText(/synthetic/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "다시 추천" }));
    fireEvent.click(screen.getByRole("button", { name: /이대로 진행/ }));
    expect(onApprove).toHaveBeenCalledWith("accepted", expect.any(Array), expect.any(Object));
  });
});
