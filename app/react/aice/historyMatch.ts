import type { AiceRunRecord } from "../lib/api";
import type { RecipeCandidate } from "./contract";
import { GLOSS_LEVEL, TRANSPARENCY_LEVEL, coordinateDistance, type GlossLevel, type TargetCoordinate, type TransparencyLevel } from "./targetCoordinate";

// 1페이지(RecipeChatScreen) — 새 프롬프트를 사용자의 저장된 과거 AiceRun
// 이력과 비교하는 규칙 기반 검색(RAG)이다. `aiMvp.ts`의 예전
// `rankRecommendations`/`LocalEvidenceRetriever`와 같은 두 축 구조(낱말
// 겹침 + 좌표 거리)를 쓰지만, 데이터 소스가 고정 데모(`RECIPE_CANDIDATES`)가
// 아니라 실제 `aiceRunsApi.listMine`이 돌려주는 사용자 본인의 과거 회차라는
// 점이 다르다. 학습 모델이 아니라 규칙(낱말 겹침 계산 + 좌표 거리 계산)만
// 쓴다 — 부록 D "AI를 판단 주체로 쓰지 않는다"와 같은 경계.
export type HistoryMatch = {
  runId: string;
  runTitle: string;
  candidate: RecipeCandidate;
  distance: number | null;
  matchedTerms: string[];
  remark: string;
};

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,./·]+/)
    .filter((term) => term.length >= 2);
}

function overlap(promptTerms: string[], pastPrompt: string): string[] {
  const promptSet = new Set(promptTerms);
  return keywords(pastPrompt).filter((term) => promptSet.has(term));
}

function toCoordinate(candidate: RecipeCandidate): TargetCoordinate | null {
  const gloss = candidate.target_gloss?.toLowerCase() as GlossLevel | undefined;
  const transparency = candidate.target_transparency?.toLowerCase() as TransparencyLevel | undefined;
  if (!gloss || !(gloss in GLOSS_LEVEL) || !transparency || !(transparency in TRANSPARENCY_LEVEL)) return null;
  return { gloss, transparency };
}

//: 낱말이 하나도 안 겹쳐도 좌표가 아주 가까우면(거리 <= 1) 후보로 남긴다 —
//: 반대로 낱말이 겹치면 좌표를 몰라도(예: 과거 후보 좌표 미상) 후보로 남긴다.
const COORDINATE_MATCH_THRESHOLD = 1;

export function findSimilarHistory(
  promptText: string,
  freshCandidates: RecipeCandidate[],
  history: AiceRunRecord[],
  limit = 3,
): HistoryMatch[] {
  const promptTerms = keywords(promptText);
  const freshCoordinates = freshCandidates.map(toCoordinate).filter((coord): coord is TargetCoordinate => coord !== null);

  const matches: HistoryMatch[] = [];
  for (const record of history) {
    const pastPrompt = record.run.intake?.prompt_text ?? "";
    const pastCandidates = record.run.intake?.candidates.candidates ?? [];
    if (!pastPrompt || pastCandidates.length === 0) continue;
    const matchedTerms = overlap(promptTerms, pastPrompt);
    for (const pastCandidate of pastCandidates) {
      const pastCoord = toCoordinate(pastCandidate);
      const distance = pastCoord && freshCoordinates.length
        ? Math.min(...freshCoordinates.map((coord) => coordinateDistance(coord, pastCoord)))
        : null;
      const coordinateMatches = distance !== null && distance <= COORDINATE_MATCH_THRESHOLD;
      if (matchedTerms.length === 0 && !coordinateMatches) continue;
      const remark = matchedTerms.length
        ? `과거 "${record.title}" 요청과 낱말 ${matchedTerms.join(", ")}이(가) 겹쳐 다시 올렸습니다${coordinateMatches ? ` (목표 좌표 거리 ${distance})` : ""}.`
        : `낱말은 다르지만 목표 좌표 거리가 ${distance}로 가까운 과거 "${record.title}" 후보입니다.`;
      matches.push({ runId: record.id, runTitle: record.title, candidate: pastCandidate, distance, matchedTerms, remark });
    }
  }

  return matches
    .sort((a, b) => {
      if (b.matchedTerms.length !== a.matchedTerms.length) return b.matchedTerms.length - a.matchedTerms.length;
      const ad = a.distance ?? Number.POSITIVE_INFINITY;
      const bd = b.distance ?? Number.POSITIVE_INFINITY;
      return ad - bd;
    })
    .slice(0, limit);
}
