import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationScreen } from "./NotificationScreen";

afterEach(cleanup);

describe("NotificationScreen", () => {
  it("shows grouped notifications and returns to the home feed", () => {
    const onBack = vi.fn();
    render(<NotificationScreen onBack={onBack} />);

    expect(screen.getByRole("heading", { name: "알림" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "오늘" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "이번 주" })).toBeTruthy();
    expect(screen.getAllByLabelText("읽지 않은 알림")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "홈 피드로 돌아가기" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("marks individual or all notifications as read", () => {
    render(<NotificationScreen onBack={vi.fn()} />);

    fireEvent.click(screen.getAllByRole("button").find((button) => button.textContent?.includes("mira.ceramic"))!);
    expect(screen.getAllByLabelText("읽지 않은 알림")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "모두 읽음" }));
    expect(screen.queryByLabelText("읽지 않은 알림")).toBeNull();
  });
});
