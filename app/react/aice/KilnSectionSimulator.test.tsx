import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KilnSectionSimulator } from "./KilnSectionSimulator";
import { sensorPreset, type SensorPlacement, type SensorPlan } from "./kilnSimulation";

afterEach(cleanup);

function Harness() {
  const [plan, setPlan] = useState<SensorPlan>("three");
  const [sensors, setSensors] = useState<SensorPlacement[]>(sensorPreset("three"));
  return <KilnSectionSimulator ware="bowl" plan={plan} sensors={sensors} onPlanChange={setPlan} onSensorsChange={setSensors} />;
}

describe("kiln section controls", () => {
  it("changes sensor coverage, allows position adjustment, and exposes limitations", () => {
    render(<Harness />);
    expect(screen.getAllByText(/불확실성 ±/)).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "기본 1개" }));
    expect(screen.getAllByText(/불확실성 ±/)).toHaveLength(1);
    expect(screen.getByText(/높이 50%/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "sensor-1 위로" }));
    expect(screen.getByText(/높이 58%/)).toBeTruthy();
    fireEvent.click(screen.getByText("센서 대표성과 모델 상세 보기"));
    expect(screen.getByText(/기물 내부나 유약 표면을 직접 측정하지 않음/)).toBeTruthy();
    expect(screen.getByText(/CFD 결과가 아닙니다/)).toBeTruthy();
  });

  it("shows the matching location and warning timeline for a fault", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "센서 고장" }));
    fireEvent.click(screen.getByRole("button", { name: "유지" }));
    expect(screen.getByText(/sensor-1 신호가 끊겨/)).toBeTruthy();
    expect(screen.getByText(/신호 없음/)).toBeTruthy();
  });
});
