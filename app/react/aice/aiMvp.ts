//: v9 개편으로 2~3페이지(목표 카드·정적 레시피 그리드)와 그 화면이 쓰던
//: 규칙+RAG 랭킹 데모(rankRecommendations 등, RecommendationEvidence.tsx)를
//: 지웠다 — 지금은 화면 1(RecipeChatScreen.tsx)이 실제 `/aice/recipe-
//: candidates`와 `historyMatch.ts`(사용자 본인 이력 대상 RAG)를 쓴다.
//: AI_RULE_VERSION만 AiceRun.versions.rule_model 표시용으로 남는다.
export const AI_RULE_VERSION = "aice-rule-rag-1";
