// 대응 src/kiln 모듈: 없음 — 의도적 합성. 이 파일은 센서 배치 교육용
// 가마 단면 삽화다(특정 소성 회차와 무관). 실제 소성 제어는
// `curvePlan.ts`가 백엔드 `/kiln/firing/simulate`(kiln.firing.controller·
// simulator)로 돌린다 — 이 파일이 보여주는 "높이별 센서가 서로 다른 값을
// 본다"는 질문에는 그 1-센서 시계열 응답이 답할 수 없어(공간적 3D 열장
// 시뮬레이터가 없다), 실제 데이터로 바꿔치기하지 않고 합성으로 남긴다
// (2026-09-17 감사 결론).
import type { SourceType } from "./contract";
import type { CoatingPreset } from "./thicknessView";

export type SensorPlan = "single" | "three" | "multi";
export type KilnScenario = "normal" | "sensor_bias" | "sensor_failure" | "overheat" | "layer_variance";
export type KilnSegment = "preheat" | "ramp" | "soak" | "cool";

export type SensorPlacement = {
  id: string;
  heightRatio: number;
  target: string;
  blindSpot: string;
  limitation: string;
};

export type KilnReading = {
  minute: number;
  segment: KilnSegment;
  heaterOutputPercent: number;
  layerTemperaturesC: { top: number; middle: number; bottom: number };
  estimatedWareTemperatureC: number;
  layerSpreadC: number;
  sensorReadings: Array<{ id: string; heightRatio: number; temperatureC: number | null; uncertaintyC: number; status: "ok" | "biased" | "failed" }>;
  warnings: Array<{ code: string; message: string; sensorId?: string; layer?: "top" | "middle" | "bottom" }>;
  sourceType: SourceType;
  modelVersion: string;
};

export type KilnFrame = {
  physical: KilnReading;
  visual: {
    sourceType: "synthetic";
    quantitative: false;
    label: "설명용 근사";
    heatLevel: number;
    convectionPhase: number;
  };
};

export const KILN_MODEL_VERSION = "aice-kiln-explanatory-1";
export const TOTAL_MINUTES = 480;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, digits = 1) => Number(value.toFixed(digits));

export function sensorPreset(plan: SensorPlan): SensorPlacement[] {
  const heights = plan === "single" ? [0.5] : plan === "three" ? [0.82, 0.5, 0.18] : [0.9, 0.7, 0.5, 0.3, 0.1];
  return heights.map((heightRatio, index) => {
    const area = heightRatio > 0.67 ? "상단 선반 주변" : heightRatio < 0.34 ? "하단 선반 주변" : "중앙 선반 주변";
    return {
      id: `sensor-${index + 1}`,
      heightRatio,
      target: area,
      blindSpot: heightRatio >= 0.67 ? "하단과 문 근처" : heightRatio <= 0.33 ? "상단과 뚜껑 근처" : "상·하단 끝 영역",
      limitation: "센서 주변 공기 온도이며 기물 내부나 유약 표면을 직접 측정하지 않음",
    };
  });
}

export function recommendSensorPlan(loadCount: number, kilnSize: "small" | "medium" | "large"): { plan: SensorPlan; reason: string } {
  if (kilnSize === "large" || loadCount >= 9) return { plan: "multi", reason: "큰 가마 또는 조밀한 적재는 층 사이 사각지대를 줄이기 위해 다점 비교를 권장합니다." };
  if (kilnSize === "medium" || loadCount >= 4) return { plan: "three", reason: "여러 선반의 층간 편차를 비교하려면 상·중·하 3개가 적합합니다." };
  return { plan: "single", reason: "작고 성긴 적재의 설명용 시작점입니다. 상·하단 편차는 관측할 수 없습니다." };
}

export function moveSensor(sensors: SensorPlacement[], id: string, delta: number): SensorPlacement[] {
  return sensors.map((sensor) => sensor.id === id ? { ...sensor, heightRatio: round(clamp(sensor.heightRatio + delta, 0.08, 0.92), 2) } : sensor);
}

function schedule(minute: number) {
  const time = clamp(minute, 0, TOTAL_MINUTES);
  if (time <= 60) return { segment: "preheat" as const, base: 20 + time * 1.5, output: 45 };
  if (time <= 360) return { segment: "ramp" as const, base: 110 + (time - 60) * 3.63, output: 82 };
  if (time <= 400) return { segment: "soak" as const, base: 1199, output: 38 };
  return { segment: "cool" as const, base: 1199 - (time - 400) * 7.1, output: 0 };
}

function layerAt(heightRatio: number): "top" | "middle" | "bottom" {
  return heightRatio > 0.67 ? "top" : heightRatio < 0.34 ? "bottom" : "middle";
}

export function simulateKilnFrame(input: { minute: number; sensors: SensorPlacement[]; scenario?: KilnScenario; coating?: CoatingPreset }): KilnFrame {
  const scenario = input.scenario ?? "normal";
  const coating = input.coating ?? "target";
  const scheduled = schedule(input.minute);
  const intensity = clamp((scheduled.base - 20) / 1179, 0, 1);
  // These gradients are deterministic synthetic teaching coefficients, not calibrated kiln constants.
  const varianceBoost = scenario === "layer_variance" ? 18 : 0;
  const overheatBoost = scenario === "overheat" && input.minute >= 300 && input.minute <= 410 ? 32 : 0;
  const layers = {
    top: scheduled.base + intensity * (7 + varianceBoost) + overheatBoost,
    middle: scheduled.base + intensity * 1,
    bottom: scheduled.base - intensity * (9 + varianceBoost * 0.7),
  };
  const coverage = new Set(input.sensors.map((sensor) => layerAt(sensor.heightRatio))).size;
  const coveragePenalty = (3 - coverage) * 7;
  const countPenalty = Math.max(0, 3 - input.sensors.length) * 3;
  const warnings: KilnReading["warnings"] = [];
  const sensorReadings = input.sensors.map((sensor, index) => {
    const layer = layerAt(sensor.heightRatio);
    const localGradient = (sensor.heightRatio - 0.5) * 6 * intensity;
    const deterministicOffset = ((index % 3) - 1) * 0.8;
    const isBiased = scenario === "sensor_bias" && index === 0 && input.minute >= 180;
    const isFailed = scenario === "sensor_failure" && index === 0 && input.minute >= 240;
    const temperatureC = isFailed ? null : round(layers[layer] + localGradient + deterministicOffset + (isBiased ? 16 : 0));
    const nearestShelfDistance = Math.min(Math.abs(sensor.heightRatio - 0.82), Math.abs(sensor.heightRatio - 0.5), Math.abs(sensor.heightRatio - 0.18));
    const uncertaintyC = round(5 + coveragePenalty + countPenalty + nearestShelfDistance * 18 + (isBiased ? 16 : 0) + (isFailed ? 30 : 0));
    if (isBiased) warnings.push({ code: "sensor_bias", message: `${sensor.id}가 설명용 +16 °C 편향 상태입니다.`, sensorId: sensor.id, layer });
    if (isFailed) warnings.push({ code: "sensor_failure", message: `${sensor.id} 신호가 끊겨 해당 층을 판정할 수 없습니다.`, sensorId: sensor.id, layer });
    return { id: sensor.id, heightRatio: sensor.heightRatio, temperatureC, uncertaintyC, status: isFailed ? "failed" as const : isBiased ? "biased" as const : "ok" as const };
  });
  const layerValues = Object.values(layers);
  const layerSpreadC = Math.max(...layerValues) - Math.min(...layerValues);
  if (scenario === "overheat" && overheatBoost) warnings.push({ code: "overheat", message: "상단 설명용 과열 시나리오가 감지되었습니다. 실제 안전 판정이 아닙니다.", layer: "top" });
  if (scenario === "layer_variance" && intensity > 0.4) warnings.push({ code: "layer_variance", message: `층간 편차가 ${round(layerSpreadC)} °C로 커진 합성 시나리오입니다.`, layer: "top" });

  return {
    physical: {
      minute: clamp(input.minute, 0, TOTAL_MINUTES),
      segment: scheduled.segment,
      heaterOutputPercent: scheduled.output,
      layerTemperaturesC: { top: round(layers.top), middle: round(layers.middle), bottom: round(layers.bottom) },
      estimatedWareTemperatureC: round((layers.top + layers.middle + layers.bottom) / 3 - (coating === "thick" ? 12 : coating === "thin" ? 6 : 8) * intensity),
      layerSpreadC: round(layerSpreadC),
      sensorReadings,
      warnings,
      sourceType: "synthetic",
      modelVersion: KILN_MODEL_VERSION,
    },
    visual: { sourceType: "synthetic", quantitative: false, label: "설명용 근사", heatLevel: round(intensity, 3), convectionPhase: round((input.minute % 40) / 40, 3) },
  };
}
