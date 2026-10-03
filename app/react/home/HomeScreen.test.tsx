import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeScreen } from "./HomeScreen";
import { FEED_POSTS } from "./feedData";

afterEach(cleanup);

describe("HomeScreen feed layouts", () => {
  const props = () => ({ onStartWork: vi.fn(), onCreatePost: vi.fn(), onOpenProfile: vi.fn(), onOpenPost: vi.fn(), onOpenSearch: vi.fn(), onOpenNotifications: vi.fn() });

  it("starts in the photo grid and switches to a detailed glaze list", () => {
    render(<HomeScreen {...props()} />);

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
    render(<HomeScreen {...props()} onOpenProfile={onOpenProfile} />);
    fireEvent.click(screen.getByRole("button", { name: "목록 보기" }));
    fireEvent.click(screen.getAllByRole("button", { name: "chloe.jung 프로필 보기" })[0]);
    expect(onOpenProfile).toHaveBeenCalledWith("chloe");
  });

  it("opens the glaze post and pottery sale actions from the plus button", () => {
    const onCreatePost = vi.fn();
    render(<HomeScreen {...props()} onCreatePost={onCreatePost} />);

    const createButton = screen.getByRole("button", { name: "게시하기" });
    expect(createButton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu", { name: "게시 유형 선택" })).toBeNull();

    fireEvent.click(createButton);

    expect(createButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("menuitem", { name: "작업 게시하기" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "내 기물 판매하기" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "게시 메뉴 바깥 영역 닫기" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "작업하기" })).toBeTruthy();
    expect(document.querySelector(".home-create-plus.is-open")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "내 기물 판매하기" }));
    expect(onCreatePost).toHaveBeenCalledWith("sale");
    expect(screen.queryByRole("menu", { name: "게시 유형 선택" })).toBeNull();
  });

  it("mixes a pottery sale post into the home feed with its price", () => {
    const salePost = { ...FEED_POSTS[0], id: "sale-1", kind: "sale" as const, glazeName: "푸른 달항아리", price: 85000, priceNegotiable: true };
    render(<HomeScreen {...props()} posts={[salePost, ...FEED_POSTS]} />);

    expect(screen.getByText("푸른 달항아리")).toBeTruthy();
    expect(screen.getByText("85,000원")).toBeTruthy();
    expect(screen.getByText("가격 협의 가능")).toBeTruthy();
  });

  it("opens a post detail from both grid and list feed cards", () => {
    const onOpenPost = vi.fn();
    render(<HomeScreen {...props()} onOpenPost={onOpenPost} />);

    fireEvent.click(screen.getAllByRole("button", { name: "청록 결정유 게시물 보기" })[0]);
    expect(onOpenPost).toHaveBeenLastCalledWith("chloe-1");

    fireEvent.click(screen.getByRole("button", { name: "목록 보기" }));
    fireEvent.click(screen.getAllByRole("button", { name: "청록 결정유 게시물 보기" })[0]);
    expect(onOpenPost).toHaveBeenLastCalledWith("chloe-1");
  });

  it("opens the notification list from the top-right bell", () => {
    const onOpenSearch = vi.fn();
    const onOpenNotifications = vi.fn();
    render(<HomeScreen {...props()} onOpenSearch={onOpenSearch} onOpenNotifications={onOpenNotifications} />);

    expect(screen.queryByRole("button", { name: "저장한 게시물" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "검색 열기" }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "알림 목록" }));
    expect(onOpenNotifications).toHaveBeenCalledTimes(1);
  });
});
