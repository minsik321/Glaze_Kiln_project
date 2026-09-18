import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecipeChatScreen } from "./RecipeChatScreen";
import { sampleAiceRun, type ChatIntake, type RecipeCandidate } from "./contract";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CANDIDATE: RecipeCandidate = {
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
  target_gloss: "SATIN",
  target_transparency: "OPAQUE",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function suggestResponse(overrides: Partial<{ candidates: unknown[]; dropped: string[] }> = {}) {
  return jsonResponse({ prompt_text: "청록색 사틴 유약", candidates: overrides.candidates ?? [CANDIDATE], dropped: overrides.dropped ?? [] });
}

function imageResponse() {
  return jsonResponse({ image_base64: "Zm9v", media_type: "image/png" });
}

function historyPage(items: unknown[] = []) {
  return jsonResponse({ items, limit: 20, offset: 0 });
}

function historyRecord(overrides: Partial<{ id: string; title: string; intake: ChatIntake | null }> = {}) {
  const run = sampleAiceRun();
  const title = overrides.title ?? "예전 질문";
  const intake: ChatIntake | null = overrides.intake !== undefined
    ? overrides.intake
    : { prompt_text: title, prompt_photos: [], candidates: { candidates: [CANDIDATE], selected_id: null } };
  return {
    id: overrides.id ?? "run-1",
    title,
    run: { ...run, intake },
    schema_version: 3 as const,
    status: run.status,
    goal_gloss: run.goal.gloss,
    goal_transparency: run.goal.transparency,
    recipe_id: run.recipe.id,
    ware_preset: run.ware.preset,
    is_public: false,
    created_at: run.created_at,
    updated_at: run.updated_at,
  };
}

//: RecipeChatScreen은 마운트 시 이력(listMine)을 먼저 부르고, 제출 시
//: 후보 생성과 카드별 이미지 자동 생성을 함께 부른다 — 호출 "순서"가 아니라
//: URL로 분기해야 실제 동작과 맞는 테스트가 된다.
function mockFetch({
  suggest = suggestResponse(),
  history = historyPage(),
  image = imageResponse(),
}: { suggest?: Response; history?: Response; image?: Response } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/recipe-candidates/image")) return image;
    if (url.includes("/aice/recipe-candidates")) return suggest;
    if (url.includes("/aice-runs")) return history;
    throw new Error(`unexpected fetch in test: ${url}`);
  });
}

function findCall(fetchMock: ReturnType<typeof mockFetch>, match: string) {
  return fetchMock.mock.calls.find(([url]) => String(url).includes(match));
}

describe("RecipeChatScreen (화면 1)", () => {
  it("submits the prompt and renders validated candidates with the LLM-not-guaranteed badge", async () => {
    const fetchMock = mockFetch();
    render(<RecipeChatScreen token="user-token" />);

    fireEvent.change(screen.getByLabelText("원하는 결과를 설명해 주세요"), {
      target: { value: "사발에 어울리는 청록색 사틴 유약" },
    });
    fireEvent.click(screen.getByText("후보 만들기"));

    await waitFor(() => expect(screen.getByText("해안 사틴")).toBeTruthy());
    expect(screen.getByText("장석")).toBeTruthy();
    expect(screen.getByText("발색 산화물 (외배합)")).toBeTruthy();
    expect(screen.getByText("CuO")).toBeTruthy();
    expect(screen.getByText(/청록색 참고 출발값/)).toBeTruthy();
    const suggestCall = findCall(fetchMock, "/aice/recipe-candidates");
    expect(suggestCall).toBeTruthy();
    const body = JSON.parse(String(suggestCall?.[1]?.body));
    expect(body.prompt_text).toBe("사발에 어울리는 청록색 사틴 유약");
  });

  it("shows dropped candidates without hiding the ones that passed validation", async () => {
    mockFetch({ suggest: suggestResponse({ dropped: ["cand-2: 목회는 원료 DB에 없다(05-1절)"] }) });
    render(<RecipeChatScreen token="user-token" />);
    fireEvent.change(screen.getByLabelText("원하는 결과를 설명해 주세요"), { target: { value: "유약" } });
    fireEvent.click(screen.getByText("후보 만들기"));

    await waitFor(() => expect(screen.getByText("해안 사틴")).toBeTruthy());
    fireEvent.click(screen.getByText("검증에서 버려진 후보 1건 보기"));
    expect(screen.getByText(/목회는 원료 DB에 없다/)).toBeTruthy();
  });

  it("surfaces a backend error without crashing the form", async () => {
    mockFetch({
      suggest: jsonResponse(
        { detail: { code: "aimlapi_unavailable", message: "aimlapi.com에 연결할 수 없습니다." } },
        502,
      ),
    });
    render(<RecipeChatScreen token="user-token" />);
    fireEvent.change(screen.getByLabelText("원하는 결과를 설명해 주세요"), { target: { value: "유약" } });
    fireEvent.click(screen.getByText("후보 만들기"));

    await waitFor(() => expect(screen.getByText("aimlapi.com에 연결할 수 없습니다.")).toBeTruthy());
  });

  it("requests each candidate's image automatically, with no manual button", async () => {
    const fetchMock = mockFetch();
    render(<RecipeChatScreen token="user-token" />);
    fireEvent.change(screen.getByLabelText("원하는 결과를 설명해 주세요"), { target: { value: "유약" } });
    fireEvent.click(screen.getByText("후보 만들기"));
    await waitFor(() => expect(screen.getByText("해안 사틴")).toBeTruthy());

    expect(screen.queryByText("예상 이미지 생성")).toBeNull();
    await waitFor(() => expect(findCall(fetchMock, "/recipe-candidates/image")).toBeTruthy());
    await waitFor(() => expect(screen.getByAltText(/AI 예상 이미지/)).toBeTruthy());
  });

  it("lets the user select a candidate and notifies the parent", async () => {
    const onSelect = vi.fn();
    mockFetch();
    render(<RecipeChatScreen token="user-token" onSelect={onSelect} />);
    fireEvent.change(screen.getByLabelText("원하는 결과를 설명해 주세요"), { target: { value: "유약" } });
    fireEvent.click(screen.getByText("후보 만들기"));
    await waitFor(() => expect(screen.getByText("선택됨")).toBeTruthy());

    fireEvent.click(screen.getByText("선택됨"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toEqual(expect.objectContaining({ id: "cand-1" }));
  });

  it("passes the candidate's generated image along with the selection once it arrives", async () => {
    const onSelect = vi.fn();
    mockFetch();
    render(<RecipeChatScreen token="user-token" onSelect={onSelect} />);
    fireEvent.change(screen.getByLabelText("원하는 결과를 설명해 주세요"), { target: { value: "유약" } });
    fireEvent.click(screen.getByText("후보 만들기"));
    await waitFor(() => expect(screen.getByAltText(/AI 예상 이미지/)).toBeTruthy());

    fireEvent.click(screen.getByText("선택됨"));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "cand-1" }),
      { base64: "Zm9v", mediaType: "image/png" },
    );
  });

  it("calls onGenerated only for a fresh submit, not for a restore", async () => {
    const onGenerated = vi.fn();
    const onIntake = vi.fn();
    mockFetch();
    render(<RecipeChatScreen token="user-token" onGenerated={onGenerated} onIntake={onIntake} />);
    fireEvent.change(screen.getByLabelText("원하는 결과를 설명해 주세요"), { target: { value: "유약" } });
    fireEvent.click(screen.getByText("후보 만들기"));
    await waitFor(() => expect(screen.getByText("해안 사틴")).toBeTruthy());

    expect(onGenerated).toHaveBeenCalledTimes(1);
    expect(onIntake).toHaveBeenCalledWith("유약", expect.arrayContaining([expect.objectContaining({ id: "cand-1" })]));
  });

  it("opens a history sidebar of past questions and restores the chosen one", async () => {
    const record = historyRecord({ id: "run-9", title: "지난주 청록 유약" });
    mockFetch({ history: historyPage([record]) });
    const onIntake = vi.fn();
    render(<RecipeChatScreen token="user-token" onIntake={onIntake} />);

    fireEvent.click(screen.getByLabelText("이전 질문 기록 열기"));
    await waitFor(() => expect(screen.getByText("지난주 청록 유약")).toBeTruthy());

    fireEvent.click(screen.getByText("지난주 청록 유약"));
    await waitFor(() => expect(screen.getByDisplayValue("지난주 청록 유약")).toBeTruthy());
    expect(screen.getByText("해안 사틴")).toBeTruthy();
    expect(onIntake).toHaveBeenCalledWith("지난주 청록 유약", expect.arrayContaining([expect.objectContaining({ id: "cand-1" })]));
  });

  it("surfaces a similar past candidate from history with a remark when a new prompt overlaps it", async () => {
    const pastCandidate = { ...CANDIDATE, id: "hist-cand-1", name: "지난 청록 사틴" };
    const record = historyRecord({
      id: "run-5",
      title: "사발 청록 사틴 유약",
      intake: { prompt_text: "사발 청록 사틴 유약", prompt_photos: [], candidates: { candidates: [pastCandidate], selected_id: null } },
    });
    mockFetch({ history: historyPage([record]) });
    render(<RecipeChatScreen token="user-token" />);

    // 이력이 실제로 로드된 뒤 제출해야 한다 — 마운트 시점 listMine 호출이
    // 비동기라, 로드 전에 곧장 제출하면 매칭 대상이 비어 있다.
    fireEvent.click(screen.getByLabelText("이전 질문 기록 열기"));
    await waitFor(() => expect(screen.getByText("사발 청록 사틴 유약")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("이전 질문 기록 열기"));

    fireEvent.change(screen.getByLabelText("원하는 결과를 설명해 주세요"), {
      target: { value: "사발에 어울리는 청록 사틴 유약을 또 찾고 있어요" },
    });
    fireEvent.click(screen.getByText("후보 만들기"));

    await waitFor(() => expect(screen.getByText("지난 청록 사틴")).toBeTruthy());
    expect(screen.getByText("과거 이력 · 유사 후보")).toBeTruthy();
    expect(screen.getByText(/사발 청록 사틴 유약/)).toBeTruthy();
  });
});
