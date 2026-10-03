import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ResultFeedback } from "./ResultFeedback";
import type { ResultEvaluation } from "./feedback";

afterEach(cleanup);
const initial: ResultEvaluation = { match: null, color: null, gloss: null, texture: null, transparency: null, defects: [], defectSeverities: {}, scope: "personal", resultPhoto: null };
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
    fireEvent.click(screen.getByRole("button", { name: "나중에 입력" }));
    const img = screen.getByAltText(/목표 레시피의 AI 예상 이미지/) as HTMLImageElement;
    expect(img.src).toContain("data:image/png;base64,Zm9v");
  });

  it("has no standardized photo guide and no next-recommendation-effects drawer", () => {
    render(<Harness />);
    expect(screen.queryByText(/색온도 약 5000K/)).toBeNull();
    expect(screen.queryByText(/색상 기준표\(24색 컬러체커/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "나중에 입력" }));
    fireEvent.click(screen.getByRole("button", { name: "차이가 있어요" }));
    expect(screen.queryByText("다음 추천에 미치는 영향")).toBeNull();
  });

  it("makes numeric choices and defects available without requiring a photo", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "나중에 입력" }));
    fireEvent.click(screen.getByRole("button", { name: "차이가 있어요" }));
    fireEvent.click(screen.getByRole("button", { name: "가까움" }));
    fireEvent.click(within(screen.getByRole("group", { name: "광택" })).getByRole("button", { name: "목표와 일치함" }));
    fireEvent.click(within(screen.getByRole("group", { name: "질감" })).getByRole("button", { name: "목표와 일치함" }));
    fireEvent.click(within(screen.getByRole("group", { name: "투명도" })).getByRole("button", { name: "목표와 일치함" }));
    fireEvent.click(screen.getByRole("button", { name: "핀홀" }));
    expect(screen.getByRole("button", { name: "핀홀" }).getAttribute("aria-pressed")).toBe("true");
    const severity = screen.getByRole("combobox", { name: "핀홀 정도" }) as HTMLSelectElement;
    fireEvent.change(severity, { target: { value: "4" } });
    expect(severity.value).toBe("4");
  });

  it("reveals each target-relative field only after the previous answer", () => {
    render(<Harness />);
    expect(screen.getByRole("heading", { name: "결과를 기록해요" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "목표와 전체 인상" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "나중에 입력" }));
    fireEvent.click(screen.getByRole("button", { name: "목표에 가까워요" }));
    expect(screen.getByRole("group", { name: "색상" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "광택" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "가까움" }));
    fireEvent.click(within(screen.getByRole("group", { name: "광택" })).getByRole("button", { name: "목표와 일치함" }));
    expect(within(screen.getByRole("group", { name: "질감" })).getByRole("button", { name: "아주 거침" })).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "질감" })).getByRole("button", { name: "아주 매끈함" })).toBeTruthy();
    expect(screen.queryByText("결함을 확인했습니다")).toBeNull();
    expect(screen.queryByText("이 평가의 사용 범위")).toBeNull();
  });
});
