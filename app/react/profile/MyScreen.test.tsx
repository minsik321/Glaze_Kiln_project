import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { YEJIN_DEMO_POSTS } from "../home/feedData";
import { MyScreen } from "./MyScreen";

afterEach(cleanup);

describe("MyScreen", () => {
  it("shows the profile, stats, and the user's posts", () => {
    render(<MyScreen username="Chloe.jung" displayName="가마쟁이" posts={YEJIN_DEMO_POSTS} />);

    expect(screen.getByText("Chloe.jung")).toBeTruthy();
    expect(screen.getByText("가마쟁이")).toBeTruthy();
    expect(screen.getByText("545")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByLabelText("내 게시물").children).toHaveLength(7);
    expect(screen.getAllByRole("img")).toHaveLength(7);
  });

  it("shows an empty state for a new account", () => {
    render(<MyScreen username="new-user" posts={[]} />);

    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("아직 작업 기록이 없습니다.")).toBeTruthy();
  });

  it("switches to the list layout and opens profile editing", () => {
    render(<MyScreen />);

    fireEvent.click(screen.getByRole("tab", { name: "목록으로 보기" }));
    expect(screen.getByRole("tab", { name: "목록으로 보기" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    expect(screen.getByRole("dialog", { name: "프로필 편집" })).toBeTruthy();
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

  it("opens the personal settings menu from the hamburger button", () => {
    vi.useFakeTimers();
    const onSettingsOpenChange = vi.fn();
    render(<MyScreen onSettingsOpenChange={onSettingsOpenChange} />);

    const menuButton = screen.getByRole("button", { name: "마이 메뉴" });
    fireEvent.click(menuButton);

    expect(onSettingsOpenChange).toHaveBeenCalledWith(true);
    expect(menuButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "설정" })).toBeTruthy();
    for (const label of ["계정 설정", "가마 설정", "북마크 관리", "알림 설정", "계정 공개 범위", "회원탈퇴", "도움말", "로그아웃", "앱 정보"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeTruthy();
    }
    expect(Array.from(screen.getByRole("navigation", { name: "마이 설정" }).querySelectorAll("button"), (button) => button.textContent)).toEqual([
      "계정 설정",
      "계정 공개 범위",
      "알림 설정",
      "가마 설정",
      "북마크 관리",
      "도움말",
      "앱 정보",
      "로그아웃",
      "회원탈퇴",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "마이 화면으로 돌아가기" }));
    expect(screen.getByRole("dialog", { name: "설정" }).classList.contains("is-closing")).toBe(true);
    act(() => vi.advanceTimersByTime(280));
    expect(onSettingsOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("dialog", { name: "설정" })).toBeNull();
    vi.useRealTimers();
  });

  it("connects account and kiln settings separately", () => {
    const onOpenAccountSettings = vi.fn();
    const onOpenKilnSettings = vi.fn();
    const onSettingsOpenChange = vi.fn();
    const view = render(<MyScreen onOpenAccountSettings={onOpenAccountSettings} onOpenKilnSettings={onOpenKilnSettings} onSettingsOpenChange={onSettingsOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: "마이 메뉴" }));
    fireEvent.click(screen.getByRole("button", { name: /계정 설정/ }));
    expect(onOpenAccountSettings).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "설정" })).toBeTruthy();
    expect(onSettingsOpenChange).not.toHaveBeenCalledWith(false);

    view.unmount();
    render(<MyScreen onOpenAccountSettings={onOpenAccountSettings} onOpenKilnSettings={onOpenKilnSettings} />);
    fireEvent.click(screen.getByRole("button", { name: "마이 메뉴" }));
    fireEvent.click(screen.getByRole("button", { name: /가마 설정/ }));
    expect(onOpenKilnSettings).toHaveBeenCalledOnce();
  });

  it("reopens the settings menu when returning from a settings detail screen", () => {
    const onSettingsOpenChange = vi.fn();
    const view = render(<MyScreen settingsOpenRequest={0} onSettingsOpenChange={onSettingsOpenChange} />);

    view.rerender(<MyScreen settingsOpenRequest={1} onSettingsOpenChange={onSettingsOpenChange} />);

    expect(screen.getByRole("dialog", { name: "설정" })).toBeTruthy();
    expect(onSettingsOpenChange).toHaveBeenLastCalledWith(true);
  });

  it("validates the nickname and shows duplicate nickname errors", async () => {
    const onSaveProfile = vi.fn().mockRejectedValueOnce(new Error("이미 사용중인 닉네임입니다."));
    render(<MyScreen displayName="가마쟁이" onSaveProfile={onSaveProfile} />);

    fireEvent.click(screen.getByRole("button", { name: "프로필 편집" }));
    fireEvent.change(screen.getByLabelText("닉네임"), { target: { value: "잘못된 닉네임!" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByRole("alert").textContent).toContain("영문자, 한글, 숫자만");
    expect(onSaveProfile).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("닉네임"), { target: { value: "새닉네임1" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(onSaveProfile).toHaveBeenCalledWith({ nickname: "새닉네임1", avatarUrl: "" }));
    expect((await screen.findByRole("alert")).textContent).toBe("이미 사용중인 닉네임입니다.");
  });

  it("confirms logout, shows completion, and returns to login", async () => {
    const onLogout = vi.fn().mockResolvedValue(undefined);
    const onReturnToLogin = vi.fn();
    render(<MyScreen onLogout={onLogout} onReturnToLogin={onReturnToLogin} />);

    fireEvent.click(screen.getByRole("button", { name: "마이 메뉴" }));
    fireEvent.click(screen.getByRole("button", { name: /로그아웃/ }));
    expect(screen.getByRole("alertdialog", { name: "로그아웃하시겠습니까?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "예" }));

    await waitFor(() => expect(onLogout).toHaveBeenCalledOnce());
    expect(screen.getByRole("alertdialog", { name: "로그아웃 했습니다" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(onReturnToLogin).toHaveBeenCalledOnce();
  });

  it("verifies the password before confirming account withdrawal", async () => {
    const onDeleteAccount = vi.fn().mockResolvedValue(undefined);
    const onReturnToLogin = vi.fn();
    render(<MyScreen onDeleteAccount={onDeleteAccount} onReturnToLogin={onReturnToLogin} />);

    fireEvent.click(screen.getByRole("button", { name: "마이 메뉴" }));
    fireEvent.click(screen.getByRole("button", { name: "회원탈퇴" }));
    fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "Password!" } });
    fireEvent.click(screen.getByRole("button", { name: "탈퇴하기" }));
    expect(screen.getByRole("alertdialog", { name: "탈퇴하시겠습니까?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "예" }));

    await waitFor(() => expect(onDeleteAccount).toHaveBeenCalledWith("Password!"));
    expect(screen.getByRole("alertdialog", { name: "탈퇴되었습니다." })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(onReturnToLogin).toHaveBeenCalledOnce();
  });

  it("shows the Supabase withdrawal error instead of hiding it behind a generic message", async () => {
    const onDeleteAccount = vi.fn().mockRejectedValue({ message: "Could not find the function public.delete_current_user" });
    render(<MyScreen onDeleteAccount={onDeleteAccount} />);

    fireEvent.click(screen.getByRole("button", { name: "마이 메뉴" }));
    fireEvent.click(screen.getByRole("button", { name: "회원탈퇴" }));
    fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "Password!" } });
    fireEvent.click(screen.getByRole("button", { name: "탈퇴하기" }));
    fireEvent.click(screen.getByRole("button", { name: "예" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Could not find the function public.delete_current_user");
  });

  it("toggles account privacy and app notifications", () => {
    vi.useFakeTimers();
    render(<MyScreen />);

    fireEvent.click(screen.getByRole("button", { name: "마이 메뉴" }));
    fireEvent.click(screen.getByRole("button", { name: "계정 공개 범위" }));
    const privacyPage = screen.getByLabelText("계정 공개 범위 설정").closest(".my-settings-subpage");
    expect(privacyPage?.classList.contains("is-closing")).toBe(false);
    const privacy = screen.getByRole("switch", { name: "계정 공개" });
    expect(privacy.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(privacy);
    expect(privacy.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "설정으로 돌아가기" }));
    expect(privacyPage?.classList.contains("is-closing")).toBe(true);
    act(() => vi.advanceTimersByTime(280));
    fireEvent.click(screen.getByRole("button", { name: "알림 설정" }));
    const notifications = screen.getByRole("switch", { name: "앱 알림" });
    expect(notifications.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(notifications);
    expect(notifications.getAttribute("aria-checked")).toBe("false");
    vi.useRealTimers();
  });

  it("opens a profile post in the post detail flow", () => {
    const onOpenPost = vi.fn();
    render(<MyScreen username="Chloe.jung" displayName="가마쟁이" posts={YEJIN_DEMO_POSTS} onOpenPost={onOpenPost} />);

    fireEvent.click(screen.getByRole("button", { name: `${YEJIN_DEMO_POSTS[0].label} 게시물 보기` }));
    expect(onOpenPost).toHaveBeenCalledWith(YEJIN_DEMO_POSTS[0].id);

    fireEvent.click(screen.getByRole("tab", { name: "목록으로 보기" }));
    fireEvent.click(screen.getByRole("button", { name: `${YEJIN_DEMO_POSTS[1].label} 게시물 보기` }));
    expect(onOpenPost).toHaveBeenLastCalledWith(YEJIN_DEMO_POSTS[1].id);
  });
});
