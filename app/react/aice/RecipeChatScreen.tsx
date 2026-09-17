import { useState, type FormEvent } from "react";
import { ApiError, recipeCandidatesApi } from "../lib/api";
import type { RecipeCandidate } from "./contract";
import { SOURCE_LABELS } from "./catalog";
import { Alert, AsyncState, DetailDrawer, StatusBadge } from "./ui";

/**
 * 화면 1(LLM 채팅) — LLM 프런트도어 TODO Phase 2.
 *
 * 자연어 입력을 `kiln.llm`이 검증한 레시피 후보로 바꾸는 화면. 카드
 * 레이아웃은 `RecommendationEvidence.tsx`의 "근거 카드" 패턴
 * (`.evidence-card-grid`)을 그대로 재사용하되, 그 컴포넌트가 쓰는 규칙
 * 기반 추천(`aiMvp.ts`)이 아니라 백엔드의 `/aice/recipe-candidates`를
 * 호출한다 — 별개의 데이터 경로다.
 *
 * 이미지는 카드마다 자동 생성하지 않는다 — 장당 비용(§8)이 있어 사용자가
 * "예상 이미지 생성" 버튼으로 직접 요청한다.
 */
export function RecipeChatScreen({
  token,
  onSelect,
  onIntake,
  disabled = false,
}: {
  token: string;
  onSelect?: (candidate: RecipeCandidate) => void;
  onIntake?: (promptText: string, candidates: RecipeCandidate[]) => void;
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = promptText.trim();
    if (!trimmed || status === "loading" || disabled) return;
    setStatus("loading");
    setError(null);
    try {
      const response = await recipeCandidatesApi.suggest(token, trimmed);
      setCandidates(response.candidates);
      setDropped(response.dropped);
      setSelectedId(response.candidates[0]?.id ?? null);
      setStatus("complete");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "후보를 만들지 못했습니다.");
      setStatus("error");
    }
  }

  function selectCandidate(candidate: RecipeCandidate) {
    setSelectedId(candidate.id);
    onSelect?.(candidate);
    onIntake?.(promptText.trim(), candidates);
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

  return (
    <section className="recipe-chat-screen" aria-labelledby="recipe-chat-title">
      <div className="evidence-heading">
        <div>
          <h3 id="recipe-chat-title">원하는 유약을 문장으로 설명해요</h3>
          <p>LLM이 문헌·일반 지식으로 제안한 출발점이며, 실제 소성 결과를 보장하지 않습니다.</p>
        </div>
        <StatusBadge tone="unavailable">AI 제안 · 실측 아님</StatusBadge>
      </div>
      <form onSubmit={submit} className="recipe-prompt-form">
        <label htmlFor="recipe-prompt">원하는 결과를 설명해 주세요</label>
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
      {status === "complete" && candidates.length === 0 && <AsyncState kind="empty" />}
      {candidates.length > 0 && (
        <div className="evidence-card-grid">
          {candidates.map((candidate) => {
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
                </div>
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
                  <button type="button" onClick={() => requestImage(candidate)} disabled={imageLoading[candidate.id]}>
                    {imageLoading[candidate.id] ? "이미지 생성 중…" : images[candidate.id] ? "이미지 다시 생성" : "예상 이미지 생성"}
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
