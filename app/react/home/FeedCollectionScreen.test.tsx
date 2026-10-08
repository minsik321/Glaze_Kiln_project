import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FEED_POSTS } from "./feedData";
import { FeedCollectionScreen } from "./FeedCollectionScreen";

afterEach(cleanup);

describe("FeedCollectionScreen", () => {
  it("shows a dedicated feed with back navigation", () => {
    const onBack = vi.fn();
    render(<FeedCollectionScreen title="북마크" posts={FEED_POSTS.slice(0, 2)} emptyTitle="없음" emptyDescription="설명" onBack={onBack} onOpenProfile={vi.fn()} onOpenPost={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "북마크" })).toBeTruthy();
    expect(document.querySelectorAll(".home-feed-card")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "홈으로 돌아가기" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("shows an empty state", () => {
    render(<FeedCollectionScreen title="팔로우 피드" posts={[]} emptyTitle="팔로우 게시물 없음" emptyDescription="팔로우해 보세요" onBack={vi.fn()} onOpenProfile={vi.fn()} onOpenPost={vi.fn()} />);
    expect(screen.getByText("팔로우 게시물 없음")).toBeTruthy();
  });
});
