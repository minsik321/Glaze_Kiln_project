import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingGuide } from "./OnboardingGuide";

afterEach(cleanup);

describe("OnboardingGuide", () => {
  it("shows four ordered guide images and lets the user skip", () => {
    const onSkip = vi.fn();
    render(<OnboardingGuide onSkip={onSkip} onStart={vi.fn()} />);

    expect(screen.getAllByRole("img").map((image) => image.getAttribute("src"))).toEqual([
      "/onboarding-1.png",
      "/onboarding-2.png",
      "/onboarding-3.png",
      "/onboarding-4.png",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("replaces skip with a start action on the fourth page", () => {
    const onStart = vi.fn();
    render(<OnboardingGuide onSkip={vi.fn()} onStart={onStart} />);
    const track = screen.getByLabelText("사용 가이드 1/4");
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(track, "scrollLeft", { configurable: true, value: 1200 });
    fireEvent.scroll(track);

    expect(screen.queryByRole("button", { name: "건너뛰기" })).toBeNull();
    expect(screen.getByRole("button", { name: "시작하기" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "기존 아이디로 로그인" })).toBeNull();
    expect(screen.getByRole("button", { name: "4페이지로 이동" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "시작하기" }));
    expect(onStart).toHaveBeenCalledOnce();
  });
});
