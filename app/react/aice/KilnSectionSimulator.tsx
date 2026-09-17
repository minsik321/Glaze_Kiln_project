import { useEffect, useMemo, useState } from "react";
import type { WarePreset } from "./catalog";
import { Alert, DetailDrawer, StatusBadge } from "./ui";
import { moveSensor, recommendSensorPlan, sensorPreset, simulateKilnFrame, TOTAL_MINUTES, type KilnScenario, type SensorPlacement, type SensorPlan } from "./kilnSimulation";
import type { CoatingPreset } from "./thicknessView";

const SCENARIOS: Array<{ id: KilnScenario; label: string }> = [
  { id: "normal", label: "기본" },
  { id: "sensor_bias", label: "센서 편향" },
  { id: "sensor_failure", label: "센서 고장" },
  { id: "overheat", label: "상단 과열" },
  { id: "layer_variance", label: "층간 편차" },
];

const SEGMENTS = [
  { label: "예열", minute: 30 },
  { label: "승온", minute: 210 },
  { label: "유지", minute: 380 },
  { label: "냉각", minute: 440 },
] as const;

const WARE_PATHS: Record<WarePreset, string> = {
  bowl: "M-16,-9 Q0,13 16,-9 Q0,-3 -16,-9Z",
  plate: "M-18,-5 Q0,6 18,-5 L16,-1 Q0,10 -16,-1Z",
  mug: "M-12,-13 L11,-13 L9,10 L-10,10Z M11,-8 Q22,-8 18,3 Q14,8 9,5",
  cylinder_vase: "M-10,-16 L10,-16 L11,13 L-11,13Z",
  bottle: "M-5,-17 L5,-17 L6,-8 Q16,-2 13,13 L-13,13 Q-16,-2 -6,-8Z",
  tile: "M-18,-3 L18,-3 L18,4 L-18,4Z",
  other: "M-14,-10 Q0,-17 14,-7 L10,13 L-12,11Z",
};

export function KilnSectionSimulator({
  ware,
  coating,
  plan,
  sensors,
  onPlanChange,
  onSensorsChange,
}: {
  ware: WarePreset;
  coating: CoatingPreset;
  plan?: SensorPlan;
  sensors: SensorPlacement[];
  onPlanChange: (plan: SensorPlan) => void;
  onSensorsChange: (sensors: SensorPlacement[]) => void;
}) {
  const [minute, setMinute] = useState(320);
  const [playing, setPlaying] = useState(false);
  const [scenario, setScenario] = useState<KilnScenario>("normal");
  const activeSensors = sensors.length ? sensors : sensorPreset(plan ?? "three");
  const frame = useMemo(() => simulateKilnFrame({ minute, sensors: activeSensors, scenario, coating }), [activeSensors, coating, minute, scenario]);
  const recommendation = recommendSensorPlan(6, "medium");

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setMinute((current) => current >= TOTAL_MINUTES ? 0 : Math.min(TOTAL_MINUTES, current + 5)), 350);
    return () => window.clearInterval(timer);
  }, [playing]);

  const choosePlan = (nextPlan: SensorPlan) => {
    onPlanChange(nextPlan);
    onSensorsChange(sensorPreset(nextPlan));
  };
  const adjust = (id: string, delta: number) => onSensorsChange(moveSensor(activeSensors, id, delta));
  const heatHue = 210 - frame.visual.heatLevel * 196;

  return (
    <section className="kiln-simulator" aria-labelledby="kiln-section-heading">
      <div className="kiln-section-summary">
        <div><h3 id="kiln-section-heading">가상 전기가마 세로 종단면</h3><p>선반 3단 · 선택 기물 6개 · 중간 크기 가마</p></div>
        <StatusBadge tone="unavailable">합성 · 설명용 근사</StatusBadge>
      </div>

      <div className="kiln-layout">
        <div>
          <svg className="kiln-section-svg" viewBox="0 0 360 450" role="img" aria-labelledby="kiln-svg-title kiln-svg-desc">
            <title id="kiln-svg-title">가상 전기가마 종단면 — 선반, 열선, 단열벽, 뚜껑, 배기와 센서</title>
            <desc id="kiln-svg-desc">센서 버튼으로 높이를 바꾸면 같은 적재에서 합성 관측 온도와 불확실도가 달라집니다.</desc>
            <defs>
              <linearGradient id="kiln-heat" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor={`hsl(${heatHue + 18} 62% 82%)`} /><stop offset="1" stopColor={`hsl(${heatHue} 82% 56%)`} /></linearGradient>
              <pattern id="insulation" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 10L10 0" stroke="currentColor" opacity=".2" /></pattern>
            </defs>
            <path className="kiln-insulation" d="M55 405V75Q55 35 95 35H265Q305 35 305 75V405H55Z" />
            <path className="kiln-lid" d="M70 62Q78 22 110 20H250Q282 22 290 62Z" /><text x="180" y="17" textAnchor="middle">뚜껑</text>
            <rect className="kiln-chamber" x="82" y="66" width="196" height="323" rx="6" fill="url(#kiln-heat)" />
            <path className="kiln-door" d="M278 88H304V370H278" /><text x="312" y="225" transform="rotate(90 312 225)">문</text>
            <path className="kiln-exhaust" d="M230 35V10H266V35" /><text x="274" y="12">배기</text>
            {[118, 218, 318].map((y) => <g key={y}><line className="kiln-shelf-line" x1="91" x2="269" y1={y} y2={y} /><text x="88" y={y - 6} textAnchor="end">선반</text></g>)}
            {[95, 151, 195, 251, 295, 351].map((y) => <path key={y} className="kiln-heater" d={`M86 ${y}q10 -8 20 0t20 0t20 0`} />)}
            {[{ x: 145, y: 100 }, { x: 215, y: 100 }, { x: 145, y: 200 }, { x: 215, y: 200 }, { x: 145, y: 300 }, { x: 215, y: 300 }].map((spot, index) => <path key={index} className="kiln-ware" transform={`translate(${spot.x} ${spot.y}) scale(.72)`} d={WARE_PATHS[ware]} />)}
            {[0, 1, 2].map((i) => <path key={i} className="kiln-flow" style={{ animationDelay: `${i * -.8}s` }} d={`M${125 + i * 50} 350 C${100 + i * 60} 290 ${155 + i * 25} 220 ${125 + i * 50} 145 C${105 + i * 55} 110 ${145 + i * 28} 88 ${125 + i * 50} 72`} />)}
            {activeSensors.map((sensor, index) => {
              const y = 370 - sensor.heightRatio * 280;
              const reading = frame.physical.sensorReadings[index];
              const highlighted = reading.status !== "ok" || frame.physical.warnings.some((warning) => warning.sensorId === sensor.id);
              return <g key={sensor.id} className={`kiln-sensor-node ${highlighted ? "highlight" : ""}`} transform={`translate(268 ${y})`}><line x1="0" x2="-38" /><circle cx="-43" r="7" /><text x="-55" y="-10" textAnchor="end">{sensor.id}</text></g>;
            })}
            {frame.physical.warnings.some((warning) => warning.layer === "top") && <rect className="kiln-warning-zone" x="84" y="68" width="192" height="98" />}
            <text x="180" y="427" textAnchor="middle">단열벽 · 열선은 합성 시각화</text>
          </svg>
          <div className="kiln-legend" aria-label="가마 단면 범례"><span><i className="legend-heater" />열선</span><span><i className="legend-shelf" />선반</span><span><i className="legend-sensor" />센서</span><span><i className="legend-flow" />대류 흐름(설명용)</span></div>
        </div>

        <div className="kiln-controls">
          <fieldset><legend>센서 프리셋</legend><div className="choice-chip-row">{(["single", "three", "multi"] as const).map((item) => <button type="button" className="choice-chip" key={item} aria-pressed={plan === item} onClick={() => choosePlan(item)}>{item === "single" ? "기본 1개" : item === "three" ? "상·중·하 3개" : "다점 측정"}</button>)}</div></fieldset>
          <p className="sensor-recommendation-badge">추천: 상·중·하 3개</p>
          <fieldset><legend>센서 위치 조정</legend><div className="sensor-adjust-list">{activeSensors.map((sensor, index) => <div key={sensor.id}><span>{sensor.id} · 높이 {Math.round(sensor.heightRatio * 100)}%</span><span><button type="button" aria-label={`${sensor.id} 아래로`} onClick={() => adjust(sensor.id, -.08)}>↓</button><button type="button" aria-label={`${sensor.id} 위로`} onClick={() => adjust(sensor.id, .08)}>↑</button></span><small>{frame.physical.sensorReadings[index]?.temperatureC == null ? "신호 없음" : `${frame.physical.sensorReadings[index].temperatureC} °C`} · 불확실성 ±{frame.physical.sensorReadings[index]?.uncertaintyC} °C</small></div>)}</div></fieldset>
        </div>
      </div>

      <div className="kiln-timeline">
        <div className="timeline-actions"><button type="button" className="prototype-confirm" aria-pressed={playing} onClick={() => setPlaying((value) => !value)}>{playing ? "일시정지" : "시간 재생"}</button>{SEGMENTS.map((segment) => <button type="button" className="choice-chip" key={segment.label} onClick={() => setMinute(segment.minute)}>{segment.label}</button>)}</div>
        <label htmlFor="kiln-time">가상 시간 {minute}분 · {frame.physical.segment}</label><input id="kiln-time" type="range" min="0" max={TOTAL_MINUTES} step="5" value={minute} onChange={(event) => setMinute(Number(event.target.value))} />
        <div className="kiln-readouts" aria-live="polite"><span><b>센서 대표값</b>{frame.physical.sensorReadings.find((reading) => reading.temperatureC !== null)?.temperatureC ?? "판정 불가"} °C</span><span><b>기물 추정</b>{frame.physical.estimatedWareTemperatureC} °C</span><span><b>층별 편차</b>{frame.physical.layerSpreadC} °C</span><span><b>히터 출력</b>{frame.physical.heaterOutputPercent}%</span></div>
      </div>

      <fieldset className="scenario-controls"><legend>설명용 이상 시나리오</legend><div className="choice-chip-row">{SCENARIOS.map((item) => <button type="button" className="choice-chip" key={item.id} aria-pressed={scenario === item.id} onClick={() => setScenario(item.id)}>{item.label}</button>)}</div></fieldset>
      <div className="kiln-warning-timeline" aria-live="polite">{frame.physical.warnings.length ? frame.physical.warnings.map((warning) => <Alert key={`${warning.code}-${warning.sensorId ?? warning.layer}`} tone="danger" title="가상 경고">{warning.message}</Alert>) : <Alert tone="unavailable" title="가상 경고 없음">현재 선택한 합성 시나리오에는 경고가 없습니다.</Alert>}</div>

      <DetailDrawer summary="센서 대표성과 모델 상세 보기">
        <p className="sensor-recommendation-reason"><strong>추천 사유</strong>: {recommendation.reason}</p>
        {activeSensors.map((sensor) => <p key={sensor.id}><strong>{sensor.id}</strong> — 대상: {sensor.target} · 사각지대: {sensor.blindSpot} · 한계: {sensor.limitation}</p>)}
        <p><strong>물리 데이터</strong>: 합성 스케줄·층별 온도·센서 응답, 모델 {frame.physical.modelVersion}</p>
        <p><strong>시각 효과</strong>: 냉색→온색과 흐름선은 물리값과 분리된 비정량적 설명용 근사입니다. CFD 결과가 아닙니다.</p>
      </DetailDrawer>
    </section>
  );
}
