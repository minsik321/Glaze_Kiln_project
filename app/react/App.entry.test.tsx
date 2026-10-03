import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("./auth/AuthProvider", () => ({
  useAuth: () => ({ session: null }),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState({}, "", "/");
});

function finishSplash() {
  screen.getByLabelText("AICE 스플래시 화면");
  act(() => vi.advanceTimersByTime(1_000));
}

describe("App entry flow", () => {
  it("shows the guide after the splash on a normal refresh and skips to login", () => {
    vi.useFakeTimers();
    render(<App />);

    finishSplash();
    expect(screen.getByLabelText("AICE Kiln 사용 가이드")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    expect(screen.getByLabelText("로그인 화면")).toBeTruthy();
  });

  it("continues from the fourth guide page to login", () => {
    vi.useFakeTimers();
    render(<App />);
    finishSplash();

    const track = screen.getByLabelText("사용 가이드 1/4");
    Object.defineProperty(track, "scrollTo", { configurable: true, value: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "4페이지로 이동" }));
    expect(screen.queryByRole("button", { name: "건너뛰기" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "시작하기" }));

    expect(screen.getByLabelText("로그인 화면")).toBeTruthy();
  });
});
