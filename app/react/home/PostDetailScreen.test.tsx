import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FEED_POSTS, findFeedUser } from "./feedData";
import { PostDetailScreen, type PostComment } from "./PostDetailScreen";

afterEach(cleanup);

const viewer = { displayName: "테스트 도예가", username: "tester", avatarUrl: "" };

describe("PostDetailScreen", () => {
  it("shows the photo, firing curve, recipe, work details, and memo", () => {
    const post = FEED_POSTS[0];
    render(<PostDetailScreen post={post} user={findFeedUser(post.userId)} viewer={viewer} comments={[]} onImportRecipe={vi.fn()} onAddComment={vi.fn()} onBack={vi.fn()} onOpenProfile={vi.fn()} />);

    expect(screen.getByRole("heading", { name: post.glazeName })).toBeTruthy();
    expect(screen.getByRole("img", { name: post.label })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "소성곡선" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "유약 레시피" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "작업 정보" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "작업 메모" })).toBeTruthy();
    expect(screen.getByText(post.memo)).toBeTruthy();
    expect(screen.getByRole("button", { name: "내 작업 레시피에 추가" })).toBeTruthy();
  });

  it("adds another user's recipe to work records", async () => {
    const post = FEED_POSTS[0];
    const onImportRecipe = vi.fn().mockResolvedValue(undefined);
    render(<PostDetailScreen post={post} user={findFeedUser(post.userId)} viewer={viewer} comments={[]} onImportRecipe={onImportRecipe} onAddComment={vi.fn()} onBack={vi.fn()} onOpenProfile={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "내 작업 레시피에 추가" }));
    const cancelDialog = screen.getByRole("alertdialog", { name: "작업 기록을 가져오시겠습니까?" });
    fireEvent.click(within(cancelDialog).getByRole("button", { name: "아니오" }));
    expect(onImportRecipe).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "내 작업 레시피에 추가" }));
    const confirmDialog = screen.getByRole("alertdialog", { name: "작업 기록을 가져오시겠습니까?" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "예" }));
    await waitFor(() => expect(onImportRecipe).toHaveBeenCalledTimes(1));
    const successDialog = await screen.findByRole("alertdialog", { name: "작업 기록을 저장했습니다" });
    expect(screen.queryByText("다른 사람의 작업으로 작업기록에 추가했어요.")).toBeNull();
    fireEvent.click(within(successDialog).getByRole("button", { name: "확인" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "작업기록에 추가됨" })).toBeTruthy();
  });

  it("supports back navigation, profile navigation, follow, and save", () => {
    const post = FEED_POSTS[0];
    const user = findFeedUser(post.userId);
    const onBack = vi.fn();
    const onOpenProfile = vi.fn();
    render(<PostDetailScreen post={post} user={user} viewer={viewer} comments={[]} onAddComment={vi.fn()} onBack={onBack} onOpenProfile={onOpenProfile} />);

    fireEvent.click(screen.getByRole("button", { name: "홈 피드로 돌아가기" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: `${user.username} 프로필 보기` }));
    expect(onOpenProfile).toHaveBeenCalledWith(user.id);

    const follow = screen.getByRole("button", { name: "팔로우" });
    fireEvent.click(follow);
    expect(screen.getByRole("button", { name: "팔로잉" }).getAttribute("aria-pressed")).toBe("true");

    const save = screen.getByRole("button", { name: "게시물 저장" });
    fireEvent.click(save);
    expect(screen.getByRole("button", { name: "게시물 저장 취소" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows edit and delete instead of follow for the viewer's own post", () => {
    const post = FEED_POSTS[0];
    render(<PostDetailScreen post={post} user={findFeedUser(post.userId)} viewer={viewer} comments={[]} isOwnPost onAddComment={vi.fn()} onBack={vi.fn()} onOpenProfile={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "팔로우" })).toBeNull();
    expect(screen.getByRole("button", { name: "공유" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "수정" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "삭제" })).toBeTruthy();
  });

  it("adds a comment with the current profile and nickname", () => {
    const post = FEED_POSTS[0];
    function CommentHarness() {
      const [comments, setComments] = useState<PostComment[]>([]);
      return <PostDetailScreen
        post={post}
        user={findFeedUser(post.userId)}
        viewer={viewer}
        comments={comments}
        onAddComment={(body) => setComments((current) => [...current, { id: "comment-1", body, ...viewer, createdAt: "방금 전" }])}
        onBack={vi.fn()}
        onOpenProfile={vi.fn()}
      />;
    }
    render(<CommentHarness />);

    expect(screen.getByText("첫 댓글을 남겨보세요.")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "댓글 입력" }), { target: { value: "소성곡선이 정말 도움이 됐어요!" } });
    fireEvent.click(screen.getByRole("button", { name: "등록" }));

    expect(screen.getByText("소성곡선이 정말 도움이 됐어요!")).toBeTruthy();
    expect(screen.getByText("테스트 도예가")).toBeTruthy();
    expect(screen.getByText("@tester")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "댓글 입력" }) as HTMLInputElement).value).toBe("");
  });
});
