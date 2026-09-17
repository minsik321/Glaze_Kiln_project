import type { WarePreset } from "./catalog";
import type { CoatingPreset } from "./thicknessView";

// LLM 프런트도어 TODO Phase 3 — "Prediction Model 초안". 입력(레시피·두께·
// 기물·가마·이력) → 소성곡선 조정안 1개를 출력한다. `curvePlan.ts`의
// `CurveBundle`(baseline/candidates/selected_id)은 이미 "여러 안 중 하나
// 선택"을 표현할 수 있으므로 그 구조를 그대로 쓴다 — 이 모듈이 만드는 건
// 그 후보 중 "다음 실행 제안"(role: next) 한 장의 보정값뿐이다.
//
// 이건 명시적으로 **초안**이다: 실제 소성 결과를 예측하지 않고, 입력을
// 반영해 합성 보정값을 계산하는 결정론적 규칙일 뿐이다(§00 — source_type은
// 항상 "synthetic"/"inferred", 절대 "observed"로 격상하지 않음). 학습 루프
// (Phase 5, kiln.calibration)와는 별개다.

//: 카탈로그 라벨 기준 대표 크기 분류 — `WareSelection.size_category`와
//: 같은 세 값을 쓴다. 실측 치수가 아니라 형상 카드 선택에서 바로 나온
//: 근사치다(§3 "대표 형상에 근거한 추정" 원칙과 동일).
export const WARE_SIZE_CATEGORY: Record<WarePreset, "small" | "medium" | "large"> = {
  bowl: "medium",
  plate: "large",
  mug: "small",
  cylinder_vase: "large",
  bottle: "medium",
  tile: "small",
  other: "medium",
};

export const PREDICTOR_VERSION = "aice-predictor-draft-1";

export type PredictionInput = {
  coating: CoatingPreset;
  ware: WarePreset;
  //: 레시피 후보의 예상 소성범위 [°C, °C] — 없으면 null.
  recipeFiringRangeC: readonly [number | null, number | null] | null;
  //: 이 목표·레시피 조합으로 이미 진행한 실행 횟수. 이력이 쌓일수록
  //: (캘리브레이션이 진행됐다고 가정하고) 보정 폭을 줄인다 — 완전한 학습
  //: 루프는 아니고(Phase 5 몫), 반복 시행마다 보정이 수렴한다는 방향성만
  //: 표현하는 합성 규칙이다.
  priorRunCount: number;
  //: `kiln.calibration.firing`이 누적한 실측 신호 — 이 레시피로 평가
  //: 완료된 회차들의 (실제 광택 레벨 − 목표 광택 레벨) 가중 평균
  //: (`GET /aice/calibration/{recipe_id}`의 `gloss_bias_level`). 관측이
  //: 아직 없으면 null(0과 다른 진술 — "관측 없음"을 지어내지 않는다).
  //: 이건 위 다른 보정들과 달리 **실측 되먹임**이라 historyDamping·
  //: coatingFactor의 대상이 아니다(합성 추정치의 불확실성 감쇠와는
  //: 무관한, 독립적으로 관측된 신호이기 때문).
  firingGlossBiasLevel?: number | null;
};

export type PredictionResult = {
  //: 유지 구간(360~400분) 목표 온도에 더할 보정값 [°C].
  holdDeltaC: number;
  reason: string;
};

const BASE_HOLD_DELTA_C = -3;

//: 광택 편향 1레벨(예: SATIN 목표에 실제가 GLOSS로 계속 나옴 = +1)당
//: 유지온도 보정폭 [°C]. 부호를 뒤집는다: 편향이 양수(목표보다 계속
//: 과용융/과유광)면 다음엔 온도를 낮추자는 제안이 되어야 하므로 음수
//: 계수를 곱한다. 크기는 `BASE_HOLD_DELTA_C`(±3)와 같은 자릿수로 잡아
//: 다른 합성 보정과 균형을 맞춘다.
const GLOSS_BIAS_HOLD_DELTA_C_PER_LEVEL = -3;

//: 편향 보정폭 상한 — 누적치가 크게 튀어도(예: 초기 관측 1건이 극단값)
//: 다음 회차 제안이 감당 못 할 폭으로 튀지 않도록 자른다.
const GLOSS_BIAS_HOLD_DELTA_LIMIT_C = 6;

function biasAdjustC(firingGlossBiasLevel: number | null | undefined): number {
  if (firingGlossBiasLevel === null || firingGlossBiasLevel === undefined) return 0;
  const raw = firingGlossBiasLevel * GLOSS_BIAS_HOLD_DELTA_C_PER_LEVEL;
  return Math.max(-GLOSS_BIAS_HOLD_DELTA_LIMIT_C, Math.min(GLOSS_BIAS_HOLD_DELTA_LIMIT_C, raw));
}

//: `catalog.ts`의 `RECIPE_CANDIDATES[].firingRange`는 "1180–1230 °C" 같은
//: 표시용 문자열이다 — 숫자 두 개를 뽑아 예측 입력으로 쓴다. 파싱에
//: 실패하면 null(범위 보정 없음)로 처리한다.
export function parseFiringRangeC(display: string): readonly [number, number] | null {
  const matches = display.match(/\d+/g);
  if (!matches || matches.length < 2) return null;
  return [Number(matches[0]), Number(matches[1])];
}

export function predictNextRun(input: PredictionInput): PredictionResult {
  const size = WARE_SIZE_CATEGORY[input.ware];
  const sizeAdjust = size === "large" ? -2 : size === "small" ? 2 : 0;
  const [lo, hi] = input.recipeFiringRangeC ?? [null, null];
  const rangeMid = lo !== null && hi !== null ? (lo + hi) / 2 : null;
  const rangeAdjust = rangeMid !== null ? Math.max(-4, Math.min(4, (rangeMid - 1199) / 10)) : 0;
  const historyDamping = 1 / (1 + input.priorRunCount * 0.25);
  //: 요구사항: "AI가 추천하는 소성 방법까지 연계가 되면 좋겠어" — 두께가
  //: 이미 "thick"/"thin"으로 확정되면 curvePlan.ts의 adjustedDelta(두께 반영
  //: 수정 계획, -12/+6 °C)가 같은 방향으로 이미 크게 보정한다. 이 예측이
  //: 독립적으로 또 같은 방향 전체 폭을 더하면 이중 보정이 되므로, 두께가
  //: "target"이 아닐 때는 이 합성 제안의 폭을 줄인다(계수는 입력을 실제로
  //: 쓴다는 것을 보이는 최소 규칙이며, 학습된 값이 아니다).
  const coatingFactor = input.coating === "target" ? 1 : 0.6;
  const biasAdjust = biasAdjustC(input.firingGlossBiasLevel);
  const holdDeltaC = Number(
    ((BASE_HOLD_DELTA_C + sizeAdjust + rangeAdjust) * historyDamping * coatingFactor + biasAdjust).toFixed(1)
  );
  const biasClause =
    input.firingGlossBiasLevel !== null && input.firingGlossBiasLevel !== undefined
      ? ` 이 레시피의 실측 광택 편향(누적 ${input.firingGlossBiasLevel.toFixed(2)}레벨)을 반영해 ${biasAdjust >= 0 ? "+" : ""}${biasAdjust.toFixed(1)}°C 보정을 더했습니다.`
      : "";
  return {
    holdDeltaC,
    reason: `기물 크기(${size})·레시피 예상 소성범위·도포 상태(${input.coating})·이전 실행 ${input.priorRunCount}회를 반영한 합성 제안입니다(두께 반영 계획과 겹치지 않도록 도포 상태가 target이 아니면 폭을 줄입니다) — 실제 소성 결과를 예측하지 않습니다.${biasClause}`,
  };
}
