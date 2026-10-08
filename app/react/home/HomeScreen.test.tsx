import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeScreen } from "./HomeScreen";

afterEach(cleanup);

const handlers = {
  onStartWork: vi.fn(), onCreatePost: vi.fn(), onOpenProfile: vi.fn(), onOpenPost: vi.fn(),
  onOpenSearch: vi.fn(), onOpenFollowingFeed: vi.fn(), onOpenNotifications: vi.fn(),
};

describe("HomeScreen notification dot", () => {
  it("shows the red dot only while there are unread notifications", () => {
    const { rerender } = render(<HomeScreen {...handlers} hasUnreadNotifications />);
    expect(screen.getByRole("button", { name: "알림 목록" }).querySelector("span")).not.toBeNull();
    rerender(<HomeScreen {...handlers} hasUnreadNotifications={false} />);
    expect(screen.getByRole("button", { name: "알림 목록" }).querySelector("span")).toBeNull();
  });
});
