import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChoiceChip, DetailDrawer, ProgressHeader, StateGallery, StatusBadge } from "./ui";

afterEach(cleanup);

describe("AICE design system", () => {
  it("renders every reusable async state without data", () => {
    render(<StateGallery />);
    for (const label of ["아직 기록이 없어요", "계산 엔진을 준비하고 있어요", "불러오지 못했어요", "판정 불가", "가상 실행을 기록했어요"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("exposes progress and selection semantics", () => {
    const onClick = () => undefined;
    render(<><ProgressHeader current={2} total={3} labels={["홈", "선택", "완료"]} /><ChoiceChip selected onClick={onClick}>균형</ChoiceChip><StatusBadge tone="unavailable">판정 불가</StatusBadge></>);
    expect(screen.getByText("2 / 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "균형" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("판정 불가")).toBeTruthy();
  });

  it("keeps technical detail collapsed until requested", () => {
    render(<DetailDrawer><p>원시값과 수식</p></DetailDrawer>);
    const details = screen.getByText("상세 보기").closest("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByText("상세 보기"));
    expect(details.open).toBe(true);
  });
});

