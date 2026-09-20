import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AicePrototype } from "./AicePrototype";
import type { RecipeCandidate } from "./contract";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

//: CurveControlPanel이 마운트되면 곧바로 kiln.firing 백엔드를 부른다 — 이
//: 파일의 시나리오는 그 계산 결과 자체를 검증하지 않으므로(그건
//: curvePlan.test.ts·backend/tests/test_kiln_bridge.py의 몫) 고정된 최소
//: 응답 하나로 충분하다.
function kilnSimulateResponse() {
  return jsonResponse({
    samples: [
      { t_s: 0, minute: 0, sensor_c: 20, ware_c: 20, power_w: 0, phase: "승온", outer_mode: "감시", hold_extension_s: 0, message: "", paused: false },
      { t_s: 18000, minute: 300, sensor_c: 950, ware_c: 940, power_w: 5000, phase: "유지", outer_mode: "능동", hold_extension_s: 0, message: "", paused: false },
      { t_s: 28800, minute: 480, sensor_c: 640, ware_c: 650, power_w: 0, phase: "냉각", outer_mode: "감시", hold_extension_s: 0, message: "", paused: false },
    ],
    provenance_notes: ["12-2절: 생성기는 추정 모델과 구조적으로 다르게 오지정되어 있다"],
    e_note: "E=300000 J/mol (미정값 · 가정: 9-5절 외측 루프 운용을 위한 가정)",
    target_heat_work: 1.0,
    peak_c: 1199,
    max_power_w: 6000,
  });
}

function historyPage(items: unknown[] = []) {
  return jsonResponse({ items, limit: 20, offset: 0 });
}

function imageResponse() {
  return jsonResponse({ image_base64: "Zm9v", media_type: "image/png" });
}

//: 5페이지(도포) 확인 버튼이 이제 실측 무게 계산 결과로만 켜지므로,
//: 화면 흐름을 끝까지 타는 테스트는 이 응답도 필요하다 — total을 기본
//: 안전 범위(0.8–1.3mm) 안에 둬 "target" 분류가 되게 한다(다른 값을 쓰는
//: 테스트는 own thicknessProfile을 넘겨 검증하는 thicknessView.test.ts의 몫).
function thicknessProfileResponse() {
  const points = [0, 1, 2].map((index) => ({ z: index * 20, radius: 30 + index * 10, t_abs: 1.0, t_flow: 0, total: 1.0 }));
  return jsonResponse({
    points,
    area_m2: 0.05,
    mean_mm: 1.0,
    areal_density_g_m2: 700,
    glaze_weight_g: 35,
    rho_dry: 1.5,
    has_distribution: true,
    within_model_scope: true,
    local_max_mm: 1.0,
    local_min_mm: 1.0,
    spread_mm: 0,
    provenance_notes: [],
  });
}

//: RecipeChatScreen이 항상(hidden으로만) 마운트돼 있어 token이 있으면
//: 마운트 즉시 이력을 부르고, 후보 제출 시 이미지도 후보마다 자동으로
//: 부른다 — URL로 분기해야 실제 호출 패턴과 맞는다. image는 후보마다
//: 매번 새 Response를 만들어 돌려준다(같은 Response 재사용 시 다중 후보에서
//: body를 두 번 읽게 된다).
function mockFetch({
  suggest = jsonResponse({ prompt_text: "", candidates: [], dropped: [] }),
  history = historyPage(),
}: { suggest?: Response; history?: Response } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/kiln/firing/simulate")) return kilnSimulateResponse();
    if (url.includes("/kiln/thickness/profile")) return thicknessProfileResponse();
    if (url.includes("/recipe-candidates/image")) return imageResponse();
    if (url.includes("/aice/recipe-candidates")) return suggest;
    if (url.includes("/aice-runs")) {
      //: 1페이지 자동 저장과 9페이지 "저장" 버튼 둘 다 POST /aice-runs를
      //: 부른다 — 보낸 run을 그대로 AiceRunRecord 모양으로 감싸 돌려준다
      //: (검증(assertAiceRun)을 통과하려면 완전한 AiceRun이어야 한다).
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        return jsonResponse({
          id: "saved-run-1",
          title: body.title,
          run: body.run,
          schema_version: 3,
          status: body.run.status,
          goal_gloss: body.run.goal.gloss,
          goal_transparency: body.run.goal.transparency,
          recipe_id: body.run.recipe.id,
          ware_preset: body.run.ware.preset,
          is_public: body.is_public ?? false,
          created_at: "2026-09-18T00:00:00.000Z",
          updated_at: "2026-09-18T00:00:00.000Z",
        });
      }
      return history;
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
}

//: 5페이지에서 도포 상태가 계산되려면 시유 전/후 무게(기본 방식이
//: "담금"이라 담금시간도)와 건조 완료 확인을 입력해야 한다 — 선택 버튼이
//: 없어졌고(weightsReady가 state.dryingComplete를 요구, AicePrototype.tsx),
//: 입력 변경 시 이전 계산이 무효화되는 게 항목 6의 요구사항이므로 여기서도
//: 실제 사용자 흐름과 같은 순서로 체크박스를 눌러야 한다.
function fillWeightInputs() {
  fireEvent.change(screen.getByLabelText(/시유 전\(g\)/), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText(/시유 후\(g\)/), { target: { value: "120" } });
  fireEvent.change(screen.getByLabelText(/담금시간\(초\)/), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /완전히 건조된 상태/ }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

//: 화면 1(AI 제안)은 로그인 없이도 "샘플 실험 시작"으로 후보를 고르지
//: 않고 다음 화면으로 넘어갈 수 있다(canContinue[0] === true). 아래
//: 시나리오들은 후보 선택 자체가 아니라 그 뒤(기물·도포·적재·곡선·소성·평가)
//: 흐름을 검증하므로 그 경로를 그대로 쓴다.
async function skipToWare() {
  fireEvent.click(screen.getByRole("button", { name: /샘플 실험 시작/ }));
}

describe("AICE guided prototype", () => {
  it("finishes a sample simulation without numeric input", async () => {
    mockFetch();
    render(<AicePrototype />);
    await skipToWare();
    fireEvent.click(screen.getByRole("button", { name: /^사발/ }));
    fireEvent.click(screen.getByRole("button", { name: /백색 석기 소지/ }));
    fireEvent.click(screen.getByRole("button", { name: /^다음/ }));
    fillWeightInputs();
    const riskButton = screen.getByRole("button", { name: /소성 계획/ });
    await waitFor(() => expect((riskButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(riskButton);
    fireEvent.click(screen.getByRole("button", { name: /^다음/ }));
    // v9 후속: 가마 화면에서 재생 버튼 하나가 승인과 재생을 함께 한다.
    const playButton = screen.getByRole("button", { name: "이 계획대로 가마에 적용해서 시작" });
    await waitFor(() => expect((playButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(playButton);
    fireEvent.click(screen.getByRole("button", { name: /^다음/ }));
    fireEvent.click(screen.getByRole("button", { name: /목표에 가까워요/ }));
    expect(screen.getByTestId("aice-step-5")).toBeTruthy();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    // v9: 로그인 없는 데모 흐름에서는 저장 버튼이 비활성 상태로 나타난다.
    expect(screen.getByRole("button", { name: /저장하고 작업기록으로 이동/ })).toBeTruthy();
  });

  it("exports a versioned AiceRun with provenance and private consent", async () => {
    const onSnapshotReady = vi.fn();
    render(<AicePrototype onSnapshotReady={onSnapshotReady} />);
    const getter = onSnapshotReady.mock.calls.at(-1)?.[0];
    await expect(getter()).resolves.toMatchObject({
      schema_version: 3,
      sources: [{ source_type: "literature" }],
      consent: { share_allowed: false },
      versions: { rule_model: "aice-rule-rag-1", predictor: "aice-predictor-draft-1" },
    });
  });

  it("records only an approved curve and its synthetic controller samples", async () => {
    mockFetch();
    const onSnapshotReady = vi.fn();
    render(<AicePrototype onSnapshotReady={onSnapshotReady} />);
    await skipToWare();
    for (const name of [/^사발/, /백색 석기 소지/, /^다음/]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    fillWeightInputs();
    const riskButton = screen.getByRole("button", { name: /소성 계획/ });
    await waitFor(() => expect((riskButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(riskButton);
    fireEvent.click(screen.getByRole("button", { name: /^다음/ }));
    let getter = onSnapshotReady.mock.calls.at(-1)?.[0];
    await expect(getter()).resolves.toMatchObject({ curves: { selected_id: null }, pid: { parameters: {}, samples: [] } });
    const playButton = screen.getByRole("button", { name: "이 계획대로 가마에 적용해서 시작" });
    await waitFor(() => expect((playButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(playButton);
    getter = onSnapshotReady.mock.calls.at(-1)?.[0];
    const run = await getter();
    expect(run.curves.selected_id).toMatch(/personalized-target/);
    expect(run.curves.candidates.find((curve: { id: string }) => curve.id === run.curves.selected_id)?.role).toBe("selected");
    expect(run.pid).toMatchObject({ decision: "accepted", controller_kind: "feedforward_p" });
    expect(run.pid.samples.length).toBeGreaterThan(0);
    expect(Object.values(run.pid.parameters).every((value: unknown) => (value as { source_type: string }).source_type === "synthetic")).toBe(true);
  });

  it("propagates a recipe candidate change through to the predicted next-run curve (Phase 6 integration check)", async () => {
    const base: RecipeCandidate = {
      id: "cand-a",
      name: "해안 사틴 A",
      materials: { 장석: 40, 석회석: 20, 규석: 25, 카올린: 15 },
      colorants: {},
      colorant_note: "",
      predicted_firing_range: { value: [1180, 1230], unit: "°C", source_type: "inferred", confidence: 0.4, note: "" },
      predicted_firing_note: "",
      photo: { id: "cand-a-photo", kind: "recipe", storage_path: null, placeholder: true, source_type: "synthetic", rights_confirmed: true, alt: "" },
      source_type: "inferred",
      source_ids: [],
      target_gloss: "SATIN",
      target_transparency: "OPAQUE",
    };
    const candidateA = base;
    const candidateB: RecipeCandidate = {
      ...base,
      id: "cand-b",
      name: "웜 클리어 B",
      photo: { ...base.photo, id: "cand-b-photo" },
      predicted_firing_range: { value: [1200, 1260], unit: "°C", source_type: "inferred", confidence: 0.4, note: "" },
    };
    mockFetch({ suggest: jsonResponse({ prompt_text: "유약", candidates: [candidateA, candidateB], dropped: [] }) });
    const onSnapshotReady = vi.fn();
    render(<AicePrototype onSnapshotReady={onSnapshotReady} token="test-token" />);

    fireEvent.change(screen.getByLabelText("원하는 결과를 설명해 주세요"), { target: { value: "유약" } });
    fireEvent.click(screen.getByText("후보 만들기"));
    await waitFor(() => expect(screen.getByText("해안 사틴 A")).toBeTruthy());

    // 첫 후보는 도착 즉시 카드 내부적으로 "선택됨"으로 보이지만(로컬
    // selectedId 기본값), 그것만으로는 부모(state.llmCandidate)에 아직
    // 반영되지 않는다 — 버튼을 실제로 눌러야 onSelect가 불린다.
    const cardA = screen.getByText("해안 사틴 A").closest("article")!;
    fireEvent.click(within(cardA).getByRole("button"));
    // toFiringCurve(curvePlan.ts)는 아직 승인되지 않은 개인화 후보(내부
    // role "adjusted")를 노출 role "candidate"로 매핑한다 — 승인되면
    // "selected"로 바뀐다("records only an approved curve" 테스트가
    // 그 경로를 검증). 여기서는 아직 승인 전이므로 "candidate"를 찾는다.
    const coastalRun = await onSnapshotReady.mock.calls.at(-1)?.[0]();
    const coastalNext = coastalRun.curves.candidates.find((curve: { role: string }) => curve.role === "candidate");

    const cardB = screen.getByText("웜 클리어 B").closest("article")!;
    fireEvent.click(within(cardB).getByRole("button"));
    const warmClearRun = await onSnapshotReady.mock.calls.at(-1)?.[0]();
    const warmClearNext = warmClearRun.curves.candidates.find((curve: { role: string }) => curve.role === "candidate");

    // 레시피 후보(예상 소성범위)를 바꾸면 predictionModel.predictNextRun()의
    // 보정값이 달라지고, 그 값이 "다음 실행 제안" 곡선 한 장에 그대로
    // 반영된다 — 레시피 선택 → 예측 → 소성곡선까지 이어지는 전파 확인.
    expect(warmClearNext.points).not.toEqual(coastalNext.points);
    // 레시피가 바뀌어도 곡선 개수·역할 구조(CurveBundle) 자체는 그대로다.
    expect(warmClearRun.curves.candidates.map((curve: { role: string }) => curve.role)).toEqual(coastalRun.curves.candidates.map((curve: { role: string }) => curve.role));
  });

  it("saves the finished run to work records and navigates there (9페이지)", async () => {
    const fetchMock = mockFetch();
    const onSaved = vi.fn();
    render(<AicePrototype token="test-token" onSaved={onSaved} />);
    await skipToWare();
    for (const name of [/^사발/, /백색 석기 소지/, /^다음/]) {
      fireEvent.click(screen.getByRole("button", { name }));
    }
    fillWeightInputs();
    const riskButton = screen.getByRole("button", { name: /소성 계획/ });
    await waitFor(() => expect((riskButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(riskButton);
    fireEvent.click(screen.getByRole("button", { name: /^다음/ }));
    const playButton = screen.getByRole("button", { name: "이 계획대로 가마에 적용해서 시작" });
    await waitFor(() => expect((playButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(playButton);
    fireEvent.click(screen.getByRole("button", { name: /^다음/ }));
    // 평가 완료(evaluationComplete, feedback.ts)는 전체 인상뿐 아니라
    // 광택·투명도·결함 확인까지 모두 요구한다 — 항목 4("평가 완료... 필수로
    // 검증"): 불완전한 기록은 저장 버튼이 계속 비활성 상태로 남는다.
    fireEvent.click(screen.getByRole("button", { name: /목표에 가까워요/ }));
    fireEvent.click(screen.getByRole("button", { name: "사틴" }));
    fireEvent.click(screen.getByRole("button", { name: "불투명" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /결함을 확인했습니다/ }));

    const saveButton = screen.getByRole("button", { name: /저장하고 작업기록으로 이동/ });
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveButton);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const saveCall = fetchMock.mock.calls.find(([url, init]) => String(url).includes("/aice-runs") && init?.method === "POST");
    expect(saveCall).toBeTruthy();
    const body = JSON.parse(String(saveCall?.[1]?.body));
    expect(body.run.status).toBe("evaluated");
    expect(body.run.result.feedback_scope).toBe("personal");
  });
});
