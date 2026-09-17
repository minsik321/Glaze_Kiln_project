import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResultFeedback } from "./ResultFeedback";
import type { ResultEvaluation } from "./feedback";

afterEach(cleanup);
const initial: ResultEvaluation = { match: null, color: null, gloss: null, texture: null, transparency: null, defects: [], scope: "personal", resultPhoto: null };
function Harness({ targetPhoto }: { targetPhoto?: { base64: string; mediaType: string } | null }) {
  const [value, setValue] = useState(initial);
  return <ResultFeedback value={value} onChange={setValue} targetPhoto={targetPhoto} />;
}

describe("result feedback", () => {
  it("lets the operator attach an observed photo and shows it as the observed result", async () => {
    render(<Harness />);
    const file = new File(["fake-image-bytes"], "result.png", { type: "image/png" });
    const input = screen.getByLabelText("관찰 사진 첨부") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByAltText("첨부한 관찰 사진")).toBeTruthy());
    expect(screen.getByText("result.png")).toBeTruthy();
  });

  it("shows the selected recipe's generated image as the target photo when one is available", () => {
    render(<Harness targetPhoto={{ base64: "Zm9v", mediaType: "image/png" }} />);
    const img = screen.getByAltText(/목표 레시피의 AI 예상 이미지/) as HTMLImageElement;
    expect(img.src).toContain("data:image/png;base64,Zm9v");
  });

  it("has no standardized photo guide and no next-recommendation-effects drawer", () => {
    render(<Harness />);
    expect(screen.queryByText(/색온도 약 5000K/)).toBeNull();
    expect(screen.queryByText(/색상 기준표\(24색 컬러체커/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "차이가 있어요" }));
    expect(screen.queryByText("다음 추천에 미치는 영향")).toBeNull();
  });

  it("makes numeric choices and defects available without requiring a photo", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "차이가 있어요" }));
    fireEvent.click(screen.getByRole("button", { name: "핀홀" }));
    expect(screen.getByRole("button", { name: "핀홀" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps common improvement as a review candidate", () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText(/공통 개선 검토 후보/));
    expect(screen.getByText(/공통 모델을 자동 갱신하지 않습니다/)).toBeTruthy();
  });
});
