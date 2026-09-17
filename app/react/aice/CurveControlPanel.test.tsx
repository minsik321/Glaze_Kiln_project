import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CurveControlPanel } from "./CurveControlPanel";

function mockSimulateResponse(overrides: Partial<{ samples: unknown[] }> = {}) {
  return new Response(
    JSON.stringify({
      samples: overrides.samples ?? [
        { t_s: 0, minute: 0, sensor_c: 20, ware_c: 20, power_w: 0, phase: "승온", outer_mode: "감시", hold_extension_s: 0, message: "", paused: false },
        { t_s: 18000, minute: 300, sensor_c: 950, ware_c: 940, power_w: 5000, phase: "유지", outer_mode: "능동", hold_extension_s: 0, message: "", paused: false },
        { t_s: 28800, minute: 480, sensor_c: 640, ware_c: 650, power_w: 0, phase: "냉각", outer_mode: "감시", hold_extension_s: 0, message: "", paused: false },
      ],
      provenance_notes: ["12-2절: 생성기는 추정 모델과 구조적으로 다르게 오지정되어 있다"],
      e_note: "E=300000 J/mol (미정값 · 가정: 9-5절 외측 루프 운용을 위한 가정)",
      target_heat_work: 1.0,
      peak_c: 1199,
      max_power_w: 6000,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("curve control explanation", () => {
  it("toggles four roles and explains the curve change", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => mockSimulateResponse());
    render(<CurveControlPanel coating="thick" approved={false} onApprove={vi.fn()} />);
    expect(screen.getByRole("img", { name: /기준 계획과 두께 반영 수정 계획 비교/ })).toBeTruthy();
    const next = screen.getByRole("checkbox", { name: /다음 실행 제안/ }) as HTMLInputElement;
    expect(next.checked).toBe(true);
    fireEvent.click(next);
    expect(next.checked).toBe(false);
    await waitFor(() => expect(screen.getByText("왜 바뀌었는지 · 외란 시나리오·포화·원시 로그 보기")).toBeTruthy());
    fireEvent.click(screen.getByText("왜 바뀌었는지 · 외란 시나리오·포화·원시 로그 보기"));
    expect(screen.getByText(/두꺼운 형상 기반 분포/)).toBeTruthy();
  });

  it("calls the kiln.firing backend and keeps named presets out of the primary UI", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => mockSimulateResponse());
    const onApprove = vi.fn();
    render(<CurveControlPanel coating="target" approved={false} onApprove={onApprove} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toContain("/kiln/firing/simulate");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.schedule[0]).toEqual([0, 20]);

    expect(screen.queryByText("설명형 제어 프리셋")).toBeNull();
    expect(screen.queryByRole("button", { name: /안정 우선/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /빠른 반응/ })).toBeNull();

    const summary = await screen.findByText("왜 바뀌었는지 · 외란 시나리오·포화·원시 로그 보기");
    expect(summary.closest("details")?.open).toBe(false);
    fireEvent.click(summary);
    expect(summary.closest("details")?.open).toBe(true);
    expect(screen.getByText("supply_voltage_pct")).toBeTruthy();
    expect(screen.getAllByText(/synthetic/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "다시 추천" }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));

    const approveButton = screen.getByRole("button", { name: /이대로 진행/ });
    await waitFor(() => expect((approveButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(approveButton);
    expect(onApprove).toHaveBeenCalledWith("accepted", expect.any(Array), expect.any(Object));
  });

  it("shows an error state and lets the operator retry via 다시 추천", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => new Response("boom", { status: 500 }))
      .mockImplementation(async () => mockSimulateResponse());
    render(<CurveControlPanel coating="target" approved={false} onApprove={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("가상 제어 계산 오류")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "다시 추천" }));
    await waitFor(() => expect(screen.queryByText("가상 제어 계산 오류")).toBeNull());
    expect(fetchMock.mock.calls.length).toBe(2);
  });
});
