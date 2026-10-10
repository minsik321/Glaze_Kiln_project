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

describe("HomeScreen grid columns", () => {
  const columnsAt = (wide: boolean) => {
    window.matchMedia = ((query: string) => ({ matches: wide, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
    const { container } = render(<HomeScreen {...handlers} />);
    return container.querySelectorAll(".home-feed-column").length;
  };

  it("uses 4 columns on wide screens and 2 on mobile", () => {
    expect(columnsAt(true)).toBe(4);
    cleanup();
    expect(columnsAt(false)).toBe(2);
  });
});
