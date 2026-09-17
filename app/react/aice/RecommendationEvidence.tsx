import { AI_RULE_VERSION, EVIDENCE_CARDS, MVP_TRAINING_GATE, productPredictorStatus, rankRecommendations } from "./aiMvp";
import { RECIPE_CANDIDATES, SOURCE_LABELS } from "./catalog";
import { Alert, DetailDrawer, StatusBadge } from "./ui";

export function RecommendationEvidence({ goal, clayBody }: { goal: string; clayBody?: string }) {
  const ranked = rankRecommendations({ goal, clayBody, version: AI_RULE_VERSION });
  const predictor = productPredictorStatus();
  return (
    <section className="recommendation-evidence" aria-labelledby="ai-evidence-title">
      <div className="evidence-heading"><div><h3 id="ai-evidence-title">추천 근거와 AI 경계</h3><p>규칙 + 소규모 출처 검색(RAG) + 제약 순위 · {AI_RULE_VERSION}</p></div><StatusBadge tone="unavailable">학습 모델 미사용</StatusBadge></div>
      <ol className="ranked-evidence-list">{ranked.map((item) => {
        const candidate = RECIPE_CANDIDATES.find((recipe) => recipe.id === item.recipeId)!;
        return <li key={item.recipeId}><span className="rank-score">{item.score}</span><div><strong>{candidate.name}</strong><p>{item.reason}</p><small>생성 경로: {item.origins.map((origin) => origin === "rule" ? "출처 있는 규칙" : origin === "rag" ? "RAG 검색" : "학습 모델").join(" + ")} · 근거 {item.evidenceIds.length}건</small><small>{item.limitation}</small></div></li>;
      })}</ol>
      <Alert tone="unavailable" title="학습 게이트 차단">{predictor.reason}</Alert>
      <DetailDrawer summary="학습 필요성 게이트 보기"><ul className="gate-list">{Object.entries(MVP_TRAINING_GATE.checks).map(([key, passed]) => <li key={key}><StatusBadge tone={passed ? "complete" : "unavailable"}>{passed ? "충족" : "미충족"}</StatusBadge>{key}</li>)}</ul><p>게이트를 통과해도 독립 평가 전용 후보일 뿐, 자동으로 제품 경로에 들어가지 않습니다.</p></DetailDrawer>
      <DetailDrawer summary="특허·문헌 출처 카드 보기"><div className="evidence-card-grid">{EVIDENCE_CARDS.map((card) => <article key={card.id} className="evidence-card"><div><StatusBadge tone="unavailable">{SOURCE_LABELS[card.sourceType]}</StatusBadge><strong>{card.publication}</strong></div><h4>{card.title}</h4><dl><div><dt>위치</dt><dd>{card.locator}</dd></div><div><dt>원 조건</dt><dd>{card.originalCondition}</dd></div><div><dt>단위변환</dt><dd>{card.conversion}</dd></div><div><dt>AICE 해석</dt><dd>{card.interpretation}</dd></div><div><dt>적용 한계</dt><dd>{card.limitation}</dd></div></dl><a href={card.url} target="_blank" rel="noreferrer">공개 원문 링크</a></article>)}</div><p className="rights-note">특허 사진·도면과 외부 결과 사진은 앱 자산 또는 학습 데이터로 복제하지 않았습니다.</p></DetailDrawer>
    </section>
  );
}
