import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationScreen } from "./NotificationScreen";
import type { NotificationItem } from "./notificationStore";

afterEach(cleanup);

const now = new Date().toISOString();
const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
const items: NotificationItem[] = [
  { id: "a", kind: "comment", actorId: "u1", user: "mira", avatarUrl: "", postId: "p1", message: "댓글", time: "8분 전", createdAt: now, read: false },
  { id: "b", kind: "follow", actorId: "u2", user: "dohoon", avatarUrl: "", postId: null, message: "팔로우", time: "3일 전", createdAt: old, read: false },
  { id: "c", kind: "follow", actorId: "u3", user: "sena", avatarUrl: "", postId: null, message: "팔로우", time: "3일 전", createdAt: old, read: true },
];

describe("NotificationScreen", () => {
  it("groups notifications, marks them read and returns to the home feed", () => {
    const onBack = vi.fn();
    const onMarkRead = vi.fn();
    render(<NotificationScreen notifications={items} onBack={onBack} onMarkRead={onMarkRead} />);

    expect(screen.getByRole("heading", { name: "오늘" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "이번 주" })).toBeTruthy();
    expect(screen.getAllByLabelText("읽지 않은 알림")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "모두 읽음" }));
    expect(onMarkRead).toHaveBeenCalledWith(["a", "b"]);
    fireEvent.click(screen.getByRole("button", { name: "홈 피드로 돌아가기" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("opens the post for a comment and marks only that one read", () => {
    const onMarkRead = vi.fn();
    const onOpenPost = vi.fn();
    render(<NotificationScreen notifications={items} onBack={vi.fn()} onMarkRead={onMarkRead} onOpenPost={onOpenPost} />);
    fireEvent.click(screen.getAllByRole("button").find((button) => button.textContent?.includes("mira"))!);
    expect(onMarkRead).toHaveBeenCalledWith(["a"]);
    expect(onOpenPost).toHaveBeenCalledWith("p1");
  });

  it("opens the conversation for a chat message notification", () => {
    const onMarkRead = vi.fn();
    const onOpenChat = vi.fn();
    const message: NotificationItem = { id: "m", kind: "message", actorId: "u9", user: "jun", avatarUrl: "", postId: null, message: "메시지를 보냈어요.", time: "방금 전", createdAt: now, read: false };
    render(<NotificationScreen notifications={[message]} onBack={vi.fn()} onMarkRead={onMarkRead} onOpenChat={onOpenChat} />);
    fireEvent.click(screen.getAllByRole("button").find((button) => button.textContent?.includes("jun"))!);
    expect(onMarkRead).toHaveBeenCalledWith(["m"]);
    expect(onOpenChat).toHaveBeenCalledWith("u9");
  });

  it("shows an empty state and disables read-all when everything is read", () => {
    render(<NotificationScreen notifications={[]} onBack={vi.fn()} onMarkRead={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("알림이 없어요");
    expect((screen.getByRole("button", { name: "모두 읽음" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
