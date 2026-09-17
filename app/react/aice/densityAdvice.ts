// LLM 프런트도어 TODO Phase 3 — "비중 입력 → kiln.batch 경고 로직 연결".
//
// AICE 안내형 화면(app/react/aice/*)은 다른 물리 판정(두께 분포, 소성곡선,
// 가상 제어)과 마찬가지로 Pyodide 브리지 없이 순수 TypeScript로 동작한다
// (curvePlan.ts, thicknessView.ts, kilnSimulation.ts와 같은 패턴). 이 파일은
// src/kiln/batch/density.py의 `assess_density()`를 **그대로 재현**한 것이지
// 새로 지어낸 판정이 아니다 — 상수·분기·문구를 그 파일과 동일하게 유지한다.
// 진짜 물리 코어(레거시 시뮬레이터, app/react/simulator/*)는 여전히
// Pyodide로 실제 `assess_density()`를 호출한다; 이 값과 어긋나면 이 파일이
// 틀린 것이다.

export type DensityStatus = "ok" | "too_thin" | "too_thick" | "out_of_range";

export type DensityAdvice = {
  status: DensityStatus;
  statusLabel: string;
  message: string;
  //: "(문헌 추정 초기값 · 캘리브레이션 전)" — src/kiln/batch/density.py와 동일.
  annotation: string;
  //: 항상 false — 경고가 떠도 진행을 막지 않는다 (6-4절).
  blocksProgress: false;
  remeasureRecommended: boolean;
};

const LITERATURE_ANNOTATION = "(문헌 추정 초기값 · 캘리브레이션 전)";

const STATUS_LABELS: Record<DensityStatus, string> = {
  ok: "정상",
  too_thick: "범위 초과(되직)",
  too_thin: "범위 미달(묽음)",
  out_of_range: "극단적 이탈",
};

export function assessDensity(
  specificGravity: number,
  minutesSinceStirring: number,
  target: [number, number] = [1.4, 1.5],
  settlingLimitMin = 10,
): DensityAdvice {
  const [lo, hi] = target;
  const band = hi - lo;
  const extremeLo = lo - band;
  const extremeHi = hi + band;
  const rho = specificGravity;

  let status: DensityStatus;
  let message: string;
  if (rho >= lo && rho <= hi) {
    status = "ok";
    message = "비중이 권장 범위 안이다.";
  } else if (rho >= extremeLo && rho < lo) {
    status = "too_thin";
    message = "비중이 권장 범위보다 낮다(고형분 부족) — 얇게 붙고 편차가 커질 수 있다. 가라앉힌 뒤 위 맑은 물을 따라내고 재측정을 권장한다.";
  } else if (rho > hi && rho <= extremeHi) {
    status = "too_thick";
    message = "비중이 권장 범위보다 높다(고형분 과다) — 두껍게 붙고 흘러내림 위험이 있다. 물을 소량 추가한 뒤 재측정을 권장한다.";
  } else {
    status = "out_of_range";
    message = "비중이 모델 적용 범위를 크게 벗어났다 — 예측 신뢰도가 낮다. 그대로 진행할지 확인하라.";
  }

  const settledTooLong = minutesSinceStirring > settlingLimitMin;
  const remeasureRecommended = status !== "ok" || settledTooLong;
  if (settledTooLong && status === "ok") {
    message += ` 교반 후 ${Math.round(minutesSinceStirring)}분 경과 — 침강이 진행됐을 수 있어 재측정을 권장한다.`;
  }

  return {
    status,
    statusLabel: STATUS_LABELS[status],
    message,
    annotation: LITERATURE_ANNOTATION,
    blocksProgress: false,
    remeasureRecommended,
  };
}
