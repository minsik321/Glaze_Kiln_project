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

// 거의 모든 요청에 들어가는 낱말은 겹쳐도 "비슷한 요청"의 근거가 못 된다 —
// 이걸로 매칭하면 목표와 전혀 다른 과거 후보가 딸려 올라온다.
const GENERIC_TERMS = new Set([
  "유약", "레시피", "배합", "느낌", "추천", "만들어", "만들고", "만들기", "찾고", "찾아",
  "원해", "원해요", "싶어", "싶어요", "있어요", "해주세요", "주세요", "알려줘", "알려주세요",
  "또는", "그리고", "정도", "약간", "조금", "좀",
]);

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,./·]+/)
    .filter((term) => term.length >= 2 && !GENERIC_TERMS.has(term));
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

//: 후보 하나하나를 목표 좌표 기준으로 거른다. 좌표를 비교할 수 있으면 거리가
//: 임계값(<= 1) 이내인 후보만 남긴다 — 낱말이 겹쳐도 좌표가 먼 후보는 버린다
//: (과거 요청 하나가 겹친다고 그 요청의 후보를 전부 끌어오지 않는다).
//: 좌표를 비교할 수 없으면 낱말이 충분히(>= 2개) 겹칠 때만 남긴다.
const COORDINATE_MATCH_THRESHOLD = 1;
const MIN_TERMS_WITHOUT_COORDINATE = 2;

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
      if (distance !== null) {
        if (!coordinateMatches) continue;
      } else if (matchedTerms.length < MIN_TERMS_WITHOUT_COORDINATE) {
        continue;
      }
      const remark = matchedTerms.length
        ? `과거 "${record.title}" 요청과 낱말 ${matchedTerms.join(", ")}이(가) 겹쳐 다시 올렸습니다${coordinateMatches ? ` (목표 좌표 거리 ${distance})` : ""}.`
        : `낱말은 다르지만 목표 좌표 거리가 ${distance}로 가까운 과거 "${record.title}" 후보입니다.`;
      matches.push({ runId: record.id, runTitle: record.title, candidate: pastCandidate, distance, matchedTerms, remark });
    }
  }

  return matches
    .sort((a, b) => {
      const ad = a.distance ?? Number.POSITIVE_INFINITY;
      const bd = b.distance ?? Number.POSITIVE_INFINITY;
      if (ad !== bd) return ad - bd;
      return b.matchedTerms.length - a.matchedTerms.length;
    })
    .slice(0, limit);
}
