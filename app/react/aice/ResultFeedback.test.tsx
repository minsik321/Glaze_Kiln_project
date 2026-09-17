import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResultFeedback } from "./ResultFeedback";
import type { ResultEvaluation } from "./feedback";

afterEach(cleanup);
const initial: ResultEvaluation = { match: null, color: null, gloss: null, texture: null, transparency: null, defects: [], scope: "personal" };
function Harness() { const [value, setValue] = useState(initial); return <ResultFeedback value={value} onChange={setValue} />; }

describe("result feedback", () => {
  it("shows a standardized photo guide and easy evaluation choices", () => {
    render(<Harness />);
    expect(screen.getByText(/색온도 약 5000K/)).toBeTruthy();
    expect(screen.getByText(/색상 기준표\(24색 컬러체커/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "차이가 있어요" }));
    fireEvent.click(screen.getByRole("button", { name: "핀홀" }));
    fireEvent.click(screen.getByText("다음 추천에 미치는 영향"));
    expect(screen.getByText(/다음 레시피·곡선 후보 재비교/)).toBeTruthy();
  });

  it("keeps common improvement as a review candidate", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText(/공통 개선 검토 후보/));
    expect(screen.getByText(/공통 모델을 자동 갱신하지 않습니다/)).toBeTruthy();
  });
});
