import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DensityCheck } from "./DensityCheck";

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
});
