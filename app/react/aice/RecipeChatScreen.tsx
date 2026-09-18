import { useEffect, useState, type FormEvent } from "react";
import { aiceRunsApi, ApiError, recipeCandidatesApi, type AiceRunRecord } from "../lib/api";
import type { RecipeCandidate } from "./contract";
import { SOURCE_LABELS } from "./catalog";
import { findSimilarHistory, type HistoryMatch } from "./historyMatch";
import { Alert, AsyncState, DetailDrawer, StatusBadge } from "./ui";

/**
 * 화면 1(LLM 채팅) — LLM 프런트도어 TODO Phase 2, v9 개편.
 *
 * 자연어 입력을 `kiln.llm`이 검증한 레시피 후보로 바꾸는 화면. 카드
 * 레이아웃은 예전 `RecommendationEvidence.tsx`의 "근거 카드" 패턴
 * (`.evidence-card-grid`)을 재사용하되, 그 컴포넌트가 쓰던 규칙 기반
 * 추천(`aiMvp.ts`, 고정 데모 3종)이 아니라 백엔드의
 * `/aice/recipe-candidates`를 호출한다 — 별개의 데이터 경로다.
 *
 * 이미지는 후보가 도착하는 즉시 카드마다 자동으로 요청한다(예전에는
 * 카드별 "예상 이미지 생성" 버튼이 있었으나, 매번 눌러야 하는 번거로움을
 * 없애 달라는 요청으로 자동 호출로 바꿨다). 왼쪽 `☰` 아이콘을 누르면
 * 이전에 물었던 질문(=제목) 목록이 나오고, 하나를 고르면 그때 만든 후보
 * 세트를 그대로 복원한다. 또한 새 질문을 보낼 때마다 규칙 기반으로(학습
 * 모델 아님) 과거 이력 중 비슷한 요청의 후보를 찾아 같은 카드 그리드에
 * 함께 올리고, 왜 비슷한지 리마크 문장을 붙인다(`historyMatch.ts`).
 */
export function RecipeChatScreen({
  token,
  onSelect,
  onIntake,
  onGenerated,
  disabled = false,
}: {
  token: string;
  //: 9페이지(결과 기록)의 "목표" 사진이 이 후보의 자동 생성 이미지를 그대로
  //: 보여줄 수 있도록, 선택 시점에 그 후보의 이미지(있으면)도 함께 넘긴다.
  onSelect?: (candidate: RecipeCandidate, image?: { base64: string; mediaType: string }) => void;
  //: 부모(AicePrototype)의 `intakePrompt`/`intakeCandidates`를 최신 상태로
  //: 맞추기 위한 콜백 — 새로 생성했을 때도, 이력에서 복원했을 때도 부른다.
  onIntake?: (promptText: string, candidates: RecipeCandidate[]) => void;
  //: `onIntake`와 달리 "진짜 새로 만든" 순간에만 부른다 — 부모가 이 시점에만
  //: 이력에 자동 저장한다(이력 복원을 다시 저장해 중복 항목을 만들지 않기
  //: 위해 분리했다).
  onGenerated?: (promptText: string, candidates: RecipeCandidate[]) => void;
  disabled?: boolean;
}) {
  const [promptText, setPromptText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "complete">("idle");
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<RecipeCandidate[]>([]);
  const [dropped, setDropped] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, { base64: string; mediaType: string }>>({});
  const [imageLoading, setImageLoading] = useState<Record<string, boolean>>({});
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const [historyMatches, setHistoryMatches] = useState<HistoryMatch[]>([]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [history, setHistory] = useState<AiceRunRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [restoredRunId, setRestoredRunId] = useState<string | null>(null);

  async function loadHistory() {
    if (!token) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const page = await aiceRunsApi.listMine(token);
      setHistory(page.items);
    } catch (err) {
      setHistoryError(err instanceof ApiError ? err.message : "이전 기록을 불러오지 못했습니다.");
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (token) void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function requestImagesFor(list: RecipeCandidate[]) {
    for (const candidate of list) void requestImage(candidate);
  }

  async function requestImage(candidate: RecipeCandidate) {
    setImageLoading((prev) => ({ ...prev, [candidate.id]: true }));
    setImageErrors((prev) => ({ ...prev, [candidate.id]: "" }));
    try {
      const result = await recipeCandidatesApi.image(token, {
        candidate_name: candidate.name,
        materials: candidate.materials,
        colorants: candidate.colorants,
        style_note: `${candidate.predicted_firing_note} ${candidate.colorant_note ?? ""}`.trim(),
        // 목표 분류(광택도·투명도)를 이미지 생성까지 넘긴다 — 이전에는 여기서
        // 끊겨서 "매트 레시피인데 유광 이미지" 같은 불일치가 났다.
        target_gloss: candidate.target_gloss ?? "",
        target_transparency: candidate.target_transparency ?? "",
      });
      setImages((prev) => ({
        ...prev,
        [candidate.id]: { base64: result.image_base64, mediaType: result.media_type },
      }));
    } catch (err) {
      setImageErrors((prev) => ({
        ...prev,
        [candidate.id]: err instanceof ApiError ? err.message : "이미지를 생성하지 못했습니다.",
      }));
    } finally {
      setImageLoading((prev) => ({ ...prev, [candidate.id]: false }));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = promptText.trim();
    if (!trimmed || status === "loading" || disabled) return;
    setStatus("loading");
    setError(null);
    setRestoredRunId(null);
    try {
      const response = await recipeCandidatesApi.suggest(token, trimmed);
      setCandidates(response.candidates);
      setDropped(response.dropped);
      setSelectedId(response.candidates[0]?.id ?? null);
      setImages({});
      setImageErrors({});
      setStatus("complete");
      setHistoryMatches(findSimilarHistory(trimmed, response.candidates, history));
      requestImagesFor(response.candidates);
      onIntake?.(trimmed, response.candidates);
      onGenerated?.(trimmed, response.candidates);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "후보를 만들지 못했습니다.");
      setStatus("error");
    }
  }

  function selectCandidate(candidate: RecipeCandidate) {
    setSelectedId(candidate.id);
    onSelect?.(candidate, images[candidate.id]);
  }

  async function restoreFromHistory(record: AiceRunRecord) {
    const full = record.run.intake ? record : await aiceRunsApi.get(token, record.id).catch(() => null);
    const intake = full?.run.intake;
    if (!intake) {
      setHistoryError("이 기록에는 후보 대화 내용이 없습니다.");
      return;
    }
    setPromptText(intake.prompt_text);
    setCandidates(intake.candidates.candidates);
    setSelectedId(intake.candidates.selected_id ?? intake.candidates.candidates[0]?.id ?? null);
    setDropped([]);
    setImages({});
    setImageErrors({});
    setHistoryMatches([]);
    setStatus("complete");
    setError(null);
    setRestoredRunId(record.id);
    requestImagesFor(intake.candidates.candidates);
    onIntake?.(intake.prompt_text, intake.candidates.candidates);
    setSidebarOpen(false);
  }

  function toggleSidebar() {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    if (next) void loadHistory();
  }

  const cards: Array<{ candidate: RecipeCandidate; remark?: string }> = [
    ...candidates.map((candidate) => ({ candidate })),
    ...historyMatches
      .filter((match) => !candidates.some((candidate) => candidate.id === match.candidate.id))
      .map((match) => ({ candidate: match.candidate, remark: match.remark })),
  ];

  return (
    <section className="recipe-chat-screen" aria-labelledby="recipe-chat-title">
      {/* v9 후속 개편: 채팅창을 여는 첫 표지처럼 아무 설명 없이 입력만
          보이게 한다 — 안내문·배지는 지웠다. 제목은 시각적으로는 숨기되
          스크린리더용으로만 남긴다(sr-only). */}
      <h3 id="recipe-chat-title" className="sr-only">원하는 유약을 문장으로 설명해요</h3>
      <button
        type="button"
        className="recipe-history-toggle"
        aria-label="이전 질문 기록 열기"
        aria-expanded={sidebarOpen}
        onClick={toggleSidebar}
        disabled={!token}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>

      {sidebarOpen && (
        <>
          <div className="recipe-history-backdrop" onClick={() => setSidebarOpen(false)} />
          <aside className="recipe-history-sidebar" aria-label="이전 질문 기록">
            <h4>이전 질문</h4>
            {historyLoading && <AsyncState kind="loading" />}
            {historyError && <Alert tone="danger" title="기록을 불러오지 못했어요">{historyError}</Alert>}
            {!historyLoading && history.length === 0 && <p>아직 저장된 질문이 없습니다.</p>}
            <ul className="recipe-history-list">
              {history.map((record) => (
                <li key={record.id}>
                  <button type="button" aria-current={restoredRunId === record.id ? "true" : undefined} onClick={() => void restoreFromHistory(record)}>
                    {record.title}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </>
      )}

      <form onSubmit={submit} className="recipe-prompt-form">
        <label htmlFor="recipe-prompt" className="sr-only">원하는 결과를 설명해 주세요</label>
        <textarea
          id="recipe-prompt"
          value={promptText}
          onChange={(event) => setPromptText(event.target.value)}
          placeholder="예: 사발에 어울리는 청록색 사틴 유약을 찾고 있어요"
          rows={3}
          disabled={disabled}
        />
        <button type="submit" disabled={disabled || status === "loading" || !promptText.trim()}>
          {status === "loading" ? "후보 만드는 중…" : "후보 만들기"}
        </button>
      </form>
      {status === "loading" && <AsyncState kind="loading" />}
      {status === "error" && (
        <Alert tone="danger" title="후보를 만들지 못했어요">
          {error}
        </Alert>
      )}
      {status === "complete" && cards.length === 0 && <AsyncState kind="empty" />}
      {cards.length > 0 && (
        <div className="evidence-card-grid">
          {cards.map(({ candidate, remark }) => {
            const [lo, hi] = candidate.predicted_firing_range.value ?? [null, null];
            const colorants = candidate.colorants ?? {};
            return (
              <article
                key={candidate.id}
                className="evidence-card"
                aria-current={selectedId === candidate.id ? "true" : undefined}
              >
                <div>
                  <StatusBadge tone="unavailable">{SOURCE_LABELS[candidate.source_type]}</StatusBadge>
                  <strong>{candidate.name}</strong>
                  {remark && <span className="history-match-badge">과거 이력 · 유사 후보</span>}
                </div>
                {remark && <p className="history-match-remark">{remark}</p>}
                {imageLoading[candidate.id] && <AsyncState kind="loading" />}
                {images[candidate.id] && (
                  <img
                    src={`data:${images[candidate.id].mediaType};base64,${images[candidate.id].base64}`}
                    alt={`${candidate.name} AI 예상 이미지 — 실물 사진 아님`}
                    className="recipe-candidate-image"
                  />
                )}
                {imageErrors[candidate.id] && (
                  <Alert tone="danger" title="이미지를 만들지 못했어요">
                    {imageErrors[candidate.id]}
                  </Alert>
                )}
                <h4>기본 유약 배합 (합계 100%)</h4>
                <dl>
                  {Object.entries(candidate.materials).map(([name, pct]) => (
                    <div key={name}>
                      <dt>{name}</dt>
                      <dd>{pct}%</dd>
                    </div>
                  ))}
                  <div>
                    <dt>예상 소성</dt>
                    <dd>{lo ?? "?"}–{hi ?? "?"} °C</dd>
                  </div>
                </dl>
                <h4>발색 산화물 (외배합)</h4>
                {Object.keys(colorants).length > 0 ? (
                  <dl>
                    {Object.entries(colorants).map(([name, pct]) => (
                      <div key={name}>
                        <dt>{name}</dt>
                        <dd>{pct}%</dd>
                      </div>
                    ))}
                  </dl>
                ) : <p>추가 발색 산화물 없음</p>}
                {candidate.colorant_note && <p>{candidate.colorant_note}</p>}
                <p className="recipe-uncertainty">외배합은 건조 기본 유약 100g 기준 참고값이며 실제 발색은 소지·두께·분위기·냉각에 따라 달라집니다.</p>
                <p>{candidate.predicted_firing_note}</p>
                {candidate.composition_note && (
                  <DetailDrawer summary="배합비 출처 보기">
                    <p>{candidate.composition_note}</p>
                    <p className="recipe-uncertainty">배합비(위 %)는 LLM이 지어낸 값이 아니라 규칙 기반 조성 탐색이 낸 값입니다 — LLM은 이름·착색·소성 메모만 붙였습니다.</p>
                  </DetailDrawer>
                )}
                <div className="recipe-candidate-actions">
                  <button type="button" onClick={() => selectCandidate(candidate)} aria-pressed={selectedId === candidate.id}>
                    {selectedId === candidate.id ? "선택됨" : "이 후보 선택"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {dropped.length > 0 && (
        <DetailDrawer summary={`검증에서 버려진 후보 ${dropped.length}건 보기`}>
          <ul className="dropped-candidate-list">
            {dropped.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p>화학적으로 성립하지 않는 배합(원료 DB 밖의 이름, 비율 합 불일치 등)은 화면에 올리지 않습니다.</p>
        </DetailDrawer>
      )}
    </section>
  );
}
