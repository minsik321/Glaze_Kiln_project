import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PostPhotoCarousel } from "./PostPhotoCarousel";

afterEach(cleanup);

const THREE = ["a.png", "b.png", "c.png"];

function scrollTo(track: HTMLElement, left: number, width = 300) {
  Object.defineProperty(track, "clientWidth", { configurable: true, value: width });
  track.scrollLeft = left;
  fireEvent.scroll(track);
}

describe("PostPhotoCarousel", () => {
  it("renders a single photo with no page indicator", () => {
    render(<PostPhotoCarousel images={["a.png"]} alt="유약 작업" />);
    expect(screen.getByAltText("유약 작업")).toBeTruthy();
    expect(screen.queryByText(/\d+\/\d+/)).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("shows every photo and a 1/N indicator when there are several", () => {
    render(<PostPhotoCarousel images={THREE} alt="유약 작업" />);
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.getByText("1/3")).toBeTruthy();
    expect(screen.getByRole("group").getAttribute("aria-label")).toBe("유약 작업 사진 3장");
  });

  it("updates the indicator as the user swipes to another photo", () => {
    render(<PostPhotoCarousel images={THREE} alt="유약 작업" />);
    const track = screen.getByRole("group");
    scrollTo(track, 300);
    expect(screen.getByText("2/3")).toBeTruthy();
    scrollTo(track, 600);
    expect(screen.getByText("3/3")).toBeTruthy();
    scrollTo(track, 0);
    expect(screen.getByText("1/3")).toBeTruthy();
  });

  it("moves with the arrow keys and stops at both ends", () => {
    render(<PostPhotoCarousel images={THREE} alt="유약 작업" />);
    const track = screen.getByRole("group");
    fireEvent.keyDown(track, { key: "ArrowLeft" });
    expect(screen.getByText("1/3")).toBeTruthy();
    fireEvent.keyDown(track, { key: "ArrowRight" });
    fireEvent.keyDown(track, { key: "ArrowRight" });
    fireEvent.keyDown(track, { key: "ArrowRight" });
    expect(screen.getByText("3/3")).toBeTruthy();
  });

  it("applies the image class to every photo", () => {
    render(<PostPhotoCarousel images={THREE} alt="판매" imageClassName="sale-detail-image" />);
    expect(screen.getAllByRole("img").every((img) => img.classList.contains("sale-detail-image"))).toBe(true);
  });
});
