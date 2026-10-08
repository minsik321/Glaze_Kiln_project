import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("./auth/AuthProvider", () => ({ useAuth: () => ({ session: null }) }));
vi.mock("./auth/LoginScreen", () => ({
  LoginScreen: ({ onSuccess }: { onSuccess: () => void }) => <button type="button" onClick={onSuccess}>테스트 로그인</button>,
}));
vi.mock("./home/HomeScreen", () => ({
  HomeScreen: ({ onOpenProfile }: { onOpenProfile: (userId: string) => void }) => <button type="button" onClick={() => onOpenProfile("mira")}>미라 프로필 열기</button>,
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("follow notifications", () => {
  it("shows a bottom toast for following and unfollowing a profile", () => {
    vi.useFakeTimers();
    const { container } = render(<App />);
    act(() => vi.advanceTimersByTime(1_000));
    fireEvent.click(screen.getByRole("button", { name: "건너뛰기" }));
    fireEvent.click(screen.getByRole("button", { name: "테스트 로그인" }));
    fireEvent.click(screen.getByRole("button", { name: "미라 프로필 열기" }));

    const followButton = container.querySelector(".app-view:not([hidden]) .my-follow-button") as HTMLButtonElement;
    fireEvent.click(followButton);
    expect(container.querySelector(".follow-toast")?.textContent).toBe("미라의 흙방님을 팔로우했습니다.");

    fireEvent.click(followButton);
    expect(container.querySelector(".follow-toast")?.textContent).toBe("미라의 흙방님을 언팔로우했습니다.");

    act(() => vi.advanceTimersByTime(2_400));
    expect(container.querySelector(".follow-toast")).toBeNull();
  });
});
