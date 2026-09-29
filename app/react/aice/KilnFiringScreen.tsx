import { useEffect, useMemo, useRef, useState } from "react";
import type { WarePreset } from "./catalog";
import type { SourcedValue } from "./contract";
import { Alert, AsyncState } from "./ui";
import { sensorPreset, simulateKilnFrame, TOTAL_MINUTES, type KilnScenario, type SensorPlacement, type SensorPlan } from "./kilnSimulation";
import type { CoatingPreset } from "./thicknessView";
import { buildCurveComparison, curveSummary, SCENARIO_CONTROL_PLANS, simulateController, type CurveSeries, type ControlDecision, type ControllerRun, type ControllerSample } from "./curvePlan";
import { ApiError } from "../lib/api";
import { isSupabaseConfigured, requireSupabase } from "../lib/supabase";

/**
 * 구 6/7/8페이지 통합(v9) — 가마 단면·센서, 소성곡선 비교, 가상 제어기,
 * 가상 소성 재생을 하나의 화면으로 합친다. 한 화면이니 재생 시간(minute)
 * 하나를 가마 단면 애니메이션과 곡선 커서가 함께 쓴다. 이상 시나리오를
 * 고르면 "기준 계획"은 그대로 두고 "두께 반영 수정 계획"만 그 외란을
 * 반영해 다시 계산된다(SCENARIO_CONTROL_PLANS, curvePlan.ts) — 실제
 * 물리 코어(kiln.firing.SegmentedController, 전향보상+비례)를 그대로
 * 쓰고, 화면 문구는 "반응형 제어"로만 부른다("PID"라고 부르지 않는다).
 *
 * 센서 배치는 더 이상 회차마다 프리셋 버튼으로 고르지 않는다 — 로그인한
 * 사용자의 계정(profiles.kiln_sensor_plan, AuthPanel.tsx)에서 한 번 읽어
 * 자동으로 구성한다.
 */

const SCENARIOS: Array<{ id: KilnScenario; label: string }> = [
  { id: "normal", label: "기본" },
  { id: "sensor_bias", label: "센서 편향" },
  { id: "sensor_failure", label: "센서 고장" },
  { id: "overheat", label: "상단 과열" },
  { id: "layer_variance", label: "층간 편차" },
];

const WARE_PATHS: Record<WarePreset, string> = {
  bowl: "M-16,-9 Q0,13 16,-9 Q0,-3 -16,-9Z",
  plate: "M-18,-5 Q0,6 18,-5 L16,-1 Q0,10 -16,-1Z",
  mug: "M-12,-13 L11,-13 L9,10 L-10,10Z M11,-8 Q22,-8 18,3 Q14,8 9,5",
  cylinder_vase: "M-10,-16 L10,-16 L11,13 L-11,13Z",
  bottle: "M-5,-17 L5,-17 L6,-8 Q16,-2 13,13 L-13,13 Q-16,-2 -6,-8Z",
  tile: "M-18,-3 L18,-3 L18,4 L-18,4Z",
  other: "M-14,-10 Q0,-17 14,-7 L10,13 L-12,11Z",
};

//: v9 후속(4페이지): 그래프를 하나로 합치면서 curves의 actual/next
//: 역할(합성 삽화)은 더 이상 그리지 않는다 — 대신 실제 반응형 제어 결과
//: (samples.sensorC/estimatedWareC, kiln.firing 물리 코어가 낸 값)를
//: 같은 그래프에 겹쳐 그린다. 그래서 토글은 baseline/adjusted 둘뿐이다.
const CURVE_COLORS: Record<"baseline" | "adjusted", string> = { baseline: "#536772", adjusted: "#315f72" };

function pointsPath(points: Array<{ minute: number; temperatureC: number }>) {
  return points.map((point) => `${30 + point.minute / 480 * 420},${205 - point.temperatureC / 1250 * 175}`).join(" ");
}

function samplePath(samples: ControllerSample[], field: "plannedC" | "sensorC" | "estimatedWareC") {
  return samples.map((sample) => `${30 + sample.minute / 480 * 420},${205 - sample[field] / 1250 * 175}`).join(" ");
}

function temperatureAtMinute(points: Array<{ minute: number; temperatureC: number }>, minute: number) {
  const nextIndex = points.findIndex((point) => point.minute >= minute);
  if (nextIndex <= 0) return points[Math.max(0, nextIndex)]?.temperatureC ?? 20;
  const previous = points[nextIndex - 1];
  const next = points[nextIndex];
  const progress = (minute - previous.minute) / Math.max(1, next.minute - previous.minute);
  return previous.temperatureC + (next.temperatureC - previous.temperatureC) * progress;
}

export function KilnFiringScreen({
  ware,
  coating,
  userId,
  sensors,
  onSensorsChange,
  recipeFiringRangeC,
  executionCurves,
  riskMitigationApplied,
  onApprove,
  onSimulationStart,
}: {
  ware: WarePreset;
  coating: CoatingPreset;
  userId?: string;
  sensors: SensorPlacement[];
  onSensorsChange: (sensors: SensorPlacement[]) => void;
  recipeFiringRangeC?: readonly [number, number] | null;
  executionCurves?: CurveSeries[];
  riskMitigationApplied: boolean;
  onApprove: (decision: ControlDecision, samples: ControllerSample[], parameters: Record<string, SourcedValue<number>>) => void;
  simulationCompleted: boolean;
  onSimulationStart: () => void;
}) {
  const [minute, setMinute] = useState(320);
  const [playing, setPlaying] = useState(false);
  const [scenario, setScenario] = useState<KilnScenario>("normal");

  //: 계정 가마 정보(kiln_sensor_plan)에서 센서 배치를 한 번 불러온다 —
  //: 이미 배치가 있으면(복원 등) 다시 부르지 않는다.
  useEffect(() => {
    if (sensors.length) return;
    if (!userId || !isSupabaseConfigured) {
      onSensorsChange(sensorPreset("three"));
      return;
    }
    let active = true;
    void (async () => {
      try {
        const result = await requireSupabase().from("profiles").select("kiln_sensor_plan").eq("id", userId).maybeSingle();
        const plan = (result.data?.kiln_sensor_plan as SensorPlan | undefined) ?? "three";
        if (active) onSensorsChange(sensorPreset(plan));
      } catch {
        if (active) onSensorsChange(sensorPreset("three"));
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, sensors.length, onSensorsChange]);

  const frame = useMemo(() => simulateKilnFrame({ minute, sensors, scenario, coating }), [sensors, coating, minute, scenario]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setMinute((current) => current >= TOTAL_MINUTES ? 0 : Math.min(TOTAL_MINUTES, current + 5)), 350);
    return () => window.clearInterval(timer);
  }, [playing]);

  const heatHue = 210 - frame.visual.heatLevel * 196;

  const curves = useMemo(() => executionCurves ?? buildCurveComparison(coating, recipeFiringRangeC ?? null), [executionCurves, coating, recipeFiringRangeC]);
  //: riskMitigationApplied가 true면(3페이지에서 위험을 줄이는 소성 계획을
  //: 이미 적용했으면) "기준 계획" 대신 "두께 반영 수정 계획"을 기본으로
  //: 강조한다 — 기준 계획 자체는 지워지지 않고 체크박스로 다시 켤 수 있다.
  const [visible, setVisible] = useState<Record<"baseline" | "adjusted", boolean>>({ baseline: !riskMitigationApplied, adjusted: true });
  const [run, setRun] = useState<ControllerRun | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "complete">("loading");
  const [error, setError] = useState<string | null>(null);
  //: 계산 요청이 실패하면(네트워크 순단 등) 시나리오를 바꾸지 않는 한 재시도할
  //: 방법이 없어 "이 계획대로 가마에 적용해서 시작" 버튼이 영구히 눌리지
  //: 않는 문제가 있었다 — retryToken을 바꿔 같은 시나리오로 다시 요청한다.
  const [retryToken, setRetryToken] = useState(0);
  const requestId = useRef(0);
  const onApproveRef = useRef(onApprove);
  onApproveRef.current = onApprove;
  const previousScenario = useRef(scenario);

  //: 이상 시나리오를 고르면 "두께 반영 수정 계획"만 그 외란으로 다시
  //: 계산한다("기준 계획"은 buildCurveComparison이 낸 그대로 고정).
  useEffect(() => {
    const plan = SCENARIO_CONTROL_PLANS[scenario];
    const id = ++requestId.current;
    if (previousScenario.current !== scenario) onApproveRef.current("regenerate", [], {});
    previousScenario.current = scenario;
    setRun(null);
    setPlaying(false);
    setStatus("loading");
    setError(null);
    simulateController(curves[1], plan.disturbance, plan.constraints.sampleSeconds)
      .then((result) => {
        if (requestId.current !== id) return;
        setRun(result);
        setStatus("complete");
      })
      .catch((err) => {
        if (requestId.current !== id) return;
        setError(err instanceof ApiError ? err.message : "가상 제어 계산을 불러오지 못했습니다.");
        setStatus("error");
      });
    return () => { requestId.current++; };
  }, [curves, scenario, retryToken]);

  const samples = run?.samples ?? [];
  const alarms = samples.filter((sample) => sample.alarm);
  const toggle = (role: "baseline" | "adjusted") => setVisible((current) => ({ ...current, [role]: !current[role] }));
  const plan = SCENARIO_CONTROL_PLANS[scenario];
  const cursorX = 30 + minute / 480 * 420;
  const fireTemperatureC = temperatureAtMinute(curves[1].points, minute);
  const fireY = 205 - fireTemperatureC / 1250 * 175;

  //: v9 후속(4페이지): "이대로 진행" 승인 버튼을 따로 두지 않는다 — 가상
  //: 소성을 재생하는 것 자체가 곧 이 계획을 가마에 적용해 시작하는
  //: 행동이다. 아직 반응형 제어 계산이 끝나지 않았으면(status !==
  //: "complete") 재생을 시작할 수 없다.
  const playFiring = () => {
    if (status !== "complete") return;
    setPlaying(true);
    onSimulationStart();
    onApprove("accepted", samples, plan.parameters);
  };

  return (
    <section className="kiln-firing-screen" aria-labelledby="kiln-firing-heading">
      <div className="kiln-section-summary">
        <div><h3 id="kiln-firing-heading">소성 시뮬레이션</h3><p>시간에 따른 온도 변화와 가마 내부 상태를 확인해요.</p></div>
        <button
          type="button"
          className="kiln-play-toggle"
          aria-label={playing ? "소성 시뮬레이션 일시정지" : "소성 시뮬레이션 재생"}
          aria-pressed={playing}
          disabled={!playing && status !== "complete"}
          onClick={() => (playing ? setPlaying(false) : playFiring())}
        >
          {playing
            ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12" /></svg>
            : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z" /></svg>}
        </button>
      </div>

      <div className="kiln-readouts kiln-readouts-top" aria-live="polite">
        <span><b>센서 대표값</b>{frame.physical.sensorReadings.find((reading) => reading.temperatureC !== null)?.temperatureC ?? "-"}<small>°C</small></span>
        <span><b>기물 추정</b>{frame.physical.estimatedWareTemperatureC}<small>°C</small></span>
        <span><b>층별 편차</b>{frame.physical.layerSpreadC}<small>°C</small></span>
        <span><b>히터 출력</b>{frame.physical.heaterOutputPercent}<small>%</small></span>
      </div>

      <div className="simulation-clock" aria-live="polite"><span aria-hidden="true">🔥</span><strong>가상 시간 {minute}분</strong><small>{frame.physical.segment}</small></div>
      <div className="curve-toggle-row" aria-label="곡선 표시 전환">
        {(["baseline", "adjusted"] as const).map((role) => {
          const curve = curves.find((item) => item.role === role)!;
          return <label key={role}><input type="checkbox" checked={visible[role]} onChange={() => toggle(role)} /><i style={{ background: CURVE_COLORS[role] }} />{curve.label}</label>;
        })}
      </div>
      <svg className="curve-comparison-svg" viewBox="0 0 480 235" role="img" aria-labelledby="curve-title curve-desc">
        <title id="curve-title">소성 계획과 실제 값 비교 그래프</title><desc id="curve-desc">기준 계획, 두께 반영 수정 계획, 실제 값(관측)과 기물 추정이 같은 시간축에 표시되며 가마 단면과 같은 재생 시간이 커서로 표시됩니다.</desc>
        {[20, 400, 800, 1200].map((temp) => <g key={temp}><line x1="30" x2="450" y1={205 - temp / 1250 * 175} y2={205 - temp / 1250 * 175} /><text x="26" y={209 - temp / 1250 * 175} textAnchor="end">{temp}</text></g>)}
        {(["baseline", "adjusted"] as const).map((role) => {
          const curve = curves.find((item) => item.role === role)!;
          return visible[role] && <polyline key={role} points={pointsPath(curve.points)} fill="none" stroke={CURVE_COLORS[role]} strokeWidth={role === "adjusted" ? 4 : 2.5} />;
        })}
        {visible.adjusted && curves[1].annotation && <g className="curve-annotation"><line x1="328" y1="48" x2="350" y2="72" /><circle cx="350" cy="72" r="4" /><text x="220" y="40">도포 상태 반영 구간</text></g>}
        {status === "complete" && samples.length > 0 && (
          <>
            <polyline points={samplePath(samples, "sensorC")} className="pid-sensor-line" />
            <polyline points={samplePath(samples, "estimatedWareC")} className="pid-ware-line" />
            {samples.filter((sample) => sample.alarm).map((sample) => <circle className="pid-alarm-point" key={sample.minute} cx={30 + sample.minute / 480 * 420} cy={205 - sample.sensorC / 1250 * 175} r="5" />)}
          </>
        )}
        <line className="kiln-time-cursor" x1={cursorX} x2={cursorX} y1="20" y2="210" />
        <g className="kiln-fire-cursor" style={{ transform: `translate(${cursorX}px, ${fireY}px)` }} aria-hidden="true"><text x="0" y="0">🔥</text></g>
        <text x="34" y="23">굵은 선 실제 값 · 가는 점선 기물 추정</text>
        <text x="30" y="225">0분</text><text x="430" y="225">480분</text>
      </svg>
      <p className="curve-natural-summary">{curveSummary(curves)}</p>

      {status === "loading" && <AsyncState kind="loading" />}
      {status === "error" && (
        <Alert tone="danger" title="가상 제어 계산 오류">
          {error} <button type="button" className="choice-chip" onClick={() => setRetryToken((current) => current + 1)}>다시 시도</button>
        </Alert>
      )}

      <div className="kiln-time-control"><label htmlFor="kiln-time">가상 시간 이동</label><input id="kiln-time" type="range" min="0" max={TOTAL_MINUTES} step="5" value={minute} onChange={(event) => setMinute(Number(event.target.value))} /></div>

      <div className="kiln-layout">
        <div>
          <svg className="kiln-section-svg" viewBox="0 0 360 450" role="img" aria-labelledby="kiln-svg-title kiln-svg-desc">
            <title id="kiln-svg-title">가상 전기가마 종단면 — 선반, 열선, 단열벽, 뚜껑, 배기와 센서</title>
            <desc id="kiln-svg-desc">이상 시나리오를 바꾸면 같은 적재에서 합성 관측 온도와 불확실도가 달라집니다.</desc>
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
            {sensors.map((sensor, index) => {
              const y = 370 - sensor.heightRatio * 280;
              const reading = frame.physical.sensorReadings[index];
              const highlighted = reading?.status !== "ok" || frame.physical.warnings.some((warning) => warning.sensorId === sensor.id);
              return <g key={sensor.id} className={`kiln-sensor-node ${highlighted ? "highlight" : ""}`} transform={`translate(268 ${y})`}><line x1="0" x2="-38" /><circle cx="-43" r="7" /><text x="-55" y="-10" textAnchor="end">{sensor.id}</text></g>;
            })}
            {frame.physical.warnings.some((warning) => warning.layer === "top") && <rect className="kiln-warning-zone" x="84" y="68" width="192" height="98" />}
            <text x="180" y="427" textAnchor="middle">단열벽 · 열선은 합성 시각화</text>
          </svg>
          <div className="kiln-legend" aria-label="가마 단면 범례"><span><i className="legend-heater" />열선</span><span><i className="legend-shelf" />선반</span><span><i className="legend-sensor" />센서</span><span><i className="legend-flow" />대류 흐름(설명용)</span></div>
        </div>
      </div>

      <fieldset className="scenario-controls"><legend>이상 시나리오</legend><div className="choice-chip-row">{SCENARIOS.map((item) => <button type="button" className="choice-chip" key={item.id} aria-pressed={scenario === item.id} onClick={() => setScenario(item.id)}>{item.label}</button>)}</div></fieldset>
      <div className="kiln-warning-timeline" aria-live="polite">{frame.physical.warnings.length ? frame.physical.warnings.map((warning) => <Alert key={`${warning.code}-${warning.sensorId ?? warning.layer}`} tone="danger" title="가상 경고">{warning.message}</Alert>) : <Alert tone="unavailable" title="가상 경고 없음">현재 선택한 합성 시나리오에는 경고가 없습니다.</Alert>}</div>
      {riskMitigationApplied && <p className="kiln-plan-note">두께 위험을 줄이는 수정 소성 플랜이 반영되었습니다.</p>}
    </section>
  );
}
