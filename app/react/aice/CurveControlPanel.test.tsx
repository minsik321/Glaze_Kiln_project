import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CurveControlPanel } from "./CurveControlPanel";

afterEach(cleanup);

describe("curve control explanation", () => {
  it("toggles four roles and explains the curve change", () => {
    render(<CurveControlPanel coating="thick" approved={false} onApprove={vi.fn()} />);
    expect(screen.getByRole("img", { name: /기준 계획과 두께 반영 수정 계획 비교/ })).toBeTruthy();
    expect(screen.getByText(/두꺼운 형상 기반 분포/)).toBeTruthy();
    const next = screen.getByRole("checkbox", { name: /다음 실행 제안/ }) as HTMLInputElement;
    expect(next.checked).toBe(true);
    fireEvent.click(next);
    expect(next.checked).toBe(false);
  });

  it("keeps gains advanced and passes only the chosen preset on approval", () => {
    const onApprove = vi.fn();
    render(<CurveControlPanel coating="target" approved={false} onApprove={onApprove} />);
    const summary = screen.getByText("PID 게인·포화·원시 로그 보기");
    expect(summary.closest("details")?.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /안정 우선/ }));
    fireEvent.click(summary);
    expect(summary.closest("details")?.open).toBe(true);
    expect(screen.getByText("proportional_gain")).toBeTruthy();
    expect(screen.getAllByText(/synthetic/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /이 후보로 가상 소성 준비/ }));
    expect(onApprove).toHaveBeenCalledWith("stable", expect.any(Array), expect.any(Array));
  });
});
