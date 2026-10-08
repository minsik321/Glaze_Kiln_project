import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FEED_POSTS, FEED_USERS, findFeedUser } from "./feedData";
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
    const onToggleFollow = vi.fn();
    const onToggleSaved = vi.fn();
    render(<PostDetailScreen post={post} user={user} viewer={viewer} comments={[]} onAddComment={vi.fn()} onBack={onBack} onOpenProfile={onOpenProfile} onToggleFollow={onToggleFollow} onToggleSaved={onToggleSaved} />);

    fireEvent.click(screen.getByRole("button", { name: "홈 피드로 돌아가기" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: `${user.username} 프로필 보기` }));
    expect(onOpenProfile).toHaveBeenCalledWith(user.id);

    const follow = screen.getByRole("button", { name: "팔로우" });
    fireEvent.click(follow);
    expect(onToggleFollow).toHaveBeenCalledOnce();

    const save = screen.getByRole("button", { name: "게시물 저장" });
    fireEvent.click(save);
    expect(onToggleSaved).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toBe("북마크에 저장되었습니다.");
  });

  it("opens sharing options and sends the post through chat", () => {
    const post = FEED_POSTS[0];
    const recipient = FEED_USERS[1];
    const onShareToChat = vi.fn();
    render(<PostDetailScreen post={post} user={findFeedUser(post.userId)} viewer={viewer} comments={[]} shareRecipients={[recipient]} onAddComment={vi.fn()} onBack={vi.fn()} onOpenProfile={vi.fn()} onShareToChat={onShareToChat} />);

    fireEvent.click(screen.getByRole("button", { name: "공유" }));
    const dialog = screen.getByRole("dialog", { name: "공유하기" });
    expect(within(dialog).getByRole("button", { name: /SNS로 공유/ })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /링크 복사/ })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /채팅으로 보내기/ }));
    const followingDialog = screen.getByRole("dialog", { name: "팔로잉에게 보내기" });
    fireEvent.click(within(followingDialog).getByRole("button", { name: new RegExp(recipient.displayName) }));

    expect(onShareToChat).toHaveBeenCalledWith(recipient.id, expect.stringContaining(post.glazeName));
    expect(onShareToChat).toHaveBeenCalledWith(recipient.id, expect.stringContaining(`#post-${post.id}`));
    expect(screen.queryByRole("dialog", { name: "공유하기" })).toBeNull();
  });

  it("copies a shareable post link", async () => {
    const post = FEED_POSTS[0];
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<PostDetailScreen post={post} user={findFeedUser(post.userId)} viewer={viewer} comments={[]} onAddComment={vi.fn()} onBack={vi.fn()} onOpenProfile={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "공유" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "공유하기" })).getByRole("button", { name: /링크 복사/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`#post-${post.id}`)));
    expect((await screen.findByRole("status")).textContent).toBe("링크를 복사했습니다.");
  });

  it("edits the viewer's own post in place and confirms before deleting", () => {
    const post = FEED_POSTS[0];
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<PostDetailScreen post={post} user={findFeedUser(post.userId)} viewer={viewer} comments={[]} isOwnPost onEdit={onEdit} onDelete={onDelete} onAddComment={vi.fn()} onBack={vi.fn()} onOpenProfile={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "팔로우" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    expect(screen.queryByRole("dialog", { name: "게시물 수정" })).toBeNull();
    fireEvent.change(screen.getByLabelText("유약 이름"), { target: { value: "수정한 유약" } });
    fireEvent.change(screen.getByLabelText("메모 수정"), { target: { value: "수정한 메모" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ glazeName: "수정한 유약", memo: "수정한 메모" }));
    expect(screen.queryByLabelText("유약 이름")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    const deleteDialog = screen.getByRole("alertdialog", { name: "삭제하시겠습니까?" });
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "삭제" }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("discards inline edits on cancel", () => {
    const post = FEED_POSTS[0];
    const onEdit = vi.fn();
    render(<PostDetailScreen post={post} user={findFeedUser(post.userId)} viewer={viewer} comments={[]} isOwnPost onEdit={onEdit} onAddComment={vi.fn()} onBack={vi.fn()} onOpenProfile={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.change(screen.getByLabelText("유약 이름"), { target: { value: "버릴 이름" } });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("유약 이름")).toBeNull();
  });

  it("lets the owner replace the post photo while editing", async () => {
    const post = FEED_POSTS[0];
    const onEdit = vi.fn();
    render(<PostDetailScreen post={post} user={findFeedUser(post.userId)} viewer={viewer} comments={[]} isOwnPost onEdit={onEdit} onAddComment={vi.fn()} onBack={vi.fn()} onOpenProfile={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.change(screen.getByLabelText("게시물 사진 변경"), { target: { files: [new File(["x"], "new.png", { type: "image/png" })] } });
    await waitFor(() => expect((screen.getByAltText(post.label) as HTMLImageElement).src).toContain("data:image/png"));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ image: expect.stringContaining("data:image/png") }));
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
