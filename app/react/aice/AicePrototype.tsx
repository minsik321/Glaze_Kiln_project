import { useEffect, useMemo, useState } from "react";
import type { SimulatorProps, SimulatorSnapshot } from "./snapshot";
import { Alert, DetailDrawer, ExplanationPanel, ProgressHeader, StatusBadge } from "./ui";
import { sampleAiceRun, type RecipeCandidate, type SourcedValue } from "./contract";
import { CLAY_BODIES, RECIPE_CANDIDATES, SOURCE_LABELS, WARE_CATALOG, type RecipeId, type WarePreset } from "./catalog";
import { ThicknessSection } from "./ThicknessSection";
import { DensityCheck } from "./DensityCheck";
import { WeightInputs } from "./WeightInputs";
import { computeArealDensity } from "./arealDensity";
import { buildThicknessView, type CoatingPreset } from "./thicknessView";
import { KilnSectionSimulator } from "./KilnSectionSimulator";
import { sensorPreset, simulateKilnFrame, type SensorPlacement, type SensorPlan } from "./kilnSimulation";
import { CurveControlPanel } from "./CurveControlPanel";
import { buildCurveComparison, CONTROL_PLANS, simulateController, toFiringCurve, type ControllerSample } from "./curvePlan";
import { parseFiringRangeC, predictNextRun, PREDICTOR_VERSION } from "./predictionModel";
import { RecommendationEvidence } from "./RecommendationEvidence";
import { AI_RULE_VERSION } from "./aiMvp";
import { ResultFeedback } from "./ResultFeedback";
import type { ResultEvaluation } from "./feedback";
import { RecipeChatScreen } from "./RecipeChatScreen";

type Goal = "satin-blue" | "clear-warm" | "matte-white";

type PrototypeState = {
  goal?: Goal;
  recipe?: string;
  llmCandidate?: RecipeCandidate;
  intakePrompt?: string;
  intakeCandidates: RecipeCandidate[];
  ware?: WarePreset;
  clayBody?: (typeof CLAY_BODIES)[number]["id"];
  customWareNote: string;
  customSilhouette: "round" | "tall" | "flat";
  coating?: CoatingPreset;
  coatingConfirmed: boolean;
  sensorPlan?: SensorPlan;
  sensors: SensorPlacement[];
  //: LLM 프런트도어 TODO Phase 3 — 시유 전/후 무게(§5-a). 문자열로 들고
  //: 있다가 계산 시점에 숫자로 바꾼다(빈 입력을 구분하기 위해).
  beforeWeightG: string;
  afterWeightG: string;
  curveApproved: boolean;
  // LLM 프런트도어 TODO Phase 3: 승인 시점에 CurveControlPanel이 실제로
  // 사용한 합성 게인·샘플을 그대로 받아 기록한다 — 이름 붙은 프리셋을 부모가
  // 다시 고르지 않는다(§2-1 참고).
  approvedControlSamples: ControllerSample[];
  approvedControlParameters: Record<string, SourcedValue<number>>;
  simulationCompleted: boolean;
  result?: "close" | "different";
  evaluation: ResultEvaluation;
};

const initialState: PrototypeState = {
  customWareNote: "",
  customSilhouette: "round",
  beforeWeightG: "",
  afterWeightG: "",
  coatingConfirmed: false,
  curveApproved: false,
  approvedControlSamples: [],
  approvedControlParameters: {},
  simulationCompleted: false,
  sensors: [],
  intakeCandidates: [],
  evaluation: { match: null, color: null, gloss: null, texture: null, transparency: null, defects: [], scope: "personal" },
};

const screens = [
  "AI 제안",
  "결과",
  "레시피",
  "기물",
  "도포",
  "적재",
  "곡선",
  "가상 소성",
  "평가",
] as const;

const screenTitles = [
  ["원하는 유약을 설명해 주세요", "AI 제안을 화학 규칙으로 검증한 뒤 후보를 보여줍니다."],
  ["원하는 모습을 골라주세요", "정확한 수치 대신 가장 가까운 결과를 선택합니다."],
  ["근거가 있는 후보를 비교해요", "결과를 보장하지 않는 참고 후보입니다."],
  ["자주 쓰는 기물에서 골라요", "대표 형상을 사용한 추정임을 계속 표시합니다."],
  ["도포 상태를 단면으로 확인해요", "위치별 모습은 형상 기반 가상 분포입니다."],
  ["기물과 센서 위치를 확인해요", "센서 배치는 관측 범위와 불확실성에 영향을 줍니다."],
  ["보정 후보와 제어 계획을 확인해요", "선택한 후보만 가상 제어기로 전달됩니다."],
  ["가상 소성을 재생해요", "실제 가마에는 어떤 신호도 보내지 않습니다."],
  ["결과를 남기고 다음 제안을 봐요", "개인 보정과 공통 개선 후보는 분리합니다."],
] as const;

function ChoiceCard({
  title,
  description,
  selected,
  onClick,
  visual,
}: {
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  visual: string;
}) {
  return (
    <button
      type="button"
      className="prototype-choice"
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className={`prototype-visual ${visual}`} aria-hidden="true" />
      <strong>{title}</strong>
      <span>{description}</span>
    </button>
  );
}

// LLM 프런트도어 TODO Phase 3: "왜/가정/다음행동" 3줄은 상시 노출 설명문이었다
// (§2-2). 근거 배지(StatusBadge)는 그대로 화면에 남기고, 문장형 설명만
// 기본으로 접힌 DetailDrawer 안으로 옮긴다 — 지우지 않는 이유는 출처·가정을
// 찾아볼 수 있어야 하기 때문이다.
function Guidance({ reason, assumption, next }: { reason: string; assumption: string; next: string }) {
  return (
    <DetailDrawer summary="왜 · 무엇을 가정 · 다음 행동 보기">
      <ExplanationPanel reason={reason} assumption={assumption} next={next} />
    </DetailDrawer>
  );
}

export function AicePrototype({ onSnapshotReady, restoredRun, token = "" }: SimulatorProps & { restoredRun?: ReturnType<typeof sampleAiceRun>; token?: string }) {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<PrototypeState>(initialState);
  const arealDensity = computeArealDensity(Number(state.beforeWeightG), Number(state.afterWeightG), state.ware ?? "bowl");

  const snapshot = useMemo<SimulatorSnapshot>(() => {
    const run = restoredRun ?? sampleAiceRun();
    const goal = state.goal === "clear-warm"
      ? { gloss: "gloss" as const, transparency: "transparent" as const, color: "#c7aa7d", texture: "smooth" }
      : state.goal === "matte-white"
        ? { gloss: "matte" as const, transparency: "opaque" as const, color: "#e7e5de", texture: "soft" }
        : run.goal;
    const thicknessView = buildThicknessView({ ware: state.ware ?? "bowl", coating: state.coating ?? "target", evidence: "mass_only", meanMm: null });
    const sensorPlan = state.sensorPlan ?? "three";
    const sensors = state.sensors.length ? state.sensors : sensorPreset(sensorPlan);
    const kilnFrame = simulateKilnFrame({ minute: 320, sensors, coating: state.coating ?? "target" });
    const selectedRecipe = RECIPE_CANDIDATES.find((item) => item.id === state.recipe);
    const llmRange = state.llmCandidate?.predicted_firing_range.value;
    const prediction = predictNextRun({
      coating: state.coating ?? "target",
      ware: state.ware ?? "bowl",
      recipeFiringRangeC: selectedRecipe ? parseFiringRangeC(selectedRecipe.firingRange) : null,
      //: 화면 흐름에는 아직 과거 실행 이력을 세지 않는다 — 0회로 고정한
      //: 초안. Phase 5(학습 루프)에서 실제 이력 카운트를 연결한다.
      priorRunCount: 0,
    });
    const curveSeries = buildCurveComparison(state.coating ?? "target", prediction.holdDeltaC, prediction.reason);
    const adjustedCurve = curveSeries.find((curve) => curve.role === "adjusted")!;
    const controlSamples = state.curveApproved ? state.approvedControlSamples : [];
    const controlParameters = state.curveApproved ? state.approvedControlParameters : {};
    return {
      ...run,
      status: state.result ? "evaluated" : state.simulationCompleted ? "simulated" : "draft",
      revision: step + 1,
      goal,
      recipe: state.llmCandidate ? {
        ...run.recipe,
        id: state.llmCandidate.id,
        name: state.llmCandidate.name,
        photo: state.llmCandidate.photo,
        firing_range: llmRange?.[0] != null && llmRange[1] != null
          ? { ...state.llmCandidate.predicted_firing_range, value: [llmRange[0], llmRange[1]] as [number, number] }
          : run.recipe.firing_range,
        source_ids: state.llmCandidate.source_ids,
      } : { ...run.recipe, id: state.recipe ?? run.recipe.id, name: selectedRecipe?.name ?? run.recipe.name },
      ware: { ...run.ware, preset: state.ware ?? run.ware.preset, clay_body: state.clayBody ?? run.ware.clay_body },
      loading: {
        ...run.loading,
        sensor_plan: sensorPlan,
        sensors: sensors.map((sensor, index) => ({
          id: sensor.id,
          height_ratio: sensor.heightRatio,
          temperature: { value: kilnFrame.physical.sensorReadings[index]?.temperatureC ?? null, unit: "°C", source_type: "synthetic" as const, confidence: null, note: `설명용 합성 모델 ${kilnFrame.physical.modelVersion}; 불확실성 ±${kilnFrame.physical.sensorReadings[index]?.uncertaintyC ?? "판정 불가"} °C` },
        })),
      },
      application: {
        ...run.application,
        before_weight: state.beforeWeightG.trim() ? { value: Number(state.beforeWeightG), unit: "g", source_type: "observed", confidence: 1, note: "사용자 입력" } : run.application.before_weight,
        after_weight: state.afterWeightG.trim() ? { value: Number(state.afterWeightG), unit: "g", source_type: "observed", confidence: 1, note: "사용자 입력" } : run.application.after_weight,
      },
      thickness: {
        ...run.thickness,
        warning: `${run.thickness.warning} · ${thicknessView.risk}`,
        areal_density: arealDensity ? { value: arealDensity.gramsPerM2, unit: "g/m²", source_type: "inferred", confidence: .5, note: "대표 형상 면적 가정 — 실측 면적 아님" } : run.thickness.areal_density,
      },
      curves: { baseline: toFiringCurve(curveSeries[0], false), candidates: curveSeries.slice(1).map((curve) => toFiringCurve(curve, state.curveApproved && curve.role === "adjusted")), selected_id: state.curveApproved ? adjustedCurve.id : null },
      pid: {
        decision: "accepted",
        controller_kind: "pid",
        parameters: controlParameters,
        samples: controlSamples.map((sample) => ({ minute: sample.minute, planned_c: sample.plannedC, sensor_c: sample.sensorC, estimated_ware_c: sample.estimatedWareC, heater_percent: sample.heaterPercent })),
        alarms: controlSamples.filter((sample) => sample.alarm).map((sample) => `${sample.minute}분: ${sample.alarm}`),
      },
      versions: { ...run.versions, rule_model: AI_RULE_VERSION, simulator: "aice-kiln-explanatory-1", predictor: PREDICTOR_VERSION },
      intake: state.intakePrompt ? {
        prompt_text: state.intakePrompt,
        prompt_photos: [],
        candidates: { candidates: state.intakeCandidates, selected_id: state.llmCandidate?.id ?? null },
      } : run.intake,
      result: {
        ...run.result,
        color: state.evaluation.color,
        gloss: state.evaluation.gloss,
        texture: state.evaluation.texture,
        transparency: state.evaluation.transparency,
        defects: state.evaluation.defects,
        feedback_scope: state.result ? state.evaluation.scope : null,
      },
    };
  }, [restoredRun, state, step]);

  useEffect(() => {
    if (!restoredRun) return;
    const knownRecipe = RECIPE_CANDIDATES.some((candidate) => candidate.id === restoredRun.recipe.id) ? restoredRun.recipe.id as RecipeId : restoredRun.recipe.id;
    const knownClay = CLAY_BODIES.some((body) => body.id === restoredRun.ware.clay_body) ? restoredRun.ware.clay_body as PrototypeState["clayBody"] : undefined;
    const curveApproved = Boolean(restoredRun.curves.selected_id);
    // 복원된 기록에는 승인 당시 내부적으로 어떤 합성 게인 세트가 쓰였는지
    // 이름이 남아있지 않는다(사용자에게 애초에 노출하지 않으므로) — 기본
    // 게인으로 다시 계산해 채운다.
    let approvedControlSamples: ControllerSample[] = [];
    let approvedControlParameters: Record<string, SourcedValue<number>> = {};
    if (curveApproved) {
      const curveSeries = buildCurveComparison("target");
      const adjustedCurve = curveSeries.find((curve) => curve.role === "adjusted")!;
      approvedControlSamples = simulateController(adjustedCurve, "balanced");
      approvedControlParameters = CONTROL_PLANS.balanced.parameters;
    }
    setState({ ...initialState, goal: restoredRun.goal.transparency === "transparent" ? "clear-warm" : restoredRun.goal.gloss === "matte" ? "matte-white" : "satin-blue", recipe: knownRecipe, ware: restoredRun.ware.preset, clayBody: knownClay, coating: "target", coatingConfirmed: true, sensorPlan: restoredRun.loading.sensor_plan, sensors: restoredRun.loading.sensors.map((sensor) => ({ id: sensor.id, heightRatio: sensor.height_ratio, target: "복원된 센서 주변", blindSpot: "복원 기록에 상세 없음", limitation: sensor.temperature.note })), curveApproved, approvedControlSamples, approvedControlParameters, simulationCompleted: restoredRun.status !== "draft", result: restoredRun.status === "evaluated" ? "close" : undefined, evaluation: { ...initialState.evaluation, match: restoredRun.status === "evaluated" ? "close" : null, defects: restoredRun.result.defects, scope: restoredRun.result.feedback_scope ?? "personal" } });
    setStep(restoredRun.status === "evaluated" ? 8 : restoredRun.status === "simulated" ? 7 : 0);
  }, [restoredRun]);

  useEffect(() => {
    onSnapshotReady?.(async () => snapshot);
  }, [onSnapshotReady, snapshot]);

  const next = () => setStep((current) => Math.min(current + 1, screens.length - 1));
  const restart = () => {
    setState(initialState);
    setStep(0);
  };
  const canContinue = [
    true,
    Boolean(state.goal),
    Boolean(state.recipe),
    Boolean(state.ware && state.clayBody && (state.ware !== "other" || state.customWareNote.trim())),
    Boolean(state.coating && state.coatingConfirmed),
    Boolean(state.sensorPlan),
    state.curveApproved,
    state.simulationCompleted,
  ][step] ?? false;

  return (
    <div className="prototype-shell">
      <header className="prototype-header">
        <div>
          <span className="eyebrow">AICE KILN</span>
          <h1>안내형 가상 실험</h1>
        </div>
        <StatusBadge tone="unavailable">데모 · 시뮬레이션 전용</StatusBadge>
      </header>
      <ProgressHeader current={step + 1} total={screens.length} labels={screens} />

      <main className="prototype-main" data-testid={`aice-step-${step + 1}`}>
        <div className="screen-intro">
          <span className="eyebrow">STEP {String(step + 1).padStart(2, "0")}</span>
          <h2>{screenTitles[step][0]}</h2>
          <p>{screenTitles[step][1]}</p>
        </div>

        {step === 0 && (
          <section className="prototype-home">
            {!token && <Alert tone="unavailable" title="로그인이 필요해요">계정 화면에서 로그인하면 AI 레시피 후보를 요청할 수 있습니다.</Alert>}
            <RecipeChatScreen
              token={token}
              disabled={!token}
              onSelect={(candidate) => setState((current) => ({
                ...current,
                recipe: candidate.id,
                llmCandidate: candidate,
              }))}
              onIntake={(promptText, candidates) => setState((current) => ({
                ...current,
                intakePrompt: promptText,
                intakeCandidates: candidates,
              }))}
            />
          </section>
        )}

        {step === 1 && (
          <div className="prototype-grid">
            <ChoiceCard title="사틴 청색" description="은은한 광택 · 불투명" visual="swatch-blue" selected={state.goal === "satin-blue"} onClick={() => setState({ ...state, goal: "satin-blue" })} />
            <ChoiceCard title="따뜻한 투명" description="유광 · 투명" visual="swatch-clear" selected={state.goal === "clear-warm"} onClick={() => setState({ ...state, goal: "clear-warm" })} />
            <ChoiceCard title="부드러운 백색" description="무광 · 불투명" visual="swatch-white" selected={state.goal === "matte-white"} onClick={() => setState({ ...state, goal: "matte-white" })} />
          </div>
        )}

        {step === 2 && (
          <>
            {state.llmCandidate && (
              <Alert tone="warning" title="AI 검증 후보가 선택되어 있어요">
                {state.llmCandidate.name} 후보가 현재 작업 레시피에 연결됩니다. 아래 기존 후보를 선택하면 변경할 수 있습니다.
              </Alert>
            )}
            <div className="prototype-grid recipe-grid">
              {RECIPE_CANDIDATES.map((candidate) => (
                <article className="recipe-card" key={candidate.id}>
                  <button type="button" className="prototype-choice" aria-pressed={state.recipe === candidate.id} onClick={() => setState({ ...state, recipe: candidate.id, llmCandidate: undefined })}>
                    <span className={`prototype-visual ${candidate.visual}`} role="img" aria-label={`${candidate.name}의 실물 사진이 아닌 색상·질감 플레이스홀더`}><b>사진 없음 · 플레이스홀더</b></span>
                    <strong>{candidate.name}</strong>
                    <span>{candidate.similarityReason}</span>
                    <span className="recipe-facts"><StatusBadge tone="unavailable">{SOURCE_LABELS[candidate.sourceType]}</StatusBadge><small>{candidate.firingRange}</small><small>데이터 {candidate.dataCount}건</small></span>
                    <span className="recipe-uncertainty">불확실성: {candidate.uncertainty}</span>
                    <span className="recipe-risk">위험: {candidate.risk}</span>
                  </button>
                  <DetailDrawer summary="배합·화학 상세 보기"><p>{candidate.detail}</p></DetailDrawer>
                </article>
              ))}
            </div>
            <Guidance reason="선택한 광택·투명도와 규칙 점수가 가장 가깝습니다." assumption="사진 자리는 색상·질감 플레이스홀더이며 예상 실물 사진이 아닙니다." next="후보 하나를 선택하고 기물 모양을 고르세요." />
            <RecommendationEvidence goal={state.goal ?? "satin-blue"} clayBody={state.clayBody} />
            <DetailDrawer><p>이 MVP는 출처가 있는 규칙, 로컬 출처 검색과 합성 예시만 사용합니다. 학습 모델은 권리·표본·독립 평가 게이트를 통과하지 않아 제품 경로에서 차단됩니다.</p></DetailDrawer>
          </>
        )}

        {step === 3 && (
          <>
            <section aria-labelledby="ware-shape-heading">
              <h3 id="ware-shape-heading">기물 모양</h3>
              <div className="prototype-grid ware-grid">
                {WARE_CATALOG.map((ware) => <ChoiceCard key={ware.id} title={ware.label} description={`${ware.size} · ${ware.glazing} 시유`} visual={ware.visual} selected={state.ware === ware.id} onClick={() => setState({ ...state, ware: ware.id })} />)}
              </div>
            </section>
            <section className="ware-options" aria-labelledby="clay-body-heading">
              <h3 id="clay-body-heading">소지 선택</h3>
              <div className="choice-chip-row">{CLAY_BODIES.map((body) => <button type="button" className="choice-chip" aria-pressed={state.clayBody === body.id} key={body.id} onClick={() => setState({ ...state, clayBody: body.id })}><strong>{body.label}</strong><small>{body.note}</small></button>)}</div>
              {state.ware === "other" && <div className="custom-ware"><label htmlFor="custom-ware-note">기타 기물 설명</label><textarea id="custom-ware-note" value={state.customWareNote} onChange={(event) => setState({ ...state, customWareNote: event.target.value })} placeholder="예: 낮고 넓은 손잡이 화병" /><fieldset><legend>가까운 실루엣</legend>{(["round", "tall", "flat"] as const).map((shape) => <button type="button" className="choice-chip" aria-pressed={state.customSilhouette === shape} key={shape} onClick={() => setState({ ...state, customSilhouette: shape })}>{shape === "round" ? "둥근형" : shape === "tall" ? "세로형" : "평판형"}</button>)}</fieldset></div>}
              <Alert tone="unavailable" title="대표 형상에 근거한 추정">정밀 치수나 사용자 메시가 아닌 대표 형상으로 면적과 분포를 추정합니다.</Alert>
            </section>
          </>
        )}

        {step === 4 && (
          <>
            <div className="coating-presets" aria-label="도포 상태 예시 선택">{(["thin", "target", "thick"] as const).map((preset) => <button type="button" className="choice-chip" aria-pressed={state.coating === preset} key={preset} onClick={() => setState({ ...state, coating: preset, coatingConfirmed: false })}>{preset === "thin" ? "얇게 도포" : preset === "target" ? "목표 근처" : "두껍게 도포"}</button>)}</div>
            <ThicknessSection ware={state.ware ?? "bowl"} coating={state.coating ?? "target"} evidence="mass_only" arealDensityGm2={arealDensity ? arealDensity.gramsPerM2 : null} />
            <WeightInputs beforeG={state.beforeWeightG} afterG={state.afterWeightG} onBeforeChange={(value) => setState((current) => ({ ...current, beforeWeightG: value }))} onAfterChange={(value) => setState((current) => ({ ...current, afterWeightG: value }))} result={arealDensity} />
            <DensityCheck />
            <Guidance reason={buildThicknessView({ ware: state.ware ?? "bowl", coating: state.coating ?? "target", meanMm: null }).risk} assumption="실제 무게·면적·건조밀도가 없어 평균은 판정 불가이며 위치별 값은 형상 기반 합성 분포입니다." next="단면과 위험 문장을 확인하고 적재 화면으로 이동하세요." />
            <button type="button" className="prototype-confirm" disabled={!state.coating} aria-pressed={state.coatingConfirmed} onClick={() => setState({ ...state, coatingConfirmed: true })}>가상 분포와 위험을 확인했어요</button>
          </>
        )}

        {step === 5 && (
          <KilnSectionSimulator ware={state.ware ?? "bowl"} coating={state.coating ?? "target"} plan={state.sensorPlan} sensors={state.sensors} onPlanChange={(sensorPlan) => setState((current) => ({ ...current, sensorPlan }))} onSensorsChange={(sensors) => setState((current) => ({ ...current, sensors }))} />
        )}

        {step === 6 && (
          <CurveControlPanel coating={state.coating ?? "target"} approved={state.curveApproved} onApprove={(decision, samples, parameters) => setState((current) => ({ ...current, curveApproved: decision === "accepted", approvedControlSamples: samples, approvedControlParameters: parameters }))} />
        )}

        {step === 7 && (
          <>
            <div className="prototype-firing" aria-live="polite">
              <span className={state.simulationCompleted ? "complete" : "idle"}>{state.simulationCompleted ? "가상 소성 완료" : "가상 가마 준비됨"}</span>
              <div className="heat-field" aria-hidden="true" />
            </div>
            <button type="button" className="prototype-confirm" onClick={() => setState({ ...state, simulationCompleted: true })}>가상 소성 재생</button>
            <Alert tone="unavailable" title="설명용 근사">실제 센서 및 가마 제어 연결 없음</Alert>
          </>
        )}

        {step === 8 && (
          <><ResultFeedback value={state.evaluation} onChange={(evaluation) => setState((current) => ({ ...current, evaluation, result: evaluation.match ?? undefined }))} />{state.result && <Guidance reason="이번 관찰 선택이 개인 기록의 다음 후보 비교에 연결됩니다." assumption="실제 소성 품질이나 재현성을 검증한 결과가 아닙니다." next="작업 기록에 저장한 뒤 영향 추적과 공유 동의를 확인하세요." />}</>
        )}
      </main>

      <footer className="prototype-actions">
        {step > 0 && step < 8 && <button type="button" className="act ghost" onClick={() => setStep(step - 1)}>이전</button>}
        {step < 8 && <button type="button" className="act next" disabled={!canContinue} onClick={next}>{step === 0 ? (state.llmCandidate ? "선택한 후보로 계속" : "샘플 실험 시작") : "다음"}<span aria-hidden="true">→</span></button>}
        {step === 8 && <button type="button" className="act next" disabled={!state.result} onClick={restart}>새 샘플 시작<span aria-hidden="true">↻</span></button>}
      </footer>
    </div>
  );
}
