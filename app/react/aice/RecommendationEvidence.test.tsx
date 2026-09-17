import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RecommendationEvidence } from "./RecommendationEvidence";

afterEach(cleanup);

describe("recommendation evidence", () => {
  it("shows rule/RAG provenance and a blocked trained model", () => {
    render(<RecommendationEvidence goal="satin-blue" />);
    expect(screen.getByText("학습 모델 미사용")).toBeTruthy();
    expect(screen.getAllByText(/생성 경로: 출처 있는 규칙/)).toHaveLength(3);
    expect(screen.getByText(/제품 경로에서 차단/)).toBeTruthy();
  });

  it("exposes complete source fields and rights boundary", () => {
    render(<RecommendationEvidence goal="clear-warm" />);
    fireEvent.click(screen.getByText("특허·문헌 출처 카드 보기"));
    expect(screen.getByText("TW202533100A / TWI857914B")).toBeTruthy();
    expect(screen.getAllByText("원 조건").length).toBeGreaterThanOrEqual(6);
    expect(screen.getByText(/특허 사진·도면과 외부 결과 사진/)).toBeTruthy();
  });
});
