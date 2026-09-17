import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecipeChatScreen } from "./RecipeChatScreen";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CANDIDATE = {
  id: "cand-1",
  name: "해안 사틴",
  materials: { 장석: 40, 석회석: 20, 규석: 25, 카올린: 15 },
  colorants: { CuO: 2, CoO: 0.2 },
  colorant_note: "청록색 참고 출발값이며 실제 발색은 달라질 수 있음",
  predicted_firing_range: { value: [1180, 1230], unit: "°C", source_type: "inferred", confidence: 0.4, note: "" },
  predicted_firing_note: "환원 소성 (Stull 참조: satin — 참조일 뿐)",
  photo: { id: "cand-1-photo", kind: "recipe", storage_path: null, placeholder: true, source_type: "synthetic", rights_confirmed: true, alt: "" },
  source_type: "inferred",
  source_ids: [],
};

function mockSuggestResponse(overrides: Partial<{ candidates: unknown[]; dropped: string[] }> = {}) {
  return new Response(
    JSON.stringify({
      prompt_text: "청록색 사틴 유약",
      candidates: overrides.candidates ?? [CANDIDATE],
      dropped: overrides.dropped ?? [],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("RecipeChatScreen (화면 1)", () => {
  it("submits the prompt and renders validated candidates with the LLM-not-guaranteed badge", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(mockSuggestResponse());
    render(<RecipeChatScreen token="user-token" />);

    fireEvent.change(screen.getByLabelText("원하는 결과를 설명해 주세요"), {
      target: { value: "사발에 어울리는 청록색 사틴 유약" },
    });
    fireEvent.click(screen.getByText("후보 만들기"));

    await waitFor(() => expect(screen.getByText("해안 사틴")).toBeTruthy());
    expect(screen.getByText("AI 제안 · 실측 아님")).toBeTruthy();
    expect(screen.getByText("장석")).toBeTruthy();
    expect(screen.getByText("발색 산화물 (외배합)")).toBeTruthy();
    expect(screen.getByText("CuO")).toBeTruthy();
    expect(screen.getByText(/청록색 참고 출발값/)).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toContain("/aice/recipe-candidates");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.prompt_text).toBe("사발에 어울리는 청록색 사틴 유약");
  });

  it("shows dropped candidates without hiding the ones that passed validation", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockSuggestResponse({ dropped: ["cand-2: 목회는 원료 DB에 없다(05-1절)"] }),
    );
    render(<RecipeChatScreen token="user-token" />);
    fireEvent.change(screen.getByLabelText("원하는 결과를 설명해 주세요"), { target: { value: "유약" } });
    fireEvent.click(screen.getByText("후보 만들기"));

    await waitFor(() => expect(screen.getByText("해안 사틴")).toBeTruthy());
    fireEvent.click(screen.getByText("검증에서 버려진 후보 1건 보기"));
    expect(screen.getByText(/목회는 원료 DB에 없다/)).toBeTruthy();
  });

  it("surfaces a backend error without crashing the form", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ detail: { code: "aimlapi_unavailable", message: "aimlapi.com에 연결할 수 없습니다." } }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      ),
    );
    render(<RecipeChatScreen token="user-token" />);
    fireEvent.change(screen.getByLabelText("원하는 결과를 설명해 주세요"), { target: { value: "유약" } });
    fireEvent.click(screen.getByText("후보 만들기"));

    await waitFor(() => expect(screen.getByText("aimlapi.com에 연결할 수 없습니다.")).toBeTruthy());
  });

  it("requests a per-candidate image only on explicit click", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(mockSuggestResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ image_base64: "Zm9v", media_type: "image/png" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    render(<RecipeChatScreen token="user-token" />);
    fireEvent.change(screen.getByLabelText("원하는 결과를 설명해 주세요"), { target: { value: "유약" } });
    fireEvent.click(screen.getByText("후보 만들기"));
    await waitFor(() => expect(screen.getByText("해안 사틴")).toBeTruthy());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("예상 이미지 생성"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toContain("/aice/recipe-candidates/image");
    await waitFor(() => expect(screen.getByAltText(/AI 예상 이미지/)).toBeTruthy());
  });

  it("lets the user select a candidate and notifies the parent", async () => {
    const onSelect = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockSuggestResponse());
    render(<RecipeChatScreen token="user-token" onSelect={onSelect} />);
    fireEvent.change(screen.getByLabelText("원하는 결과를 설명해 주세요"), { target: { value: "유약" } });
    fireEvent.click(screen.getByText("후보 만들기"));
    await waitFor(() => expect(screen.getByText("선택됨")).toBeTruthy());

    fireEvent.click(screen.getByText("선택됨"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "cand-1" }));
  });
});
