import { kilnFiringApi, type KilnDisturbance } from "../lib/api";
import type { FiringCurve, SourceType, SourcedValue } from "./contract";
import type { CoatingPreset } from "./thicknessView";
import type { KilnScenario } from "./kilnSimulation";

// v9 개편(6/7/8페이지 통합): 예전에는 "다시 추천" 버튼이 이름 없는 외란
// 프리셋 3벌(빠른 반응/균형/안정 우선)을 순환해 보여줬다. 지금은 가마
// 화면의 "이상 시나리오" 선택(kilnSimulation.ts의 KilnScenario, 센서
// 편향·고장·과열·층간 편차)이 그 자리를 대신한다 — 같은 화면 안에서 이상
// 신호를 고르면 "두께 반영 수정 계획"이 그 외란을 반영해 다시 계산되고,
// "기준 계획"은 그대로 고정된다. `SCENARIO_CONTROL_PLANS`가 그 시나리오별
// 외란값이다.
//
// `simulateController`는 예전에는 브라우저 안에서 합성 PID 수식을 직접
// 계산했다. 지금은 백엔드 `/kiln/firing/simulate`를 불러
// `kiln.firing.controller.SegmentedController`·
// `kiln.firing.simulator.KilnSimulator`(물리 판정 코어, 9-4·9-5·12-2절)를
// 그대로 돌린 결과를 받는다 — Pyodide 브리지가 아니라 백엔드 API 경계다
// (densityAdvice.ts와 같은 이유: src/kiln은 이제 백엔드에서만 쓰인다).

// `PidExecution.decision`(src/kiln/aice/contract.py, AICE_SCHEMA_VERSION 3)과
// 짝을 이루는 프런트엔드 타입. 사용자는 "이대로 진행" 또는 "다시 추천"만 고른다.
export type ControlDecision = "accepted" | "regenerate";

export type CurveRole = "baseline" | "adjusted" | "actual" | "next";

export type CurveSeries = {
  id: string;
  role: CurveRole;
  label: string;
  sourceType: SourceType;
  points: Array<{ minute: number; temperatureC: number }>;
  reason: string;
  annotation?: { minute: number; temperatureC: number; text: string };
};

export type ControlPlan = {
  scenario: KilnScenario;
  //: `SegmentedController._inner_power`가 실제로 "전향보상 + 비례"라고
  //: 부르는 그 구조다 (9-4절) — contract.py `PidExecution.controller_kind`의
  //: `"feedforward_p"` 리터럴과 맞춘다. "pid"가 아니다: 적분·미분 항이 없다.
  //: 화면에는 "PID"라는 표현을 쓰지 않는다 — "반응형 제어"라고만 부른다.
  controllerKind: "feedforward_p";
  disturbance: KilnDisturbance;
  parameters: Record<string, SourcedValue<number>>;
  constraints: { outputMinPercent: number; outputMaxPercent: number; antiWindup: string; sampleSeconds: number };
  warning: string;
};

export type ControllerSample = { minute: number; plannedC: number; sensorC: number; estimatedWareC: number; heaterPercent: number; errorC: number; alarm: string | null };

export type ControllerRun = {
  samples: ControllerSample[];
  //: `KilnSimulator.provenance_notes` — 오지정·상대 비교 전용 안내 (부록 A, 12-2절).
  provenanceNotes: string[];
  //: E가 가정값이라는 사실 (부록 C: 값 기재 금지) — 항상 함께 실려 나간다.
  eNote: string;
  targetHeatWork: number;
  peakC: number;
};

const round = (value: number, digits = 1) => Number(value.toFixed(digits));

//: 예전에는 고정 배열이었다("기준 계획이 박힌" 문제). 사용자 요구사항:
//: "소성이 그럼 기준 계획이 박힌게 아니라 레시피에 따른 소성이 되어야지" —
//: 이제 기준 계획 자체를 레시피의 예상 소성범위에서 유도한다. 범위를 모를
//: 때만(레시피 미선택 등) 예전 고정값(최고온도 1199 °C)으로 안전하게
//: 대체한다.
const DEFAULT_PEAK_C = 1199;

const FALLBACK_BASE_SHAPE: ReadonlyArray<{ minute: number; temperatureC: number }> = [
  { minute: 0, temperatureC: 20 }, { minute: 60, temperatureC: 110 }, { minute: 300, temperatureC: 980 },
  { minute: 360, temperatureC: 1199 }, { minute: 400, temperatureC: 1199 }, { minute: 480, temperatureC: 631 },
];

//: 레시피의 예상 소성범위(catalog.ts 표시용 문자열을 parseFiringRangeC로
//: 파싱한 값, 또는 LLM 후보의 predicted_firing_range)가 있으면 그 중앙값을
//: 최고온도로 삼아 기준 계획을 다시 그린다. 300분·480분 지점은 기존 곡선의
//: 형태(최고온도 대비 비율)를 그대로 유지하도록 스케일한다 — 절대
//: 오프셋이 아니다. 범위가 없으면 예전 고정 기준 계획으로 대체한다.
function buildBaselinePoints(recipeFiringRangeC: readonly [number, number] | null): CurveSeries["points"] {
  if (!recipeFiringRangeC) {
    return FALLBACK_BASE_SHAPE.map((point) => ({ ...point }));
  }
  const [lo, hi] = recipeFiringRangeC;
  const peakC = round((lo + hi) / 2, 0);
  const scale = peakC / DEFAULT_PEAK_C;
  return [
    { minute: 0, temperatureC: 20 },
    { minute: 60, temperatureC: 110 },
    { minute: 300, temperatureC: round(980 * scale, 0) },
    { minute: 360, temperatureC: peakC },
    { minute: 400, temperatureC: peakC },
    { minute: 480, temperatureC: round(631 * scale, 0) },
  ];
}

const DISTURBANCE_UNITS: Record<keyof Required<KilnDisturbance>, string> = {
  supply_voltage_pct: "%", element_aging_pct: "%", thermocouple_noise_c: "℃",
  thermocouple_lag_s: "s", load_mismatch_pct: "%", wall_lag_s: "s", seed: "",
};

function control(scenario: KilnScenario, disturbance: KilnDisturbance): ControlPlan {
  const sourced = (value: number, unit: string): SourcedValue<number> => ({
    value, unit, source_type: "synthetic", confidence: null,
    note: "재현 가능한 외란 시나리오(12-2절 Disturbance); 실제 가마 실측값 아님 — 센서 편향·고장류 이상 신호는 해당 필드가 없어 열전대 잡음·지연으로 근사한다",
  });
  const parameters: Record<string, SourcedValue<number>> = {};
  for (const [key, value] of Object.entries(disturbance)) {
    parameters[key] = sourced(value as number, DISTURBANCE_UNITS[key as keyof KilnDisturbance] ?? "");
  }
  return {
    scenario, controllerKind: "feedforward_p", disturbance, parameters,
    constraints: { outputMinPercent: 0, outputMaxPercent: 100, antiWindup: "출력은 0–최대전력으로 물리 포화된다(적분 항 없음)", sampleSeconds: 60 },
    warning: "kiln.firing의 실제 제어기·시뮬레이터를 돌리지만 오지정된 생성기 위의 상대 비교용이며(부록 A) 실제 가마 제어에 사용할 수 없습니다.",
  };
}

//: 가마 화면의 이상 시나리오 선택과 1:1로 대응하는 외란값 — 시나리오를
//: 고르면 "두께 반영 수정 계획"이 이 값으로 다시 계산된다("기준 계획"은
//: 고정). 물리 코어(kiln.firing.simulator.Disturbance)에는 "센서 편향"
//: 같은 전용 필드가 없으므로, 가장 가까운 기존 입력(열전대 잡음·지연 등)
//: 으로 설명용 근사만 만든다 — 새 물리 필드를 추가하지 않는다.
export const SCENARIO_CONTROL_PLANS: Record<KilnScenario, ControlPlan> = {
  normal: control("normal", { thermocouple_noise_c: 0.2, seed: 1 }),
  sensor_bias: control("sensor_bias", {
    thermocouple_noise_c: 1.4, thermocouple_lag_s: 20, seed: 2,
  }),
  sensor_failure: control("sensor_failure", {
    thermocouple_noise_c: 2.5, thermocouple_lag_s: 50, seed: 3,
  }),
  // 9-2절 범위 상한 근처(공급전압 +5%, 열선 노후 15%)보다 더 밀어 과열
  // 경향을 흉내낸다 — 실제 과열 판정 로직이 아니다.
  overheat: control("overheat", {
    supply_voltage_pct: 6, element_aging_pct: 18, thermocouple_noise_c: 0.6, seed: 4,
  }),
  layer_variance: control("layer_variance", {
    load_mismatch_pct: 16, wall_lag_s: 25, thermocouple_noise_c: 0.6, seed: 5,
  }),
};

export function buildCurveComparison(
  coating: CoatingPreset,
  //: 레시피의 예상 소성범위 — 기준 계획을 이 값에서 유도한다("레시피에
  //: 따른 소성"). 없으면(레시피 미선택 등) 고정 기준 계획으로 대체한다.
  recipeFiringRangeC: readonly [number, number] | null = null,
  //: LLM 프런트도어 TODO Phase 3 — Prediction Model 초안(predictionModel.ts)이
  //: 계산한 "다음 실행 제안" 보정값. 생략하면 기존 고정값(-3 °C)을 쓴다 —
  //: 예측 입력(레시피·기물·이력)이 없는 호출부(예: 테스트)도 그대로 동작한다.
  nextHoldDeltaC = -3,
  nextReason = "합성 추종오차를 줄이기 위한 미승인 제안",
): CurveSeries[] {
  const base = buildBaselinePoints(recipeFiringRangeC);
  const baselineSourceType: SourceType = recipeFiringRangeC ? "inferred" : "synthetic";
  const baselineReason = recipeFiringRangeC ? "레시피의 예상 소성범위에서 유도한 기준 계획" : "레시피 정보가 없어 대체한 설명용 기준 계획";
  const adjustedDelta = coating === "thick" ? -12 : coating === "thin" ? 6 : -4;
  const reason = coating === "thick" ? "두꺼운 형상 기반 분포를 반영해 최고 구간을 낮추고 완만하게 만든 합성 후보" : coating === "thin" ? "얇은 형상 기반 분포를 반영해 유지 구간을 줄인 합성 후보" : "목표 근처 도포의 불확실성을 반영한 완만한 합성 후보";
  const adjusted = base.map((point) => point.minute >= 300 && point.minute <= 400 ? { ...point, temperatureC: point.temperatureC + adjustedDelta } : point);
  const actual = adjusted.map((point, index) => ({ ...point, temperatureC: round(point.temperatureC + (index % 2 ? -7 : 3)) }));
  const next = adjusted.map((point) => point.minute === 360 || point.minute === 400 ? { ...point, temperatureC: point.temperatureC + nextHoldDeltaC } : point);
  return [
    { id: "baseline-v1", role: "baseline", label: "기준 계획", sourceType: baselineSourceType, points: base, reason: baselineReason },
    { id: `thickness-${coating}-v1`, role: "adjusted", label: "두께 반영 수정 계획", sourceType: "synthetic", points: adjusted, reason, annotation: { minute: 340, temperatureC: 1100 + adjustedDelta, text: reason } },
    { id: `actual-${coating}-v1`, role: "actual", label: "시뮬레이션 실제", sourceType: "synthetic", points: actual, reason: "합성 센서 응답으로 재현한 실행선" },
    { id: `next-${coating}-v1`, role: "next", label: "다음 실행 제안", sourceType: "inferred", points: next, reason: nextReason },
  ];
}

function interpolate(points: CurveSeries["points"], minute: number) {
  const rightIndex = points.findIndex((point) => point.minute >= minute);
  if (rightIndex <= 0) return points[Math.max(0, rightIndex)]?.temperatureC ?? 20;
  const left = points[rightIndex - 1]; const right = points[rightIndex];
  const ratio = (minute - left.minute) / (right.minute - left.minute);
  return left.temperatureC + (right.temperatureC - left.temperatureC) * ratio;
}

//: 추종오차가 이보다 크면 경보로 표시한다 — 예전 합성 PID 버전과 같은 문턱을
//: 유지해 화면 동작(경보 점 표시)이 바뀌지 않게 한다.
const ALARM_ERROR_THRESHOLD_C = 35;

export async function simulateController(series: CurveSeries, disturbance: KilnDisturbance, sampleSeconds = 60): Promise<ControllerRun> {
  const response = await kilnFiringApi.simulate(
    series.points.map((point) => [point.minute, point.temperatureC] as const),
    disturbance,
    sampleSeconds,
  );
  const samples: ControllerSample[] = response.samples.map((sample) => {
    const planned = interpolate(series.points, sample.minute);
    const errorC = round(planned - sample.sensor_c);
    const heaterPercent = round((sample.power_w / response.max_power_w) * 100);
    const alarm = sample.paused
      ? "센서 이상 · 일시 정지"
      : Math.abs(errorC) > ALARM_ERROR_THRESHOLD_C
        ? "추종오차 큼"
        : null;
    return {
      minute: round(sample.minute),
      plannedC: round(planned),
      sensorC: round(sample.sensor_c),
      estimatedWareC: round(sample.ware_c),
      heaterPercent,
      errorC,
      alarm,
    };
  });
  return {
    samples,
    provenanceNotes: response.provenance_notes,
    eNote: response.e_note,
    targetHeatWork: response.target_heat_work,
    peakC: response.peak_c,
  };
}

export function curveSummary(series: CurveSeries[]): string {
  const baseline = series.find((item) => item.role === "baseline")!;
  const adjusted = series.find((item) => item.role === "adjusted")!;
  const baselinePeak = Math.max(...baseline.points.map((point) => point.temperatureC));
  const adjustedPeak = Math.max(...adjusted.points.map((point) => point.temperatureC));
  const difference = adjustedPeak - baselinePeak;
  return `수정 후보의 합성 최고온도는 기준보다 ${Math.abs(difference)} °C ${difference <= 0 ? "낮고" : "높고"}, 유지시간은 40분으로 같습니다. 총 480분 비교이며 실제 에너지 차이는 판정 불가입니다.`;
}

export function toFiringCurve(series: CurveSeries, selected: boolean): FiringCurve {
  return { id: series.id, role: selected ? "selected" : series.role === "adjusted" ? "candidate" : series.role, source_type: series.sourceType, reason: series.reason, points: series.points.map((point) => ({ minute: point.minute, temperature_c: point.temperatureC })) };
}
