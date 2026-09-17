import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DensityCheck } from "./DensityCheck";
import { kilnBatchApi } from "../lib/api";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, kilnBatchApi: { dipTime: vi.fn() } };
});

afterEach(cleanup);

describe("DensityCheck", () => {
  it("disables the check button until a valid specific gravity is entered", () => {
    render(<DensityCheck />);
    const button = screen.getByRole("button", { name: "비중 확인하기" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("비중(ρ)"), { target: { value: "1.45" } });
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("shows advice reusing the same thresholds as kiln.batch.assess_density", () => {
    render(<DensityCheck />);
    fireEvent.change(screen.getByLabelText("비중(ρ)"), { target: { value: "1.6" } });
    fireEvent.click(screen.getByRole("button", { name: "비중 확인하기" }));
    expect(screen.getByText(/범위 초과\(되직\)/)).toBeTruthy();
    expect(screen.getByText(/진행을 막지 않는 참고 안내/)).toBeTruthy();
  });

  it("calls the real backend dip-time endpoint and shows its result, not a local formula", async () => {
    vi.mocked(kilnBatchApi.dipTime).mockResolvedValue({ seconds: 9.2, predicted_mean_mm: 1.0, feasible: true, reason: "" });
    render(<DensityCheck />);
    fireEvent.change(screen.getByLabelText("비중(ρ)"), { target: { value: "1.45" } });
    fireEvent.click(screen.getByRole("button", { name: "권장 담금시간 계산" }));
    await waitFor(() => expect(screen.getByText(/권장 담금시간 9.2초/)).toBeTruthy());
    expect(kilnBatchApi.dipTime).toHaveBeenCalledWith(1, 1.45);
  });
});
