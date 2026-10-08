import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FEED_POSTS } from "./feedData";
import { SearchScreen } from "./SearchScreen";

afterEach(cleanup);

describe("SearchScreen", () => {
  it("finds recipe and sale posts by a contained name and opens a result", () => {
    const onOpenPost = vi.fn();
    render(<SearchScreen posts={FEED_POSTS} onBack={vi.fn()} onOpenPost={onOpenPost} />);
    const input = screen.getByRole("searchbox", { name: "검색" });
    fireEvent.change(input, { target: { value: "달항아리" } });
    expect(screen.getByText("푸른 빙렬 백자 달항아리")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /푸른 빙렬 백자 달항아리/ }));
    expect(onOpenPost).toHaveBeenCalledWith("sale-moon-jar");
    fireEvent.change(input, { target: { value: "청록 결정" } });
    expect(screen.getAllByText("청록 결정유").length).toBeGreaterThan(0);
  });

  it("shows an empty result message for an unknown name", () => {
    render(<SearchScreen posts={FEED_POSTS} onBack={vi.fn()} onOpenPost={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "검색" }), { target: { value: "없는 기물 이름" } });
    expect(screen.getByText("검색 결과가 없어요")).toBeTruthy();
  });
});
