import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DensityCheck } from "./DensityCheck";
import { kilnBatchApi } from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, kilnBatchApi: { dipTime: vi.fn() } };
});

afterEach(cleanup);

//: v9 후속: `rho`는 이제 부모(AicePrototype.tsx)가 끌어올려 두께 계산·저장
//: 기록에도 같이 쓰는 controlled 값이다 — 테스트도 실제 쓰임과 같은 모양의
//: 얕은 래퍼로 상태를 들고 렌더한다.
function Harness(props: Omit<Parameters<typeof DensityCheck>[0], "rho" | "onRhoChange">) {
  const [rho, setRho] = useState("");
  return <DensityCheck {...props} rho={rho} onRhoChange={setRho} />;
}

describe("DensityCheck", () => {
  it("disables the check button until a valid specific gravity is entered", () => {
    render(<Harness />);
    const button = screen.getByRole("button", { name: "비중 확인하기" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("비중(ρ)"), { target: { value: "1.45" } });
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("shows advice reusing the same thresholds as kiln.batch.assess_density", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("비중(ρ)"), { target: { value: "1.6" } });
    fireEvent.click(screen.getByRole("button", { name: "비중 확인하기" }));
    expect(screen.getByText(/범위 초과\(되직\)/)).toBeTruthy();
    expect(screen.getByText(/진행을 막지 않는 참고 안내/)).toBeTruthy();
  });

  it("calls the real backend dip-time endpoint and shows its result, not a local formula", async () => {
    vi.mocked(kilnBatchApi.dipTime).mockResolvedValue({ seconds: 9.2, predicted_mean_mm: 1.0, feasible: true, reason: "" });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("비중(ρ)"), { target: { value: "1.45" } });
    fireEvent.click(screen.getByRole("button", { name: "권장 담금시간 계산" }));
    await waitFor(() => expect(screen.getByText(/권장 담금시간 9.2초/)).toBeTruthy());
    expect(kilnBatchApi.dipTime).toHaveBeenCalledWith(1, 1.45);
  });

  it("uses the recipe-specific calibrated range instead of the literature default when given", () => {
    render(<Harness densityRange={[1.5, 1.6]} />);
    // 이 레시피의 실측 범위 안(1.55)이면, 문헌 기본 범위([1.4,1.5])로는
    // "범위 초과"지만 레시피별 범위로는 "정상"이어야 한다.
    fireEvent.change(screen.getByLabelText("비중(ρ)"), { target: { value: "1.55" } });
    fireEvent.click(screen.getByRole("button", { name: "비중 확인하기" }));
    expect(screen.getByText(/정상/)).toBeTruthy();
    expect(screen.getByText(/1\.50–1\.60/)).toBeTruthy();
  });

  it("shows the recipe's target specific gravity, distinguishing calibrated from literature default", () => {
    const { rerender } = render(<Harness defaultTargetRho={1.45} />);
    expect(screen.getByText(/목표 비중은 약 1\.45/)).toBeTruthy();
    expect(screen.getByText(/문헌 기본값/)).toBeTruthy();

    rerender(<Harness defaultTargetRho={1.52} densityRange={[1.5, 1.54]} />);
    expect(screen.getByText(/목표 비중은 약 1\.52/)).toBeTruthy();
    expect(screen.getByText(/개인 실측 이력 기반/)).toBeTruthy();
  });

  it("keeps the target thickness field in sync when the recipe's calculated default changes", () => {
    // 2026-09-20 수정 대상 버그: useState 초기값으로만 받으면 레시피별
    // 계산이 나중에 끝나도(또는 레시피가 바뀌어도) 입력칸이 그대로
    // 굳어 있어 하드코딩처럼 보였다.
    const { rerender } = render(<Harness defaultTargetMm={1.0} />);
    expect((screen.getByLabelText("목표 평균 두께(mm)") as HTMLInputElement).value).toBe("1");

    rerender(<Harness defaultTargetMm={1.35} />);
    expect((screen.getByLabelText("목표 평균 두께(mm)") as HTMLInputElement).value).toBe("1.35");
  });
});
