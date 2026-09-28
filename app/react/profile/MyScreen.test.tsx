import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MyScreen } from "./MyScreen";

afterEach(cleanup);

describe("MyScreen", () => {
  it("shows the profile, stats, and the user's posts", () => {
    render(<MyScreen username="Chloe.jung" displayName="가마쟁이" />);

    expect(screen.getByText("Chloe.jung")).toBeTruthy();
    expect(screen.getByText("가마쟁이")).toBeTruthy();
    expect(screen.getByText("545")).toBeTruthy();
    expect(screen.getByLabelText("내 게시물").children).toHaveLength(7);
  });

  it("switches to the list layout and opens profile editing", () => {
    const onEditProfile = vi.fn();
    render(<MyScreen onEditProfile={onEditProfile} />);

    fireEvent.click(screen.getByRole("tab", { name: "목록으로 보기" }));
    expect(screen.getByRole("tab", { name: "목록으로 보기" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    expect(onEditProfile).toHaveBeenCalledOnce();
  });

  it("renders another user's profile with back and follow actions", () => {
    const onBack = vi.fn();
    render(<MyScreen variant="other" username="Chloe.jung" onBack={onBack} />);

    expect(screen.queryByRole("button", { name: "프로필 편집" })).toBeNull();
    const follow = screen.getByRole("button", { name: "팔로우" });
    fireEvent.click(follow);
    expect(screen.getByRole("button", { name: "팔로잉" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "홈 피드로 돌아가기" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
