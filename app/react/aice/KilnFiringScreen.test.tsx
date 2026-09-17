import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KilnFiringScreen } from "./KilnFiringScreen";
import type { SensorPlacement } from "./kilnSimulation";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
  requireSupabase: () => ({ from: mocks.from }),
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function kilnSimulateResponse() {
  return jsonResponse({
    samples: [
      { t_s: 0, minute: 0, sensor_c: 20, ware_c: 20, power_w: 0, phase: "승온", outer_mode: "감시", hold_extension_s: 0, message: "", paused: false },
      { t_s: 18000, minute: 300, sensor_c: 950, ware_c: 940, power_w: 5000, phase: "유지", outer_mode: "능동", hold_extension_s: 0, message: "", paused: false },
      { t_s: 28800, minute: 480, sensor_c: 640, ware_c: 650, power_w: 0, phase: "냉각", outer_mode: "감시", hold_extension_s: 0, message: "", paused: false },
    ],
    provenance_notes: ["12-2절: 생성기는 추정 모델과 구조적으로 다르게 오지정되어 있다"],
    e_note: "E=300000 J/mol (미정값 · 가정: 9-5절 외측 루프 운용을 위한 가정)",
    target_heat_work: 1.0,
    peak_c: 1199,
    max_power_w: 6000,
  });
}

function Harness({ userId }: { userId?: string }) {
  const [sensors, setSensors] = useState<SensorPlacement[]>([]);
  const [approved, setApproved] = useState(false);
  const [simulationCompleted, setSimulationCompleted] = useState(false);
  return (
    <KilnFiringScreen
      ware="bowl"
      coating="target"
      userId={userId}
      sensors={sensors}
      onSensorsChange={setSensors}
      recipeFiringRangeC={null}
      riskMitigationApplied={false}
      approved={approved}
      onApprove={() => setApproved(true)}
      simulationCompleted={simulationCompleted}
      onSimulationStart={() => setSimulationCompleted(true)}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.from.mockReset();
});

describe("kiln + firing screen (v9 6/7/8페이지 통합)", () => {
  it("auto-loads a default three-sensor layout without an account and allows height fine-tuning", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => kilnSimulateResponse());
    render(<Harness />);
    await waitFor(() => expect(screen.getAllByText(/불확실성 ±/)).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "sensor-1 위로" }));
    expect(screen.getByText(/높이 90%/)).toBeTruthy();
  });

  it("loads the sensor layout from the account's kiln profile instead of a preset picker", async () => {
    mocks.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { kiln_sensor_plan: "multi" }, error: null }) }) }),
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => kilnSimulateResponse());
    render(<Harness userId="user-1" />);
    await waitFor(() => expect(screen.getAllByText(/불확실성 ±/)).toHaveLength(5));
    expect(mocks.from).toHaveBeenCalledWith("profiles");
  });

  it("has no sensor preset picker or sensor detail drawer", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => kilnSimulateResponse());
    render(<Harness />);
    await waitFor(() => expect(screen.getAllByText(/불확실성 ±/)).toHaveLength(3));
    expect(screen.queryByText("센서 프리셋")).toBeNull();
    expect(screen.queryByText("센서 상세보기와 모델 상세 보기")).toBeNull();
    expect(screen.queryByText("센서 대표성과 모델 상세 보기")).toBeNull();
  });

  it("keeps the baseline plan fixed and recalculates the reactive plan when an anomaly scenario is chosen", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => kilnSimulateResponse());
    render(<Harness />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const initialCalls = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "센서 고장" }));
    fireEvent.click(screen.getByRole("button", { name: "유지" }));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls));
    const lastCall = fetchMock.mock.calls.at(-1)!;
    const body = JSON.parse(String(lastCall[1]?.body));
    expect(body.disturbance.thermocouple_lag_s).toBeGreaterThan(0);
    expect(screen.getByText(/sensor-1 신호가 끊겨/)).toBeTruthy();
    expect(screen.getByText(/신호 없음/)).toBeTruthy();
  });

  it("approves the reactive plan and starts the firing playback from one screen", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => kilnSimulateResponse());
    render(<Harness />);

    const approveButton = await screen.findByRole("button", { name: /이대로 진행/ });
    await waitFor(() => expect((approveButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(approveButton);
    expect(await screen.findByRole("button", { name: /가상 제어기 전달 완료/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /가상 소성 재생/ }));
    expect(screen.getByRole("button", { name: "일시정지" })).toBeTruthy();
  });
});
