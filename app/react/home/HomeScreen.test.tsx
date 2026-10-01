import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeScreen } from "./HomeScreen";

afterEach(cleanup);

describe("HomeScreen feed layouts", () => {
  it("starts in the photo grid and switches to a detailed glaze list", () => {
    render(<HomeScreen onStartWork={vi.fn()} onOpenProfile={vi.fn()} onOpenPost={vi.fn()} onOpenNotifications={vi.fn()} />);

    expect(screen.getByRole("button", { name: "격자 보기" }).getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".home-feed--grid")).toBeTruthy();
    expect(document.querySelector(".home-feed.grid")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "목록 보기" }));

    expect(screen.getByRole("button", { name: "목록 보기" }).getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelector(".home-feed--list")).toBeTruthy();
    expect(screen.getAllByText("청록 결정유").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Cone 6/).length).toBeGreaterThan(0);
    expect(document.querySelector(".home-feed")?.getAttribute("data-layout")).toBe("list");
  });

  it("keeps profile navigation available in list view", () => {
    const onOpenProfile = vi.fn();
    render(<HomeScreen onStartWork={vi.fn()} onOpenProfile={onOpenProfile} onOpenPost={vi.fn()} onOpenNotifications={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "목록 보기" }));
    fireEvent.click(screen.getAllByRole("button", { name: "chloe.jung 프로필 보기" })[0]);
    expect(onOpenProfile).toHaveBeenCalledWith("chloe");
  });

  it("opens the glaze post and pottery sale actions from the plus button", () => {
    render(<HomeScreen onStartWork={vi.fn()} onOpenProfile={vi.fn()} onOpenPost={vi.fn()} onOpenNotifications={vi.fn()} />);

    const createButton = screen.getByRole("button", { name: "게시하기" });
    expect(createButton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu", { name: "게시 유형 선택" })).toBeNull();

    fireEvent.click(createButton);

    expect(createButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "유약 게시" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "기물 판매" })).toBeTruthy();
  });

  it("opens a post detail from both grid and list feed cards", () => {
    const onOpenPost = vi.fn();
    render(<HomeScreen onStartWork={vi.fn()} onOpenProfile={vi.fn()} onOpenPost={onOpenPost} onOpenNotifications={vi.fn()} />);

    fireEvent.click(screen.getAllByRole("button", { name: "청록 결정유 게시물 보기" })[0]);
    expect(onOpenPost).toHaveBeenLastCalledWith("chloe-1");

    fireEvent.click(screen.getByRole("button", { name: "목록 보기" }));
    fireEvent.click(screen.getAllByRole("button", { name: "청록 결정유 게시물 보기" })[0]);
    expect(onOpenPost).toHaveBeenLastCalledWith("chloe-1");
  });

  it("opens the notification list from the top-right bell", () => {
    const onOpenNotifications = vi.fn();
    render(<HomeScreen onStartWork={vi.fn()} onOpenProfile={vi.fn()} onOpenPost={vi.fn()} onOpenNotifications={onOpenNotifications} />);

    expect(screen.queryByRole("button", { name: "저장한 게시물" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "알림 목록" }));
    expect(onOpenNotifications).toHaveBeenCalledTimes(1);
  });
});
