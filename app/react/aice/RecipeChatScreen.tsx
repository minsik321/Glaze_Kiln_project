import { useEffect, useState, type FormEvent } from "react";
import { aiceRunsApi, ApiError, recipeCandidatesApi, type AiceRunRecord } from "../lib/api";
import type { RecipeCandidate } from "./contract";
import { findSimilarHistory, type HistoryMatch } from "./historyMatch";
import { Alert, AsyncState, DetailDrawer } from "./ui";

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
  const [detailCandidate, setDetailCandidate] = useState<RecipeCandidate | null>(null);

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
    <section className={`recipe-chat-screen${cards.length > 0 || status !== "idle" ? " has-response" : ""}`} aria-labelledby="recipe-chat-title">
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
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="1.5" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" /></svg>
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

      <div className="recipe-chat-intro">
        <p><strong>Chloe 님 안녕하세요,</strong><br />오늘은 어떤 실험을 해볼까요?</p>
      </div>
      <form onSubmit={submit} className="recipe-prompt-form">
        <div className="recipe-prompt-pill">
          <label htmlFor="recipe-prompt" className="sr-only">원하는 결과를 설명해 주세요</label>
          <textarea
            id="recipe-prompt"
            value={promptText}
            onChange={(event) => setPromptText(event.target.value)}
            placeholder="예: 청록색 결정이 있는 청자유 시편을 만들고 싶어요"
            rows={1}
            disabled={disabled}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button type="submit" disabled={disabled || status === "loading" || !promptText.trim()} aria-label={status === "loading" ? "후보 만드는 중" : "후보 만들기"}>
            <span className="sr-only">{status === "loading" ? "후보 만드는 중…" : "후보 만들기"}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 18V6M7.5 10.5 12 6l4.5 4.5" /></svg>
          </button>
        </div>
        <div className="recipe-suggestions" aria-label="입력 예시">
          <span>매트한 초록색</span><span>백토, 환원 분위기</span><span>반광, 크랙</span><span>시유 두께 보통</span>
        </div>
      </form>
      {status === "loading" && (
        <div className="recipe-generation-loader" role="status" aria-live="polite">
          <p>레시피 생성 중...</p>
          <div className="recipe-loading-dots" aria-hidden="true"><i /><i /><i /></div>
        </div>
      )}
      {status === "error" && (
        <Alert tone="danger" title="후보를 만들지 못했어요">
          {error}
        </Alert>
      )}
      {status === "complete" && cards.length === 0 && <AsyncState kind="empty" />}
      {cards.length > 0 && (
        <div className="evidence-card-grid recipe-result-list">
          {cards.map(({ candidate, remark }) => {
            const [lo, hi] = candidate.predicted_firing_range.value ?? [null, null];
            const colorants = candidate.colorants ?? {};
            const compactMaterials = Object.entries(candidate.materials).slice(0, 3);
            return (
              <article
                key={candidate.id}
                className="evidence-card recipe-result-card"
                aria-current={selectedId === candidate.id ? "true" : undefined}
                tabIndex={0}
                onClick={() => selectCandidate(candidate)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    selectCandidate(candidate);
                  }
                }}
              >
                <div className="recipe-card-copy">
                  <strong className="recipe-card-name">{candidate.name}</strong>
                  <dl className="recipe-card-ratio">
                    {compactMaterials.map(([name, pct]) => (
                      <div key={name}><dt>{name}</dt><dd>{pct}%</dd></div>
                    ))}
                  </dl>
                </div>
                <button
                  type="button"
                  className="recipe-detail-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    selectCandidate(candidate);
                    setDetailCandidate(candidate);
                  }}
                >상세보기</button>
                <div className="recipe-card-image-wrap" aria-busy={imageLoading[candidate.id] || undefined}>
                  {images[candidate.id] ? (
                  <img
                    src={`data:${images[candidate.id].mediaType};base64,${images[candidate.id].base64}`}
                    alt={`${candidate.name} AI 예상 이미지 — 실물 사진 아님`}
                    className="recipe-candidate-image"
                  />
                  ) : <span className="recipe-image-placeholder">{imageErrors[candidate.id] ? "이미지 없음" : ""}</span>}
                </div>
                <span className="sr-only">{selectedId === candidate.id ? "선택됨" : "이 후보 선택"}</span>
                <div className="sr-only">
                  {remark && <><span>과거 이력 · 유사 후보</span><span>{remark}</span></>}
                  <h4>기본 유약 배합 (합계 100%)</h4>
                  {Object.entries(candidate.materials).map(([name, pct]) => <span key={name}>{name} {pct}%</span>)}
                  <span>예상 소성 {lo ?? "?"}–{hi ?? "?"} °C</span>
                  <h4>발색 산화물 (외배합)</h4>
                  {Object.keys(colorants).length > 0
                    ? Object.entries(colorants).map(([name, pct]) => <span key={name}><b>{name}</b> {pct}%</span>)
                    : <span>추가 발색 산화물 없음</span>}
                  <span>{candidate.colorant_note}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {detailCandidate && (
        <div className="recipe-detail-backdrop" role="presentation" onClick={() => setDetailCandidate(null)}>
          <section className="recipe-detail-modal" role="dialog" aria-modal="true" aria-labelledby="recipe-detail-title" onClick={(event) => event.stopPropagation()}>
            <h4 id="recipe-detail-title">{detailCandidate.name}</h4>
            <div className="recipe-detail-photo">
              {images[detailCandidate.id]
                ? <img src={`data:${images[detailCandidate.id].mediaType};base64,${images[detailCandidate.id].base64}`} alt={`${detailCandidate.name} AI 예상 이미지`} />
                : <span />}
            </div>
            <div className="recipe-detail-description">
              <h5>레시피 배합</h5>
              <dl>{Object.entries(detailCandidate.materials).map(([name, pct]) => <div key={name}><dt>{name}</dt><dd>{pct}%</dd></div>)}</dl>
              <h5>설명</h5>
              <p>{detailCandidate.predicted_firing_note || detailCandidate.colorant_note || "생성된 유약 레시피입니다."}</p>
            </div>
            <button type="button" className="recipe-detail-close" onClick={() => setDetailCandidate(null)}>닫기</button>
          </section>
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
