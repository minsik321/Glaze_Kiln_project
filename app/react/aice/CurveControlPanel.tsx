import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../lib/api";
import { Alert, AsyncState, DetailDrawer, StatusBadge } from "./ui";
import { buildCurveComparison, CONTROL_PLANS, curveSummary, PRESET_ORDER, simulateController, type ControlDecision, type ControllerRun, type ControllerSample, type CurveRole } from "./curvePlan";
import type { SourcedValue } from "./contract";
import type { CoatingPreset } from "./thicknessView";

const COLORS: Record<CurveRole, string> = { baseline: "#536772", adjusted: "#315f72", actual: "#9a2521", next: "#8a5a00" };

function pointsPath(points: Array<{ minute: number; temperatureC: number }>) {
  return points.map((point) => `${30 + point.minute / 480 * 420},${205 - point.temperatureC / 1250 * 175}`).join(" ");
}

function samplePath(samples: ControllerSample[], field: "plannedC" | "sensorC" | "estimatedWareC") {
  return samples.map((sample) => `${30 + sample.minute / 480 * 420},${205 - sample[field] / 1250 * 175}`).join(" ");
}

export function CurveControlPanel({
  coating,
  approved,
  onApprove,
}: {
  coating: CoatingPreset;
  approved: boolean;
  onApprove: (decision: ControlDecision, samples: ControllerSample[], parameters: Record<string, SourcedValue<number>>) => void;
}) {
  const curves = useMemo(() => buildCurveComparison(coating), [coating]);
  const [visible, setVisible] = useState<Record<CurveRole, boolean>>({ baseline: true, adjusted: true, actual: true, next: true });
  // LLM 프런트도어 TODO Phase 3: 사용자에게는 더 이상 이름 붙은 프리셋을
  // 고르게 하지 않는다 — "다시 추천"을 누를 때마다 내부적으로 다음 외란
  // 시나리오로 순환할 뿐이다.
  const [presetIndex, setPresetIndex] = useState(0);
  const preset = PRESET_ORDER[presetIndex % PRESET_ORDER.length];
  const plan = CONTROL_PLANS[preset];

  // `simulateController`가 이제 kiln.firing을 돌리는 백엔드 호출이라
  // 비동기다. `requestId`로 오래된 요청의 응답이 최신 preset을 덮어쓰지
  // 않게 막는다(다시 추천을 빠르게 여러 번 누르는 경우).
  const [run, setRun] = useState<ControllerRun | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "complete">("loading");
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    setStatus("loading");
    setError(null);
    simulateController(curves[1], preset)
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
  }, [curves, preset]);

  const samples = run?.samples ?? [];
  const alarms = samples.filter((sample) => sample.alarm);
  const toggle = (role: CurveRole) => setVisible((current) => ({ ...current, [role]: !current[role] }));
  const regenerate = () => setPresetIndex((current) => current + 1);

  return (
    <section className="curve-control-panel" aria-labelledby="curve-panel-title">
      <div className="curve-panel-heading"><div><h3 id="curve-panel-title">곡선 보상과 가상 제어 계획</h3><p>네 역할은 모두 같은 0–480분 시간축을 사용합니다.</p></div><StatusBadge tone="unavailable">가상 제어 · 실제 제어 아님</StatusBadge></div>
      <div className="curve-toggle-row" aria-label="곡선 표시 전환">{curves.map((curve) => <label key={curve.role}><input type="checkbox" checked={visible[curve.role]} onChange={() => toggle(curve.role)} /><i style={{ background: COLORS[curve.role] }} />{curve.label}</label>)}</div>
      <svg className="curve-comparison-svg" viewBox="0 0 480 235" role="img" aria-labelledby="curve-title curve-desc">
        <title id="curve-title">기준 계획과 두께 반영 수정 계획 비교 그래프</title><desc id="curve-desc">기준, 수정, 합성 실제, 다음 제안을 켜고 끌 수 있으며 수정 이유가 그래프에 표시됩니다.</desc>
        {[20, 400, 800, 1200].map((temp) => <g key={temp}><line x1="30" x2="450" y1={205 - temp / 1250 * 175} y2={205 - temp / 1250 * 175} /><text x="26" y={209 - temp / 1250 * 175} textAnchor="end">{temp}</text></g>)}
        {curves.map((curve) => visible[curve.role] && <polyline key={curve.role} points={pointsPath(curve.points)} fill="none" stroke={COLORS[curve.role]} strokeWidth={curve.role === "adjusted" ? 4 : 2.5} strokeDasharray={curve.role === "next" ? "7 5" : undefined} />)}
        {visible.adjusted && curves[1].annotation && <g className="curve-annotation"><line x1="328" y1="48" x2="350" y2="72" /><circle cx="350" cy="72" r="4" /><text x="220" y="40">도포 상태 반영 구간</text></g>}
        <text x="30" y="225">0분</text><text x="430" y="225">480분</text>
      </svg>
      <p className="curve-natural-summary">{curveSummary(curves)}</p>

      {status === "loading" && <AsyncState kind="loading" />}
      {status === "error" && <Alert tone="danger" title="가상 제어 계산 오류">{error}</Alert>}
      {status === "complete" && run && (
        <>
          <svg className="controller-svg" viewBox="0 0 480 235" role="img" aria-labelledby="controller-title controller-desc">
            <title id="controller-title">가상 제어기 계획값 센서값 기물 추정값 그래프</title><desc id="controller-desc">kiln.firing 제어기·시뮬레이터의 계획, 센서, 기물 추정과 추종 오차가 같은 시간축에 표시됩니다.</desc>
            {[20, 400, 800, 1200].map((temp) => <line key={temp} x1="30" x2="450" y1={205 - temp / 1250 * 175} y2={205 - temp / 1250 * 175} />)}
            <polyline points={samplePath(samples, "plannedC")} className="pid-plan-line" /><polyline points={samplePath(samples, "sensorC")} className="pid-sensor-line" /><polyline points={samplePath(samples, "estimatedWareC")} className="pid-ware-line" />
            {samples.filter((sample) => sample.alarm).map((sample) => <circle className="pid-alarm-point" key={sample.minute} cx={30 + sample.minute / 480 * 420} cy={205 - sample.sensorC / 1250 * 175} r="5" />)}
            <text x="34" y="23">— 계획  -- 센서  ·· 기물 추정</text><text x="30" y="225">0분</text><text x="430" y="225">480분</text>
          </svg>
          <div className="controller-readouts"><span><b>최대 |추종오차|</b>{Math.max(...samples.map((sample) => Math.abs(sample.errorC)))} °C</span><span><b>최대 히터 출력</b>{Math.max(...samples.map((sample) => sample.heaterPercent))}%</span><span><b>경보</b>{alarms.length}개</span><span><b>샘플 주기</b>{plan.constraints.sampleSeconds}초</span></div>
          {alarms.length ? <Alert tone="warning" title="추종 경보">초기 구간 등에서 추종오차가 크거나 센서 이상이 감지됐습니다. 실제 안전 경보가 아닙니다.</Alert> : <Alert tone="unavailable" title="경보 없음">경보가 없더라도 실제 운전 안전을 뜻하지 않습니다.</Alert>}

          <DetailDrawer summary="왜 바뀌었는지 · 외란 시나리오·포화·원시 로그 보기">
            <p className="curve-change-reason">{curves[1].reason}</p>
            <Alert tone="danger" title="실제 가마 사용 금지">{plan.warning}</Alert>
            <dl className="pid-parameters">{Object.entries(plan.parameters).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value.value} {value.unit} · {value.source_type}</dd></div>)}</dl>
            <p>출력 포화 {plan.constraints.outputMinPercent}–{plan.constraints.outputMaxPercent}% · {plan.constraints.antiWindup} · 적분 주기 {plan.constraints.sampleSeconds}초</p>
            <p className="controller-provenance">{run.eNote}</p>
            <ul className="controller-provenance-notes">{run.provenanceNotes.map((note) => <li key={note}>{note}</li>)}</ul>
            <details><summary>원시 물리 엔진 로그</summary><pre>{JSON.stringify(samples, null, 2)}</pre></details>
          </DetailDrawer>
        </>
      )}

      <div className="curve-control-actions">
        <button type="button" className="act ghost" onClick={regenerate}>다시 추천</button>
        <button type="button" className="prototype-confirm" aria-pressed={approved} disabled={status !== "complete"} onClick={() => onApprove("accepted", samples, plan.parameters)}>{approved ? "가상 제어기 전달 완료" : "이대로 진행"}</button>
      </div>
      <p className="approval-note">승인한 수정 후보만 AiceRun의 선택 곡선과 가상 제어 샘플에 기록됩니다.</p>
    </section>
  );
}
