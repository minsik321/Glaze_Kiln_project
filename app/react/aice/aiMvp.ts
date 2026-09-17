import type { SourceType } from "./contract";
import { RECIPE_CANDIDATES, type RecipeId } from "./catalog";
import { coordinateDistance, type TargetCoordinate } from "./targetCoordinate";

export type EvidenceCard = {
  id: string;
  title: string;
  publication: string;
  url: string;
  locator: string;
  originalCondition: string;
  conversion: string;
  interpretation: string;
  limitation: string;
  sourceType: SourceType;
};

export type RecommendationOrigin = "rule" | "rag" | "trained_model";
export type RankedRecommendation = {
  recipeId: RecipeId;
  //: 목표 좌표와의 거리 d — coordinateDistance(targetCoordinate.ts)로 실제
  //: 계산한 값이다. 0이 정확히 일치, 클수록 멀다(예전의 `100 - index*18`
  //: 임의 점수가 아니다).
  distance: number;
  reason: string;
  origins: RecommendationOrigin[];
  evidenceIds: string[];
  modelVersion: string;
  limitation: string;
};

export const AI_RULE_VERSION = "aice-rule-rag-1";

export const EVIDENCE_CARDS: readonly EvidenceCard[] = [
  {
    id: "tw-color-recipe", title: "목표 색상 기반 레시피 재탐색 구조", publication: "TW202533100A / TWI857914B",
    url: "https://patents.google.com/patent/TW202533100A/en", locator: "공개 초록·설명 요약; 상세 문단·실시예 번호 확인 전",
    originalCondition: "레시피·색상 데이터셋, 목표색과 AI 예측색의 차이 및 임계값 비교",
    conversion: "수치 복제 없음; 검색→색 차이 비교→재탐색의 관계만 규칙으로 구조화",
    interpretation: "기존 후보를 목표 메타데이터와 비교해 순서를 정하는 참고 구조",
    limitation: "재사용 가능한 대규모 학습 데이터가 아니며 실제 색상 정확도나 일반화를 입증하지 않음",
    sourceType: "patent_range",
  },
  {
    id: "cn-firing-feedback", title: "결과 피드백과 다음 곡선 전달", publication: "CN108931144A",
    url: "https://patents.google.com/patent/CN108931144A/zh", locator: "공개 초록·설명 요약; 상세 문단·실시예 번호 확인 전",
    originalCondition: "PID 온도곡선 추종, 작업자 결과 점수, 회귀·유전 알고리즘 최적화, 다음 제어기 전달",
    conversion: "실제 계수·곡선 복제 없음; 평가→후보 비교→가상 제어기 전달 관계만 구조화",
    interpretation: "AiceRun 피드백 루프와 승인된 가상 곡선 전달의 선행 개념",
    limitation: "실제 가마 자동운전, 안전성 또는 AICE의 실시 가능성을 증명하지 않음",
    sourceType: "patent_range",
  },
  {
    id: "us-dual-glaze", title: "특정 이중 유약층의 두께 민감도", publication: "US20240360039A1",
    url: "https://patents.google.com/patent/US20240360039A1/en", locator: "공개 설명의 두께별 실시예 요약; 표·문단 번호 확인 전",
    originalCondition: "위생도기, 특정 이중 유약 조성·입도·두께와 소성 조건",
    conversion: "원 수치 전용 변환 없음; 두께가 색차·표면에 영향을 줄 수 있다는 방향성만 사용",
    interpretation: "두께 변화 시 후보를 다시 검토해야 한다는 제약 근거",
    limitation: "다른 기물·단일 유약에 일반화하지 않으며 두께별 곡선 변경량을 산출하지 않음",
    sourceType: "patent_range",
  },
  {
    id: "de-optical-thickness", title: "도포 전후 차이를 이용한 층 두께 관리", publication: "DE3320160C2",
    url: "https://patents.google.com/patent/DE3320160C2/en", locator: "공개 초록·설명 요약; 상세 청구항·문단 확인 전",
    originalCondition: "산업 광학 측정의 도포 전후 차이와 도포장치 되먹임",
    conversion: "광학값을 무게값으로 변환하지 않음; 전후 상태 차이를 기록하는 개념만 인용",
    interpretation: "AICE의 전후 무게 기록과 평균 두께 추정에 대한 간접 선행 개념",
    limitation: "무게·면적·건조밀도 계산식을 직접 뒷받침하지 않고 AICE는 도포장치를 제어하지 않음",
    sourceType: "patent_range",
  },
  {
    id: "glazy-schedules", title: "레시피와 소성 스케줄 연결", publication: "Glazy 공식 도움말",
    url: "https://help.glazy.org/guide/kiln-schedules", locator: "Kiln schedules 안내; 세부 절 확인 전",
    originalCondition: "공개 레시피 서비스의 스케줄 저장·연결 방식",
    conversion: "외부 수치·사진·설명 복제 없음; 링크와 연결 방식만 참고",
    interpretation: "레시피와 곡선을 분리 저장하고 연결하는 인터페이스 참고",
    limitation: "공개 데이터는 CC BY-NC-SA 조건 검토가 필요하며 사진은 앱 자산으로 사용하지 않음",
    sourceType: "literature",
  },
  {
    id: "glazybench", title: "유약 특성 예측 연구 과제와 baseline", publication: "GlazyBench · arXiv:2605.06641",
    url: "https://arxiv.org/abs/2605.06641", locator: "논문 초록·baseline 요약; 표 번호 확인 전",
    originalCondition: "레시피 특성 예측과 결과 이미지 생성 연구 데이터셋",
    conversion: "데이터·이미지 복제 없음; 학습 필요성·평가 분리 게이트 설계에만 사용",
    interpretation: "입력 결손과 라벨 노이즈를 고려한 독립 평가 필요성의 참고",
    limitation: "AICE 데이터셋 사용권·표본·독립 평가를 제공하지 않으며 제품 예측 성능 근거가 아님",
    sourceType: "literature",
  },
] as const;

export interface EvidenceRetriever {
  search(query: string, limit?: number): Array<{ evidenceId: string; matchedTerms: string[] }>;
}

export class LocalEvidenceRetriever implements EvidenceRetriever {
  search(query: string, limit = 3) {
    const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length >= 2);
    return EVIDENCE_CARDS.map((card) => ({ evidenceId: card.id, matchedTerms: terms.filter((term) => `${card.title} ${card.interpretation} ${card.originalCondition}`.toLowerCase().includes(term)) }))
      .filter((match) => match.matchedTerms.length > 0)
      .sort((a, b) => b.matchedTerms.length - a.matchedTerms.length || a.evidenceId.localeCompare(b.evidenceId))
      .slice(0, limit);
  }
}

//: 3개 목표 버튼(AicePrototype.tsx STEP 2)의 좌표 매핑 — 버튼 설명 문구
//: ("은은한 광택 · 불투명" 등)를 그대로 좌표로 옮긴 것이다. 없는 goal은
//: satin-blue로 대체한다(예전 GOAL_ORDER 기본값과 같은 자리).
const GOAL_TARGET: Record<string, TargetCoordinate> = {
  "satin-blue": { gloss: "satin", transparency: "opaque" },
  "clear-warm": { gloss: "gloss", transparency: "transparent" },
  "matte-white": { gloss: "matte", transparency: "opaque" },
};

export function rankRecommendations(input: { goal: string; clayBody?: string; version?: string }, retriever: EvidenceRetriever = new LocalEvidenceRetriever()): RankedRecommendation[] {
  const version = input.version ?? AI_RULE_VERSION;
  const target = GOAL_TARGET[input.goal] ?? GOAL_TARGET["satin-blue"];
  const evidence = retriever.search(`${input.goal} 색상 레시피 두께`, 2).map((match) => match.evidenceId);
  const ranked = RECIPE_CANDIDATES
    .map((candidate) => ({
      recipeId: candidate.id,
      distance: coordinateDistance(target, { gloss: candidate.gloss, transparency: candidate.transparency }),
    }))
    .sort((a, b) => a.distance - b.distance || a.recipeId.localeCompare(b.recipeId));
  return ranked.map(({ recipeId, distance }, index) => ({
    recipeId,
    distance,
    reason: index === 0
      ? `목표 좌표와의 거리가 ${distance}로 가장 가깝고, 적용 조건 재확인이 필요합니다.`
      : `목표 좌표와의 거리 ${distance} — 비교 후보로 유지합니다.`,
    origins: evidence.length ? ["rule", "rag"] : ["rule"],
    evidenceIds: evidence,
    modelVersion: version,
    limitation: "학습 모델 점수가 아니며 실제 결과·색상·품질을 보장하지 않습니다.",
  }));
}

export type TrainingGateInput = { baselineMetricDefined: boolean; rightsConfirmedSamples: number; minimumSamples: number; executionLevelSplit: boolean; outOfRangeEvaluation: boolean; independentTestSet: boolean };
export function evaluateTrainingGate(input: TrainingGateInput) {
  const checks = {
    baselineImprovementTarget: input.baselineMetricDefined,
    rightsAndSampleSize: input.rightsConfirmedSamples >= input.minimumSamples && input.minimumSamples > 0,
    leakageSafeSplit: input.executionLevelSplit,
    outOfRangeDetection: input.outOfRangeEvaluation,
    independentEvaluation: input.independentTestSet,
  };
  const passed = Object.values(checks).every(Boolean);
  return { passed, checks, decision: passed ? "evaluation_only" as const : "blocked" as const, reason: passed ? "독립 평가 전용 후보를 만들 수 있으나 제품 사용은 별도 검증이 필요합니다." : "권리 확인 표본·독립 평가·범위 밖 검증이 부족해 학습 모델을 제품 경로에서 차단합니다." };
}

export const MVP_TRAINING_GATE = evaluateTrainingGate({ baselineMetricDefined: true, rightsConfirmedSamples: 0, minimumSamples: 100, executionLevelSplit: false, outOfRangeEvaluation: false, independentTestSet: false });

// The generator is deliberately a time-domain disturbance model, unlike the metadata ranker.
export function generateSyntheticScenario(seed: number, length = 6) {
  let state = (seed >>> 0) || 1;
  return Array.from({ length }, (_, index) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const disturbance = ((state / 0xffffffff) - .5) * 2;
    return { step: index, thermalDisturbance: Number(disturbance.toFixed(4)), source_type: "synthetic" as const, generatorVersion: "thermal-disturbance-lcg-1" };
  });
}

export function productPredictorStatus() {
  return MVP_TRAINING_GATE.passed ? { enabled: false, version: null, reason: "평가 전용 단계이며 제품 활성화에는 별도 승인이 필요합니다." } : { enabled: false, version: null, reason: MVP_TRAINING_GATE.reason };
}
