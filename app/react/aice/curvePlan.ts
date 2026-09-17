import { kilnFiringApi, type KilnDisturbance } from "../lib/api";
import type { FiringCurve, SourceType, SourcedValue } from "./contract";
import type { CoatingPreset } from "./thicknessView";

// LLM 프런트도어 TODO Phase 3: 이름 붙은 제어 프리셋(빠른 반응/균형/안정 우선)을
// 사용자에게 "제품 옵션"처럼 고르게 하던 3버튼 UI를 없앴다. `ControlPreset`과
// `CONTROL_PLANS`는 여전히 존재하지만 이제부터는 CurveControlPanel 내부에서만
// 쓰는 구현 세부사항이다 — 서로 다른 외란 시나리오 3벌을 "다시 추천" 액션이
// 순환해 보여주는 용도로만 남았고, 사용자에게는 프리셋 이름이나 설명 문구를
// 노출하지 않는다. 사용자에게 보이는 결정은 이제 이진값(`ControlDecision`)뿐이다.
//
// `simulateController`는 예전에는 브라우저 안에서 합성 PID 수식을 직접
// 계산했다. 지금은 백엔드 `/kiln/firing/simulate`를 불러
// `kiln.firing.controller.SegmentedController`·
// `kiln.firing.simulator.KilnSimulator`(물리 판정 코어, 9-4·9-5·12-2절)를
// 그대로 돌린 결과를 받는다 — Pyodide 브리지가 아니라 백엔드 API 경계다
// (densityAdvice.ts와 같은 이유: src/kiln은 이제 백엔드에서만 쓰인다).
// 그래서 "프리셋"의 의미도 "PID 게인 세트"에서 "재현 가능한 외란
// 시나리오"(`kiln.firing.simulator.Disturbance`)로 바뀌었다 — 실제 물리
// 시뮬레이터가 있는 자리에 임의의 게인을 박아 둘 이유가 없다.
export type ControlPreset = "fast" | "balanced" | "stable";

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
  preset: ControlPreset;
  //: `SegmentedController._inner_power`가 실제로 "전향보상 + 비례"라고
  //: 부르는 그 구조다 (9-4절) — contract.py `PidExecution.controller_kind`의
  //: `"feedforward_p"` 리터럴과 맞춘다. "pid"가 아니다: 적분·미분 항이 없다.
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

const BASE = [
  { minute: 0, temperatureC: 20 }, { minute: 60, temperatureC: 110 }, { minute: 300, temperatureC: 980 },
  { minute: 360, temperatureC: 1199 }, { minute: 400, temperatureC: 1199 }, { minute: 480, temperatureC: 631 },
];

// 내부 구현 전용 — 화면에 이 순서·이름을 노출하지 않는다. "다시 추천"을 누를
// 때마다 다음 항목으로 순환한다.
export const PRESET_ORDER: ControlPreset[] = ["balanced", "fast", "stable"];

const DISTURBANCE_UNITS: Record<keyof Required<KilnDisturbance>, string> = {
  supply_voltage_pct: "%", element_aging_pct: "%", thermocouple_noise_c: "℃",
  thermocouple_lag_s: "s", load_mismatch_pct: "%", wall_lag_s: "s", seed: "",
};

function control(preset: ControlPreset, disturbance: KilnDisturbance): ControlPlan {
  const sourced = (value: number, unit: string): SourcedValue<number> => ({
    value, unit, source_type: "synthetic", confidence: null,
    note: "재현 가능한 외란 시나리오(12-2절 Disturbance); 실제 가마 실측값 아님",
  });
  const parameters: Record<string, SourcedValue<number>> = {};
  for (const [key, value] of Object.entries(disturbance)) {
    parameters[key] = sourced(value as number, DISTURBANCE_UNITS[key as keyof KilnDisturbance] ?? "");
  }
  return {
    preset, controllerKind: "feedforward_p", disturbance, parameters,
    constraints: { outputMinPercent: 0, outputMaxPercent: 100, antiWindup: "출력은 0–최대전력으로 물리 포화된다(적분 항 없음)", sampleSeconds: 60 },
    warning: "kiln.firing의 실제 제어기·시뮬레이터를 돌리지만 오지정된 생성기 위의 상대 비교용이며(부록 A) 실제 가마 제어에 사용할 수 없습니다.",
  };
}

export const CONTROL_PLANS: Record<ControlPreset, ControlPlan> = {
  // 이상적 조건 — 외란 없음(열전대 잡음만 최소로 둬 궤적이 완전히 평평해
  // 보이지 않게 한다).
  fast: control("fast", { thermocouple_noise_c: 0.2, seed: 1 }),
  // 9-2절이 명시한 계통 불확실의 중앙값 근처(공급전압 −2%, 열선 노후 5%).
  balanced: control("balanced", {
    supply_voltage_pct: -2, element_aging_pct: 5, thermocouple_noise_c: 0.5,
    thermocouple_lag_s: 5, load_mismatch_pct: 3, wall_lag_s: 10, seed: 2,
  }),
  // 9-2절 범위의 상한 근처(공급전압 +5%, 열선 노후 15%) — 계통 불확실이 가장 큰 경우.
  stable: control("stable", {
    supply_voltage_pct: 5, element_aging_pct: 15, thermocouple_noise_c: 1.0,
    thermocouple_lag_s: 15, load_mismatch_pct: 10, wall_lag_s: 30, seed: 3,
  }),
};

export function buildCurveComparison(
  coating: CoatingPreset,
  //: LLM 프런트도어 TODO Phase 3 — Prediction Model 초안(predictionModel.ts)이
  //: 계산한 "다음 실행 제안" 보정값. 생략하면 기존 고정값(-3 °C)을 쓴다 —
  //: 예측 입력(레시피·기물·이력)이 없는 호출부(예: 테스트)도 그대로 동작한다.
  nextHoldDeltaC = -3,
  nextReason = "합성 추종오차를 줄이기 위한 미승인 제안",
): CurveSeries[] {
  const adjustedDelta = coating === "thick" ? -12 : coating === "thin" ? 6 : -4;
  const reason = coating === "thick" ? "두꺼운 형상 기반 분포를 반영해 최고 구간을 낮추고 완만하게 만든 합성 후보" : coating === "thin" ? "얇은 형상 기반 분포를 반영해 유지 구간을 줄인 합성 후보" : "목표 근처 도포의 불확실성을 반영한 완만한 합성 후보";
  const adjusted = BASE.map((point) => point.minute >= 300 && point.minute <= 400 ? { ...point, temperatureC: point.temperatureC + adjustedDelta } : point);
  const actual = adjusted.map((point, index) => ({ ...point, temperatureC: round(point.temperatureC + (index % 2 ? -7 : 3)) }));
  const next = adjusted.map((point) => point.minute === 360 || point.minute === 400 ? { ...point, temperatureC: point.temperatureC + nextHoldDeltaC } : point);
  return [
    { id: "baseline-v1", role: "baseline", label: "기준 계획", sourceType: "synthetic", points: BASE, reason: "비교를 위한 설명용 기준 계획" },
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

export async function simulateController(series: CurveSeries, preset: ControlPreset): Promise<ControllerRun> {
  const plan = CONTROL_PLANS[preset];
  const response = await kilnFiringApi.simulate(
    series.points.map((point) => [point.minute, point.temperatureC] as const),
    plan.disturbance,
    plan.constraints.sampleSeconds,
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
