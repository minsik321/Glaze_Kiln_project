import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { aiceRunsApi, ApiError, recipeCandidatesApi, type AiceRunRecord } from "../lib/api";
import { isChatGenerationRecord } from "../records/workRecords";
import type { ChatIntake, RecipeCandidate } from "./contract";
import { findSimilarHistory, type HistoryMatch } from "./historyMatch";
import { Alert, AsyncState, DetailDrawer } from "./ui";

const CANDIDATE_NUMBER_SUFFIX = /\s*(?:[-–—:·]\s*)?(?:후보|candidate)\s*#?\s*\d+\s*$/iu;

const COLORANT_LABELS: Record<string, string> = {
  Fe2O3: "산화철",
  CuO: "산화동",
  Cr2O3: "산화크롬",
  CoO: "산화코발트",
  NiO: "산화니켈",
  MnO2: "이산화망간",
};

const TARGET_LABELS: Record<string, string> = {
  MATTE: "무광",
  SATIN: "반광",
  GLOSS: "유광",
  OPAQUE: "불투명",
  SEMI_OPAQUE: "반불투명",
  TRANSLUCENT: "반투명",
  TRANSPARENT: "투명",
};

function formatRecipeAmount(value: number): string {
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function compactFiringNote(note: string): string {
  const concise = note.split(/\s*\(Stull 참조:/u)[0]?.trim();
  return concise || "소성 분위기와 유지 시간은 소량 테스트 후 조정해 주세요.";
}

function normalizeCandidateName(candidate: RecipeCandidate): RecipeCandidate {
  const cleanedName = candidate.name.replace(CANDIDATE_NUMBER_SUFFIX, "").trim();
  return { ...candidate, name: cleanedName || "유약 레시피" };
}

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
  initialIntake,
  historyRevision = 0,
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
  initialIntake?: ChatIntake;
  historyRevision?: number;
  disabled?: boolean;
}) {
  const [promptText, setPromptText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "complete">("idle");
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<RecipeCandidate[]>([]);
  const [dropped, setDropped] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [images, setImages] = useState<Record<string, { base64: string; mediaType: string; sourceType: "ai" | "fallback" }>>({});
  const [imageLoading, setImageLoading] = useState<Record<string, boolean>>({});
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const [historyMatches, setHistoryMatches] = useState<HistoryMatch[]>([]);
  const [detailCandidate, setDetailCandidate] = useState<RecipeCandidate | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarMounted, setSidebarMounted] = useState(false);
  const [history, setHistory] = useState<AiceRunRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [restoredRunId, setRestoredRunId] = useState<string | null>(null);
  const [cardAnimationKey, setCardAnimationKey] = useState(0);
  const [revealedHistoryId, setRevealedHistoryId] = useState<string | null>(null);
  const [historyDrag, setHistoryDrag] = useState<{ id: string; offset: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AiceRunRecord | null>(null);
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const historyGesture = useRef<{ id: string; startX: number; startY: number; latestX: number; latestY: number; moved: boolean } | null>(null);
  const suppressHistoryClick = useRef(false);

  useEffect(() => {
    if (!initialIntake) return;
    const restoredCandidates = initialIntake.candidates.candidates.map(normalizeCandidateName);
    setPromptText(initialIntake.prompt_text);
    setCandidates(restoredCandidates);
    setSelectedId(initialIntake.candidates.selected_id);
    setDropped([]);
    setImages({});
    setImageErrors({});
    setHistoryMatches([]);
    setStatus("complete");
    setError(null);
    setCardAnimationKey((current) => current + 1);
    requestImagesFor(restoredCandidates);
    // A restored run changes as one complete object; re-running for local image
    // state changes would duplicate paid image requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIntake]);

  async function loadHistory() {
    if (!token) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const page = await aiceRunsApi.listMine(token);
      setHistory(page.items.filter((record) => isChatGenerationRecord(record.run)));
    } catch (err) {
      setHistoryError(err instanceof ApiError ? err.message : "이전 기록을 불러오지 못했습니다.");
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (token) void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, historyRevision]);

  useEffect(() => {
    if (!sidebarMounted || sidebarOpen) return;
    const closingTimer = window.setTimeout(() => setSidebarMounted(false), 280);
    return () => window.clearTimeout(closingTimer);
  }, [sidebarMounted, sidebarOpen]);

  function requestImagesFor(list: RecipeCandidate[]) {
    return Promise.all(list.map((candidate) => requestImage(candidate)));
  }

  async function requestImage(candidate: RecipeCandidate): Promise<RecipeCandidate> {
    const savedImage = candidate.photo.data_url?.match(/^data:(image\/(?:png|jpeg|gif|webp|svg\+xml));base64,(.+)$/);
    if (savedImage) {
      setImages((prev) => ({
        ...prev,
        [candidate.id]: {
          base64: savedImage[2],
          mediaType: savedImage[1],
          sourceType: savedImage[1] === "image/svg+xml" ? "fallback" : "ai",
        },
      }));
      return candidate;
    }
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
        [candidate.id]: {
          base64: result.image_base64,
          mediaType: result.media_type,
          sourceType: result.source_type ?? "ai",
        },
      }));
      return {
        ...candidate,
        photo: {
          ...candidate.photo,
          data_url: `data:${result.media_type};base64,${result.image_base64}`,
          placeholder: false,
          alt: result.source_type === "fallback"
            ? `${candidate.name} 로컬 합성 유약 프리뷰 — 실물 사진 아님`
            : `${candidate.name} AI 예상 이미지 — 실물 사진 아님`,
        },
      };
    } catch (err) {
      setImageErrors((prev) => ({
        ...prev,
        [candidate.id]: err instanceof ApiError ? err.message : "이미지를 생성하지 못했습니다.",
      }));
      return candidate;
    } finally {
      setImageLoading((prev) => ({ ...prev, [candidate.id]: false }));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = promptText.trim();
    if (!trimmed || status === "loading" || disabled) return;
    if (!token) {
      setStatus("error");
      setError("로그인 후 후보를 만들 수 있습니다.");
      return;
    }
    setStatus("loading");
    setError(null);
    setRestoredRunId(null);
    try {
      const response = await recipeCandidatesApi.suggest(token, trimmed);
      const normalizedCandidates = response.candidates.map(normalizeCandidateName);
      setCandidates(normalizedCandidates);
      setDropped(response.dropped);
      setSelectedId(null);
      setImages({});
      setImageErrors({});
      setStatus("complete");
      setHistoryMatches(findSimilarHistory(trimmed, normalizedCandidates, history));
      setCardAnimationKey((current) => current + 1);
      void requestImagesFor(normalizedCandidates).then((candidatesWithImages) => {
        onGenerated?.(trimmed, candidatesWithImages);
      });
      onIntake?.(trimmed, normalizedCandidates);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "후보를 만들지 못했습니다.");
      setStatus("error");
    }
  }

  function selectCandidate(candidate: RecipeCandidate) {
    setSelectedId(candidate.id);
    const image = images[candidate.id];
    onSelect?.(candidate, image ? { base64: image.base64, mediaType: image.mediaType } : undefined);
  }

  async function restoreFromHistory(record: AiceRunRecord) {
    const full = record.run.intake ? record : await aiceRunsApi.get(token, record.id).catch(() => null);
    const intake = full?.run.intake;
    if (!intake) {
      setHistoryError("이 기록에는 후보 대화 내용이 없습니다.");
      return;
    }
    const normalizedCandidates = intake.candidates.candidates.map(normalizeCandidateName);
    setPromptText(intake.prompt_text);
    setCandidates(normalizedCandidates);
    setSelectedId(intake.candidates.selected_id ?? normalizedCandidates[0]?.id ?? null);
    setDropped([]);
    setImages({});
    setImageErrors({});
    setHistoryMatches([]);
    setStatus("complete");
    setError(null);
    setRestoredRunId(record.id);
    setCardAnimationKey((current) => current + 1);
    requestImagesFor(normalizedCandidates);
    onIntake?.(intake.prompt_text, normalizedCandidates);
    const restoredSelection = normalizedCandidates.find((candidate) => candidate.id === intake.candidates.selected_id);
    if (restoredSelection) onSelect?.(restoredSelection);
    closeSidebar();
  }

  function openSidebar() {
    setSidebarMounted(true);
    setSidebarOpen(true);
    void loadHistory();
  }

  function closeSidebar() {
    setSidebarOpen(false);
  }

  function toggleSidebar() {
    if (sidebarOpen) closeSidebar();
    else openSidebar();
  }

  function beginHistorySwipe(recordId: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    historyGesture.current = { id: recordId, startX: event.clientX, startY: event.clientY, latestX: event.clientX, latestY: event.clientY, moved: false };
    setRevealedHistoryId((current) => current === recordId ? current : null);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveHistorySwipe(event: ReactPointerEvent<HTMLButtonElement>) {
    const gesture = historyGesture.current;
    if (!gesture) return;
    gesture.latestX = event.clientX;
    gesture.latestY = event.clientY;
    const deltaX = Math.max(0, event.clientX - gesture.startX);
    const deltaY = Math.abs(event.clientY - gesture.startY);
    if (deltaX <= deltaY || deltaX < 6) return;
    gesture.moved = true;
    setHistoryDrag({ id: gesture.id, offset: Math.min(deltaX, 66) });
  }

  function endHistorySwipe() {
    const gesture = historyGesture.current;
    if (!gesture) return;
    const deltaX = gesture.latestX - gesture.startX;
    const deltaY = Math.abs(gesture.latestY - gesture.startY);
    const reveal = gesture.moved && deltaX >= 42 && deltaX > deltaY;
    suppressHistoryClick.current = gesture.moved;
    historyGesture.current = null;
    setHistoryDrag(null);
    setRevealedHistoryId(reveal ? gesture.id : null);
  }

  function openDeleteDialog(record: AiceRunRecord) {
    setDeleteError(null);
    setPendingDelete(record);
  }

  async function confirmHistoryDelete() {
    if (!pendingDelete || deletingHistoryId) return;
    setDeletingHistoryId(pendingDelete.id);
    setDeleteError(null);
    try {
      await aiceRunsApi.remove(token, pendingDelete.id);
      setHistory((current) => current.filter((record) => record.id !== pendingDelete.id));
      if (restoredRunId === pendingDelete.id) setRestoredRunId(null);
      setRevealedHistoryId(null);
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "생성 기록을 삭제하지 못했습니다.");
    } finally {
      setDeletingHistoryId(null);
    }
  }

  const cards: Array<{ candidate: RecipeCandidate; remark?: string }> = [
    ...candidates.map((candidate) => ({ candidate: normalizeCandidateName(candidate) })),
    ...historyMatches
      .filter((match) => !candidates.some((candidate) => candidate.id === match.candidate.id))
      .map((match) => ({ candidate: normalizeCandidateName(match.candidate), remark: match.remark })),
  ];

  return (
    <section className={`recipe-chat-screen${cards.length > 0 || status !== "idle" ? " has-response" : ""}${status === "loading" ? " is-loading" : ""}`} aria-labelledby="recipe-chat-title">
      {/* v9 후속 개편: 채팅창을 여는 첫 표지처럼 아무 설명 없이 입력만
          보이게 한다 — 안내문·배지는 지웠다. 제목은 시각적으로는 숨기되
          스크린리더용으로만 남긴다(sr-only). */}
      <h3 id="recipe-chat-title" className="sr-only">원하는 유약을 문장으로 설명해요</h3>
      <button
        type="button"
        className="recipe-history-toggle"
        aria-label="생성 기록 열기"
        aria-expanded={sidebarOpen}
        onClick={toggleSidebar}
        disabled={!token}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h11" /></svg>
      </button>

      {sidebarMounted && (
        <>
          <div
            className={`recipe-history-backdrop ${sidebarOpen ? "is-open" : "is-closing"}`}
            onClick={closeSidebar}
          />
          <aside
            className={`recipe-history-sidebar ${sidebarOpen ? "is-open" : "is-closing"}`}
            aria-label="생성 기록"
          >
            <header className="recipe-history-header">
              <h4>생성 기록</h4>
              <button type="button" className="recipe-history-close" aria-label="생성 기록 닫기" onClick={closeSidebar}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </header>
            {historyLoading && (
              <div className="recipe-history-skeleton" role="status" aria-label="생성 기록 불러오는 중">
                <span /><span /><span />
              </div>
            )}
            {historyError && <Alert tone="danger" title="기록을 불러오지 못했어요">{historyError}</Alert>}
            {!historyLoading && history.length === 0 && <p className="recipe-history-empty">아직 생성 기록이 없습니다.</p>}
            <ul className="recipe-history-list">
              {history.map((record) => {
                const dragOffset = historyDrag?.id === record.id ? historyDrag.offset : revealedHistoryId === record.id ? 66 : 0;
                return (
                <li key={record.id} className={`recipe-history-item${revealedHistoryId === record.id || historyDrag?.id === record.id ? " is-revealed" : ""}`} style={{ "--history-item-x": `${dragOffset}px` } as CSSProperties}>
                  <button type="button" className="recipe-history-delete" aria-label={`${record.title} 삭제`} onClick={() => openDeleteDialog(record)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg>
                  </button>
                  <button
                    type="button"
                    className="recipe-history-record"
                    aria-current={restoredRunId === record.id ? "true" : undefined}
                    onPointerDown={(event) => beginHistorySwipe(record.id, event)}
                    onPointerMove={moveHistorySwipe}
                    onPointerUp={endHistorySwipe}
                    onPointerCancel={endHistorySwipe}
                    onClick={() => {
                      if (suppressHistoryClick.current) {
                        suppressHistoryClick.current = false;
                        return;
                      }
                      if (revealedHistoryId === record.id) {
                        setRevealedHistoryId(null);
                        return;
                      }
                      void restoreFromHistory(record);
                    }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14v10H9l-4 3v-13Z" /></svg>
                    <span>{record.title}</span>
                  </button>
                </li>
              )})}
            </ul>
          </aside>
        </>
      )}

      {pendingDelete && (
        <div className="recipe-history-delete-layer">
          <section className="recipe-history-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="recipe-history-delete-title">
            <h3 id="recipe-history-delete-title">삭제하시겠습니까?</h3>
            {deleteError && <p role="alert">{deleteError}</p>}
            <div>
              <button type="button" onClick={() => { setPendingDelete(null); setDeleteError(null); }}>아니오</button>
              <button type="button" className="danger" disabled={deletingHistoryId === pendingDelete.id} onClick={() => void confirmHistoryDelete()}>{deletingHistoryId === pendingDelete.id ? "삭제 중…" : "예"}</button>
            </div>
          </section>
        </div>
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
          <button type="submit" disabled={disabled || status === "loading" || !token || !promptText.trim()} aria-label={status === "loading" ? "후보 만드는 중" : "후보 만들기"}>
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
        <div key={cardAnimationKey} className="evidence-card-grid recipe-result-list">
          {cards.map(({ candidate, remark }, cardIndex) => {
            const [lo, hi] = candidate.predicted_firing_range.value ?? [null, null];
            const colorants = candidate.colorants ?? {};
            const compactMaterials = Object.entries(candidate.materials).slice(0, 3);
            return (
              <article
                key={candidate.id}
                className="evidence-card recipe-result-card"
                style={{ "--recipe-card-index": cardIndex } as CSSProperties}
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
                    alt={images[candidate.id].sourceType === "fallback"
                      ? `${candidate.name} 로컬 합성 유약 프리뷰 — 실물 사진 아님`
                      : `${candidate.name} AI 예상 이미지 — 실물 사진 아님`}
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
            {(() => {
              const materials = Object.entries(detailCandidate.materials);
              const colorants = Object.entries(detailCandidate.colorants ?? {});
              const baseTotal = materials.reduce((sum, [, amount]) => sum + amount, 0);
              const colorantTotal = colorants.reduce((sum, [, amount]) => sum + amount, 0);
              const [lowC, highC] = detailCandidate.predicted_firing_range.value ?? [null, null];
              const targetLabels = [detailCandidate.target_gloss, detailCandidate.target_transparency]
                .filter((value): value is string => Boolean(value))
                .map((value) => TARGET_LABELS[value] ?? value);
              return (
                <>
                  <button type="button" className="recipe-detail-icon-close" aria-label="상세보기 닫기" onClick={() => setDetailCandidate(null)}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                  </button>
                  <header className="recipe-detail-header">
                    <span>GLAZE RECIPE</span>
                    <h4 id="recipe-detail-title">{detailCandidate.name}</h4>
                    <div className="recipe-detail-badges">
                      {lowC != null && highC != null && <em>{formatRecipeAmount(lowC)}–{formatRecipeAmount(highC)}°C</em>}
                      {targetLabels.map((label) => <em key={label}>{label}</em>)}
                    </div>
                  </header>
                  <div className="recipe-detail-photo">
                    {images[detailCandidate.id]
                      ? <img src={`data:${images[detailCandidate.id].mediaType};base64,${images[detailCandidate.id].base64}`} alt={`${detailCandidate.name} AI 예상 이미지 — 실물 사진 아님`} />
                      : <span>예상 이미지 준비 중</span>}
                    <small>AI 예상 이미지 · 실제 발색과 다를 수 있음</small>
                  </div>
                  <div className="recipe-detail-content">
                    {detailCandidate.rationale && <p className="recipe-detail-summary">{detailCandidate.rationale}</p>}
                    <section className="recipe-detail-section" aria-labelledby="base-recipe-title">
                      <div className="recipe-detail-section-heading">
                        <div><span>STEP 1</span><h5 id="base-recipe-title">기본 유약 배합</h5></div>
                        <b>건식 100g 기준</b>
                      </div>
                      <div className="recipe-detail-table" role="table" aria-label="기본 유약 100g 배합">
                        <div className="recipe-detail-table-head" role="row"><span>원료</span><span>배합률</span><span>계량</span></div>
                        {materials.map(([name, pct]) => (
                          <div key={name} role="row"><strong>{name}</strong><span>{formatRecipeAmount(pct)}%</span><b>{formatRecipeAmount(pct)}g</b></div>
                        ))}
                        <div className="recipe-detail-total" role="row"><strong>기본 배합 합계</strong><span>{formatRecipeAmount(baseTotal)}%</span><b>{formatRecipeAmount(baseTotal)}g</b></div>
                      </div>
                    </section>

                    <section className="recipe-detail-section recipe-detail-colorants" aria-labelledby="colorant-recipe-title">
                      <div className="recipe-detail-section-heading">
                        <div><span>STEP 2</span><h5 id="colorant-recipe-title">발색 화합물</h5></div>
                        <b>기본 배합에 외첨</b>
                      </div>
                      {colorants.length > 0 ? (
                        <div className="recipe-detail-table" role="table" aria-label="발색 화합물 외배합">
                          <div className="recipe-detail-table-head" role="row"><span>화합물</span><span>외배합</span><span>계량</span></div>
                          {colorants.map(([formula, pct]) => (
                            <div key={formula} role="row">
                              <strong><code>{formula}</code><small>{COLORANT_LABELS[formula] ?? "발색 화합물"}</small></strong>
                              <span>{formatRecipeAmount(pct)}%</span>
                              <b>{formatRecipeAmount(pct)}g</b>
                            </div>
                          ))}
                        </div>
                      ) : <p className="recipe-detail-empty-colorant">추가 발색 화합물 없이 기본 배합만 사용합니다.</p>}
                      {detailCandidate.colorant_note && <p className="recipe-detail-note">{detailCandidate.colorant_note}</p>}
                    </section>

                    <section className="recipe-detail-firing" aria-labelledby="firing-guide-title">
                      <div><span>STEP 3</span><h5 id="firing-guide-title">소성 가이드</h5></div>
                      <p>{compactFiringNote(detailCandidate.predicted_firing_note)}</p>
                    </section>

                    <div className="recipe-detail-batch-summary">
                      <span>최종 건식 계량량</span>
                      <strong>{formatRecipeAmount(100 + colorantTotal)}g</strong>
                      <small>기본 유약 100g + 발색 화합물 {formatRecipeAmount(colorantTotal)}g · 물과 첨가제는 제외</small>
                    </div>
                    <p className="recipe-detail-caution">먼저 소량 테스트 타일로 확인하세요. 원료 분진용 보호구를 착용하고, 실제 발색은 소지·두께·가마 분위기·냉각에 따라 달라질 수 있습니다.</p>
                  </div>
                  <button type="button" className="recipe-detail-close" onClick={() => setDetailCandidate(null)}>확인</button>
                </>
              );
            })()}
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
