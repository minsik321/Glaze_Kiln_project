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
};

export type PredictionResult = {
  //: 유지 구간(360~400분) 목표 온도에 더할 보정값 [°C].
  holdDeltaC: number;
  reason: string;
};

const BASE_HOLD_DELTA_C = -3;

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
  const holdDeltaC = Number(((BASE_HOLD_DELTA_C + sizeAdjust + rangeAdjust) * historyDamping).toFixed(1));
  return {
    holdDeltaC,
    reason: `기물 크기(${size})·레시피 예상 소성범위·이전 실행 ${input.priorRunCount}회를 반영한 합성 제안입니다 — 실제 소성 결과를 예측하지 않습니다.`,
  };
}
