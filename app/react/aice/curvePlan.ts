import type { FiringCurve, SourceType, SourcedValue } from "./contract";
import type { CoatingPreset } from "./thicknessView";

export type ControlPreset = "fast" | "balanced" | "stable";
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
  label: string;
  effect: string;
  controllerKind: "pid";
  parameters: Record<string, SourcedValue<number>>;
  constraints: { outputMinPercent: number; outputMaxPercent: number; antiWindup: string; sampleSeconds: number };
  warning: string;
};

export type ControllerSample = { minute: number; plannedC: number; sensorC: number; estimatedWareC: number; heaterPercent: number; errorC: number; alarm: string | null };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));

const BASE = [
  { minute: 0, temperatureC: 20 }, { minute: 60, temperatureC: 110 }, { minute: 300, temperatureC: 980 },
  { minute: 360, temperatureC: 1199 }, { minute: 400, temperatureC: 1199 }, { minute: 480, temperatureC: 631 },
];

export const CONTROL_PLANS: Record<ControlPreset, ControlPlan> = {
  fast: control("fast", "빠른 반응", "오차 반응은 빠르지만 출력 변화와 초과응답이 커질 수 있음", 0.12, 0.006, 0.03, 5),
  balanced: control("balanced", "균형", "반응 속도와 출력 변화를 절충한 설명용 비교안", 0.08, 0.004, 0.05, 10),
  stable: control("stable", "안정 우선", "출력 변화는 완만하지만 계획 추종이 늦어질 수 있음", 0.05, 0.002, 0.08, 15),
};

function control(preset: ControlPreset, label: string, effect: string, p: number, i: number, d: number, sampleSeconds: number): ControlPlan {
  const sourced = (value: number, unit: string, note: string): SourcedValue<number> => ({ value, unit, source_type: "synthetic", confidence: null, note });
  return {
    preset, label, effect, controllerKind: "pid",
    parameters: {
      proportional_gain: sourced(p, "%/°C", "교육용 합성 게인; 실제 가마 튜닝값 아님"),
      integral_gain: sourced(i, "%/(°C·s)", "교육용 합성 게인; 실제 가마 튜닝값 아님"),
      derivative_gain: sourced(d, "%·s/°C", "교육용 합성 게인; 실제 가마 튜닝값 아님"),
    },
    constraints: { outputMinPercent: 0, outputMaxPercent: 100, antiWindup: "출력 포화 시 적분 누적 정지", sampleSeconds },
    warning: "이 값은 UI 설명과 소프트웨어 검증용 합성 계수이며 실제 가마 제어에 사용할 수 없습니다.",
  };
}

export function buildCurveComparison(coating: CoatingPreset): CurveSeries[] {
  const adjustedDelta = coating === "thick" ? -12 : coating === "thin" ? 6 : -4;
  const reason = coating === "thick" ? "두꺼운 형상 기반 분포를 반영해 최고 구간을 낮추고 완만하게 만든 합성 후보" : coating === "thin" ? "얇은 형상 기반 분포를 반영해 유지 구간을 줄인 합성 후보" : "목표 근처 도포의 불확실성을 반영한 완만한 합성 후보";
  const adjusted = BASE.map((point) => point.minute >= 300 && point.minute <= 400 ? { ...point, temperatureC: point.temperatureC + adjustedDelta } : point);
  const actual = adjusted.map((point, index) => ({ ...point, temperatureC: round(point.temperatureC + (index % 2 ? -7 : 3)) }));
  const next = adjusted.map((point) => point.minute === 360 || point.minute === 400 ? { ...point, temperatureC: point.temperatureC - 3 } : point);
  return [
    { id: "baseline-v1", role: "baseline", label: "기준 계획", sourceType: "synthetic", points: BASE, reason: "비교를 위한 설명용 기준 계획" },
    { id: `thickness-${coating}-v1`, role: "adjusted", label: "두께 반영 수정 계획", sourceType: "synthetic", points: adjusted, reason, annotation: { minute: 340, temperatureC: 1100 + adjustedDelta, text: reason } },
    { id: `actual-${coating}-v1`, role: "actual", label: "시뮬레이션 실제", sourceType: "synthetic", points: actual, reason: "합성 센서 응답으로 재현한 실행선" },
    { id: `next-${coating}-v1`, role: "next", label: "다음 실행 제안", sourceType: "inferred", points: next, reason: "합성 추종오차를 줄이기 위한 미승인 제안" },
  ];
}

function interpolate(points: CurveSeries["points"], minute: number) {
  const rightIndex = points.findIndex((point) => point.minute >= minute);
  if (rightIndex <= 0) return points[Math.max(0, rightIndex)]?.temperatureC ?? 20;
  const left = points[rightIndex - 1]; const right = points[rightIndex];
  const ratio = (minute - left.minute) / (right.minute - left.minute);
  return left.temperatureC + (right.temperatureC - left.temperatureC) * ratio;
}

export function simulateController(series: CurveSeries, preset: ControlPreset): ControllerSample[] {
  const plan = CONTROL_PLANS[preset];
  const p = plan.parameters.proportional_gain.value ?? 0;
  const i = plan.parameters.integral_gain.value ?? 0;
  const d = plan.parameters.derivative_gain.value ?? 0;
  let integral = 0; let previousError = 0; let sensor = 20;
  const samples: ControllerSample[] = [];
  for (let minute = 0; minute <= 480; minute += 20) {
    const planned = interpolate(series.points, minute);
    const error = planned - sensor;
    const derivative = error - previousError;
    const feedforward = minute < 400 ? clamp((planned - 20) / 14, 0, 82) : 0;
    const provisional = feedforward + p * error + i * integral + d * derivative;
    const output = clamp(provisional, 0, 100);
    if (output === provisional) integral = clamp(integral + error * plan.constraints.sampleSeconds, -2000, 2000);
    const response = preset === "fast" ? .72 : preset === "stable" ? .48 : .6;
    sensor = sensor + (planned - sensor) * response + ((minute / 20) % 3 - 1) * 1.2;
    const ware = sensor - clamp((planned - 20) / 150, 0, 8);
    const measuredError = planned - sensor;
    samples.push({ minute, plannedC: round(planned), sensorC: round(sensor), estimatedWareC: round(ware), heaterPercent: round(output), errorC: round(measuredError), alarm: Math.abs(measuredError) > 35 ? "합성 추종오차 큼" : null });
    previousError = error;
  }
  return samples;
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
