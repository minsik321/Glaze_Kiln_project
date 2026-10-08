import type { AiceRunRecord } from "../lib/api";
import { workRecordOrigin } from "../records/workRecords";
import type { RecipeCandidate } from "./contract";
import { GLOSS_LEVEL, TRANSPARENCY_LEVEL, coordinateDistance, normalizeGlossLevel, normalizeTransparencyLevel, type GlossLevel, type TargetCoordinate, type TransparencyLevel } from "./targetCoordinate";

// 1페이지(RecipeChatScreen) — 새 프롬프트를 사용자가 끝까지 작업해 결과까지
// 기록한(status "evaluated") 과거 AiceRun과 비교하는 규칙 기반 검색(RAG)이다.
// AI가 만들어 두기만 한 초안(draft)은 쓰지 않는다 — 실제로 작업해 본
// 레시피와 그 결과가 근거여야 한다. `aiMvp.ts`의 예전
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

//: 같은 레시피인지 보는 지문(fingerprint). 이름·id·사진이 달라도 배합이 같으면 같은
//: 레시피다 — 과거에 같은 배합으로 여러 번 작업한 기록, 또는 AI가 낸 후보가 과거
//: 기록과 같은 배합일 때 카드가 중복으로 뜨던 문제를 막는다. 원료 합을 100으로 맞춰
//: 소수 첫째 자리를 1%로 거칠게 뭉쳐(반올림) 미세한 수치 차이는 같은 것으로 본다.
export function recipeKey(candidate: Pick<RecipeCandidate, "materials" | "colorants">): string {
  const part = (entries: Record<string, number> | undefined, scale: number, digits: number) =>
    Object.entries(entries ?? {})
      .filter(([, amount]) => Number.isFinite(amount) && amount > 0)
      .map(([name, amount]) => [name.trim().toLowerCase(), (amount * scale).toFixed(digits)] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, amount]) => `${name}:${amount}`)
      .join("|");
  const total = Object.values(candidate.materials ?? {}).reduce((sum, amount) => sum + (Number.isFinite(amount) && amount > 0 ? amount : 0), 0);
  const scale = total > 0 ? 100 / total : 1;
  return `${part(candidate.materials, scale, 0)}#${part(candidate.colorants, 1, 1)}`;
}

//: 먼저 나온 것을 남기고 같은 레시피의 나머지는 버린다. `seen`에 이미 있는 키도 버린다.
export function dedupeByRecipe<T>(items: readonly T[], keyOf: (item: T) => string, seen: Iterable<string> = []): T[] {
  const keys = new Set(seen);
  const kept: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (keys.has(key)) continue;
    keys.add(key);
    kept.push(item);
  }
  return kept;
}

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,./·]+/)
    .filter((term) => term.length >= 2 && !GENERIC_TERMS.has(term));
}

function overlap(promptTerms: string[], pastPrompt: string): string[] {
  const promptSet = new Set(promptTerms);
  return [...new Set(keywords(pastPrompt).filter((term) => promptSet.has(term)))];
}

//: 끝까지 작업해 결과를 기록한 내 AiceRun을 카드로 보여줄 후보 모양으로 바꾼다.
//: 좌표는 목표가 아니라 실제 결과(없으면 목표)를 쓴다 — "그렇게 나온" 레시피를
//: 근거로 보여주기 위해서다. 배합이 비어 있는 옛 기록은 카드를 만들 수 없어 뺀다.
export function completedRunCandidate(record: AiceRunRecord): RecipeCandidate | null {
  const run = record.run;
  if (run.status !== "evaluated" || workRecordOrigin(run) !== "mine") return null;
  if (Object.keys(run.recipe.materials).length === 0) return null;
  const gloss = normalizeGlossLevel(run.result.gloss) ?? run.goal.gloss;
  const transparency = normalizeTransparencyLevel(run.result.transparency) ?? run.goal.transparency;
  const resultPhoto = run.result.photo;
  const photo = resultPhoto && (resultPhoto.data_url || resultPhoto.storage_path) ? resultPhoto : run.recipe.photo;
  return {
    id: `completed-${record.id}`,
    name: run.recipe.name || record.title,
    materials: run.recipe.materials,
    colorants: run.recipe.colorants ?? {},
    colorant_note: run.recipe.colorant_note ?? "",
    predicted_firing_range: run.recipe.firing_range,
    predicted_firing_note: "",
    photo,
    source_type: "observed",
    source_ids: [],
    target_gloss: gloss.toUpperCase(),
    target_transparency: transparency.toUpperCase(),
  };
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
    const pastCandidate = completedRunCandidate(record);
    if (!pastCandidate) continue;
    const pastText = [record.run.intake?.prompt_text, record.title, record.run.recipe.name].filter(Boolean).join(" ");
    const matchedTerms = overlap(promptTerms, pastText);
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
      ? `내가 끝까지 작업해 기록한 "${record.title}"과(와) 낱말 ${matchedTerms.join(", ")}이(가) 겹쳐 다시 올렸습니다${coordinateMatches ? ` (결과 좌표 거리 ${distance})` : ""}.`
      : `낱말은 다르지만 실제 결과 좌표 거리가 ${distance}로 가까운, 내가 끝까지 작업해 기록한 "${record.title}"입니다.`;
    matches.push({ runId: record.id, runTitle: record.title, candidate: pastCandidate, distance, matchedTerms, remark });
  }

  const ranked = matches.sort((a, b) => {
    const ad = a.distance ?? Number.POSITIVE_INFINITY;
    const bd = b.distance ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    return b.matchedTerms.length - a.matchedTerms.length;
  });
  //: 순위를 매긴 뒤 중복을 거른다 — 같은 배합이면 가장 가까운 기록 하나만 남기고,
  //: 이번에 AI가 새로 낸 후보와 같은 배합인 과거 기록은 카드를 또 만들지 않는다.
  return dedupeByRecipe(ranked, (match) => recipeKey(match.candidate), freshCandidates.map(recipeKey)).slice(0, limit);
}
