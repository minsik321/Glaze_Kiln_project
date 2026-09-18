import { useEffect, useMemo, useRef, useState } from "react";
import type { SimulatorProps, SimulatorSnapshot } from "./snapshot";
import { Alert, ProgressHeader, StatusBadge } from "./ui";
import { assertAiceRun, sampleAiceRun, type RecipeCandidate, type SourcedValue } from "./contract";
import { CLAY_BODIES, RECIPE_CANDIDATES, WARE_CATALOG, type RecipeId, type WarePreset } from "./catalog";
import { ThicknessSection } from "./ThicknessSection";
import { DensityCheck } from "./DensityCheck";
import { WeightInputs } from "./WeightInputs";
import { arealDensityFromProfile } from "./arealDensity";
import { buildThicknessView, DEFAULT_SAFE_RANGE_MM, type CoatingPreset } from "./thicknessView";
import { kilnThicknessApi, calibrationApi, aiceRunsApi, ApiError, type ThicknessComputeResponse } from "../lib/api";
import { KilnFiringScreen } from "./KilnFiringScreen";
import { sensorPreset, simulateKilnFrame, type SensorPlacement, type SensorPlan } from "./kilnSimulation";
import { buildCurveComparison, SCENARIO_CONTROL_PLANS, simulateController, toFiringCurve, type ControllerSample } from "./curvePlan";
import { parseFiringRangeC, predictNextRun, PREDICTOR_VERSION } from "./predictionModel";
import { AI_RULE_VERSION } from "./aiMvp";
import { ResultFeedback } from "./ResultFeedback";
import type { ResultEvaluation } from "./feedback";
import { RecipeChatScreen } from "./RecipeChatScreen";

type PrototypeState = {
  recipe?: string;
  llmCandidate?: RecipeCandidate;
  //: 9페이지 "목표" 사진 — 화면 1에서 후보를 선택할 때 그 후보의 자동
  //: 생성 이미지가 있었다면 함께 받아둔다(RecipeChatScreen.tsx onSelect).
  llmCandidateImage?: { base64: string; mediaType: string };
  intakePrompt?: string;
  intakeCandidates: RecipeCandidate[];
  ware?: WarePreset;
  clayBody?: (typeof CLAY_BODIES)[number]["id"];
  customWareNote: string;
  customSilhouette: "round" | "tall" | "flat";
  //: v9: 도포 상태는 더 이상 버튼으로 고르지 않는다 — 실측 무게로 계산된
  //: thicknessViewData.overallStatus에서 파생한다(아래 computedCoating).
  //: 이 플래그는 사용자가 "위험을 줄이는 소성 계획 적용" 버튼을 눌렀는지만
  //: 기록한다 — 다음(가마·소성곡선) 화면이 기준 계획 대신 두께 반영
  //: 수정 계획을 기본으로 보여줄지 결정하는 데 쓰인다.
  riskMitigationApplied: boolean;
  sensorPlan?: SensorPlan;
  sensors: SensorPlacement[];
  //: LLM 프런트도어 TODO Phase 3 — 시유 전/후 무게(§5-a). 문자열로 들고
  //: 있다가 계산 시점에 숫자로 바꾼다(빈 입력을 구분하기 위해).
  beforeWeightG: string;
  afterWeightG: string;
  //: 07절 두께 계산(compute_profile)의 필수 입력 — 시유 방법과(담금일 때만)
  //: 담금시간. GlazingMethod 한국어 라벨 그대로 쓴다.
  glazingMethod: string;
  dipSeconds: string;
  curveApproved: boolean;
  // LLM 프런트도어 TODO Phase 3: 승인 시점에 KilnFiringScreen이 실제로
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
  glazingMethod: "담금",
  dipSeconds: "",
  riskMitigationApplied: false,
  curveApproved: false,
  approvedControlSamples: [],
  approvedControlParameters: {},
  simulationCompleted: false,
  sensors: [],
  intakeCandidates: [],
  evaluation: { match: null, color: null, gloss: null, texture: null, transparency: null, defects: [], scope: "personal", resultPhoto: null },
};

const screens = [
  "AI 제안",
  "기물",
  "도포",
  "가마",
  "평가",
] as const;

const screenTitles = [
  ["원하는 유약을 설명해 주세요", "AI 제안을 화학 규칙으로 검증한 뒤 후보를 보여줍니다."],
  ["자주 쓰는 기물에서 골라요", "형상과 소지를 고르면 다음 화면의 두께 계산에 함께 쓰입니다."],
  ["도포 상태를 단면으로 확인해요", "위치별 모습은 형상 기반 가상 분포입니다."],
  ["가마와 소성곡선을 함께 확인해요", "센서 위치·이상 시나리오·제어 계획·가상 소성이 한 화면입니다."],
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

//: v9 후속(3페이지): 상시 노출 "왜/가정/다음행동" 드로어 대신, 두께 판단
//: 결과에 따라 사용자가 직접 다음 행동을 고르는 문장+버튼 조합을 쓴다
//: (아래 step===2 블록). 상태별 안내 제목만 여기 모아 둔다.
const THICKNESS_DECISION_TITLE: Record<CoatingPreset, string> = {
  thin: "지금 두께가 목표보다 얇아요",
  target: "지금 두께가 목표 범위 안이에요",
  thick: "지금 두께가 목표보다 두꺼워요",
};

export function AicePrototype({ onSnapshotReady, restoredRun, token = "", userId, onSaved }: SimulatorProps & { restoredRun?: ReturnType<typeof sampleAiceRun>; token?: string; userId?: string; onSaved?: () => void }) {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<PrototypeState>(initialState);

  // 07절 두께 계산은 이제 백엔드 `/kiln/thickness/profile`(kiln.thickness
  // .profile.compute_profile)을 실제로 돌리므로 비동기다. requestId로
  // 오래된 응답이 최신 입력을 덮어쓰지 않게 막는다(KilnFiringScreen.tsx와
  // 같은 패턴).
  const [thicknessProfile, setThicknessProfile] = useState<ThicknessComputeResponse | null>(null);
  const [thicknessStatus, setThicknessStatus] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [thicknessError, setThicknessError] = useState<string | null>(null);
  const thicknessRequestId = useRef(0);

  const beforeWeight = Number(state.beforeWeightG);
  const afterWeight = Number(state.afterWeightG);
  const dipSeconds = state.glazingMethod === "담금" ? Number(state.dipSeconds) : null;
  const weightsReady = state.beforeWeightG.trim() !== "" && state.afterWeightG.trim() !== ""
    && Number.isFinite(beforeWeight) && Number.isFinite(afterWeight) && afterWeight > beforeWeight
    && (state.glazingMethod !== "담금" || (state.dipSeconds.trim() !== "" && Number.isFinite(dipSeconds) && (dipSeconds as number) > 0));

  useEffect(() => {
    if (!weightsReady) {
      setThicknessProfile(null);
      setThicknessStatus("idle");
      return;
    }
    const id = ++thicknessRequestId.current;
    setThicknessStatus("loading");
    setThicknessError(null);
    kilnThicknessApi
      .computeProfile({
        ware_preset: state.ware ?? "bowl",
        weight_before_g: beforeWeight,
        weight_after_g: afterWeight,
        method: state.glazingMethod,
        dip_seconds: dipSeconds,
      })
      .then((profile) => {
        if (thicknessRequestId.current !== id) return;
        setThicknessProfile(profile);
        setThicknessStatus("ready");
      })
      .catch((err) => {
        if (thicknessRequestId.current !== id) return;
        setThicknessError(err instanceof ApiError ? err.message : "두께 계산을 불러오지 못했습니다.");
        setThicknessStatus("error");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightsReady, state.ware, beforeWeight, afterWeight, state.glazingMethod, dipSeconds]);

  const thicknessViewData = useMemo(
    () => buildThicknessView({ ware: state.ware ?? "bowl", profile: thicknessProfile }),
    [state.ware, thicknessProfile],
  );
  const arealDensity = arealDensityFromProfile(thicknessProfile);
  //: v9: 5페이지 요구사항 — 도포 상태는 선택이 아니라 실측 무게로 계산된
  //: 값이어야 한다. thicknessViewData.overallStatus(무게 미입력이면
  //: "unavailable")를 그대로 따라가고, 아직 계산 전에는 이후 화면(가마·
  //: 소성곡선)이 판단을 멈추지 않도록 "target"을 잠정값으로만 쓴다.
  const computedCoating: CoatingPreset = thicknessViewData.overallStatus === "unavailable" ? "target" : thicknessViewData.overallStatus;

  // 사용자 요구사항: "소성이 그럼 기준 계획이 박힌게 아니라 레시피에 따른
  // 소성이 되어야지 그에 기반으로 두께에 따라 소성이 수정되어야 하는거고" —
  // curvePlan.ts의 기준 계획과 predictNextRun의 예측 입력이 함께 참조할
  // "지금 활성 레시피의 예상 소성범위" 하나를 여기서 계산한다. LLM 후보가
  // 있으면 그 predicted_firing_range를 우선하고(가장 최신 추천), 없으면
  // 카탈로그에서 고른 레시피의 표시용 범위를 파싱해 대체한다.
  const selectedRecipeForFiring = useMemo(
    () => RECIPE_CANDIDATES.find((item) => item.id === state.recipe),
    [state.recipe],
  );
  const activeFiringRangeC = useMemo<readonly [number, number] | null>(() => {
    const llmRange = state.llmCandidate?.predicted_firing_range.value;
    if (llmRange?.[0] != null && llmRange[1] != null) return [llmRange[0], llmRange[1]];
    return selectedRecipeForFiring ? parseFiringRangeC(selectedRecipeForFiring.firingRange) : null;
  }, [state.llmCandidate, selectedRecipeForFiring]);

  // Phase 5: predictNextRun의 priorRunCount는 더 이상 0으로 고정된
  // 초안이 아니다 — kiln.calibration.registry.CoefficientTableStore에
  // 저장된 실제 calibration_runs를 backend/app 경유로 읽는다(레시피별
  // 저장소 격리, personal_calibrations 참고).
  const activeRecipeId = state.llmCandidate?.id ?? state.recipe ?? null;
  const [calibrationRuns, setCalibrationRuns] = useState(0);
  //: Phase 5 후속(kiln.calibration.firing) — 이 레시피로 평가 완료된
  //: 회차들의 (실제 광택 − 목표 광택) 누적 편향. 아직 관측이 없으면
  //: null(0과 다른 진술)이며, predictNextRun이 이 값을 다음 유지온도
  //: 제안에 부호를 뒤집어 반영한다.
  const [firingGlossBias, setFiringGlossBias] = useState<number | null>(null);
  //: v9 후속(3페이지) — "레시피상 유약 두께를 목표 평균 두께로 설정"의
  //: 근거. 레시피별로 캘리브레이션된 안전 두께 범위가 있으면 그 값을,
  //: 없으면 07절 기본 안전 범위(DEFAULT_SAFE_RANGE_MM)를 쓴다.
  const [safeThicknessMm, setSafeThicknessMm] = useState<readonly [number, number] | null>(null);
  useEffect(() => {
    if (!token || !activeRecipeId) {
      setCalibrationRuns(0);
      setFiringGlossBias(null);
      setSafeThicknessMm(null);
      return;
    }
    let cancelled = false;
    calibrationApi
      .get(token, activeRecipeId)
      .then((table) => {
        if (!cancelled) {
          setCalibrationRuns(table.calibration_runs);
          setFiringGlossBias(table.gloss_bias_level);
          setSafeThicknessMm(table.safe_thickness_mm);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCalibrationRuns(0);
          setFiringGlossBias(null);
          setSafeThicknessMm(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, activeRecipeId]);
  const recipeTargetThicknessMm = useMemo(() => {
    const [lo, hi] = safeThicknessMm ?? DEFAULT_SAFE_RANGE_MM;
    return Number(((lo + hi) / 2).toFixed(2));
  }, [safeThicknessMm]);

  const snapshot = useMemo<SimulatorSnapshot>(() => {
    const run = restoredRun ?? sampleAiceRun();
    //: v9: 2~3페이지(목표 카드·정적 레시피 그리드) 삭제로 목표 좌표는
    //: 더 이상 사용자가 직접 고르지 않는다 — 화면 1에서 고른 LLM 후보의
    //: target_gloss/target_transparency가 있으면 그걸 쓰고, 없으면 복원된
    //: 기록(또는 샘플)의 목표를 그대로 유지한다.
    const llmGoal = state.llmCandidate?.target_gloss && state.llmCandidate?.target_transparency
      ? {
        gloss: state.llmCandidate.target_gloss.toLowerCase() as typeof run.goal.gloss,
        transparency: state.llmCandidate.target_transparency.toLowerCase() as typeof run.goal.transparency,
      }
      : null;
    const goal = llmGoal ? { ...run.goal, ...llmGoal } : run.goal;
    const thicknessView = thicknessViewData;
    const sensorPlan = state.sensorPlan ?? "three";
    const sensors = state.sensors.length ? state.sensors : sensorPreset(sensorPlan);
    const kilnFrame = simulateKilnFrame({ minute: 320, sensors, coating: computedCoating });
    const selectedRecipe = RECIPE_CANDIDATES.find((item) => item.id === state.recipe);
    const llmRange = state.llmCandidate?.predicted_firing_range.value;
    const prediction = predictNextRun({
      coating: computedCoating,
      ware: state.ware ?? "bowl",
      recipeFiringRangeC: activeFiringRangeC,
      //: personal_calibrations에 저장된 실제 회차 수(위 useEffect) — 로그인
      //: 전이거나 아직 캘리브레이션 이력이 없으면 0.
      priorRunCount: calibrationRuns,
      //: kiln.calibration.firing이 누적한 실측 광택 편향(위 useEffect) —
      //: 로그인 전이거나 관측이 아직 없으면 null.
      firingGlossBiasLevel: firingGlossBias,
    });
    const curveSeries = buildCurveComparison(computedCoating, activeFiringRangeC, prediction.holdDeltaC, prediction.reason);
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
        //: 조성 추천 피드백 루프가 저장된 회차에서 배합을 다시 읽어야
        //: 하므로(Prior 되먹임), 확정 시점에 materials를 함께 저장한다 —
        //: 이전에는 여기서 배합이 통째로 사라졌다.
        materials: { ...state.llmCandidate.materials },
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
        controller_kind: "feedforward_p",
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
  }, [restoredRun, state, step, thicknessViewData, arealDensity, calibrationRuns, firingGlossBias, activeFiringRangeC]);

  // v9 개편: 화면 1에서 새 질문을 보낼 때마다(이력 복원 제외) 이력
  // 사이드바에 제목=질문으로 자동 저장한다 — 세대 카운터로 "진짜 새 생성"과
  // "이력에서 복원"을 구분해, 복원할 때마다 같은 항목이 중복 저장되지
  // 않게 한다(RecipeChatScreen.tsx의 onGenerated/onIntake 분리와 짝).
  const [intakeGeneration, setIntakeGeneration] = useState(0);
  const savedIntakeGenerationRef = useRef(0);
  useEffect(() => {
    if (!token || !state.intakePrompt || intakeGeneration === savedIntakeGenerationRef.current) return;
    savedIntakeGenerationRef.current = intakeGeneration;
    try {
      assertAiceRun(snapshot);
    } catch {
      return;
    }
    void aiceRunsApi.create(token, { title: state.intakePrompt, run: snapshot, is_public: false }).catch(() => {});
  }, [intakeGeneration, token, state.intakePrompt, snapshot]);

  // 9페이지: "저장" 버튼이 지금까지 만든 AiceRun 전체를 작업기록(AiceRun v2
  // 목록)에 저장하고, 성공하면 작업기록 화면으로 넘어간다(onSaved).
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  async function saveResultToRecords() {
    if (!token || saveStatus === "saving") return;
    setSaveStatus("saving");
    setSaveError(null);
    try {
      assertAiceRun(snapshot);
      const title = state.intakePrompt?.trim() || `${state.llmCandidate?.name ?? "유약 실험"} 결과`;
      await aiceRunsApi.create(token, { title, run: snapshot, is_public: false });
      setSaveStatus("idle");
      onSaved?.();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "저장하지 못했습니다.");
      setSaveStatus("error");
    }
  }

  useEffect(() => {
    if (!restoredRun) return;
    let cancelled = false;
    const knownRecipe = RECIPE_CANDIDATES.some((candidate) => candidate.id === restoredRun.recipe.id) ? restoredRun.recipe.id as RecipeId : restoredRun.recipe.id;
    const knownClay = CLAY_BODIES.some((body) => body.id === restoredRun.ware.clay_body) ? restoredRun.ware.clay_body as PrototypeState["clayBody"] : undefined;
    const curveApproved = Boolean(restoredRun.curves.selected_id);
    // 복원된 기록에는 승인 당시 내부적으로 어떤 외란 시나리오가 쓰였는지
    // 이름이 남아있지 않는다(사용자에게 애초에 노출하지 않으므로) — 기본
    // 시나리오로 kiln.firing을 다시 돌려 채운다. 백엔드 호출이라 비동기다.
    (async () => {
      let approvedControlSamples: ControllerSample[] = [];
      let approvedControlParameters: Record<string, SourcedValue<number>> = {};
      if (curveApproved) {
        const curveSeries = buildCurveComparison("target", restoredRun.recipe.firing_range.value);
        const adjustedCurve = curveSeries.find((curve) => curve.role === "adjusted")!;
        const normalPlan = SCENARIO_CONTROL_PLANS.normal;
        const run = await simulateController(adjustedCurve, normalPlan.disturbance, normalPlan.constraints.sampleSeconds);
        approvedControlSamples = run.samples;
        approvedControlParameters = normalPlan.parameters;
      }
      if (cancelled) return;
      setState({ ...initialState, recipe: knownRecipe, ware: restoredRun.ware.preset, clayBody: knownClay, riskMitigationApplied: true, sensorPlan: restoredRun.loading.sensor_plan, sensors: restoredRun.loading.sensors.map((sensor) => ({ id: sensor.id, heightRatio: sensor.height_ratio, target: "복원된 센서 주변", blindSpot: "복원 기록에 상세 없음", limitation: sensor.temperature.note })), curveApproved, approvedControlSamples, approvedControlParameters, simulationCompleted: restoredRun.status !== "draft", result: restoredRun.status === "evaluated" ? "close" : undefined, evaluation: { ...initialState.evaluation, match: restoredRun.status === "evaluated" ? "close" : null, defects: restoredRun.result.defects, scope: restoredRun.result.feedback_scope ?? "personal" } });
      setStep(restoredRun.status === "evaluated" ? 4 : restoredRun.status === "simulated" ? 3 : 0);
    })();
    return () => {
      cancelled = true;
    };
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
    Boolean(state.ware && state.clayBody && (state.ware !== "other" || state.customWareNote.trim())),
    state.riskMitigationApplied,
    state.curveApproved && state.simulationCompleted,
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

        {/* v9 개편: step 0이 아닐 때도 언마운트하지 않는다(hidden만 토글) —
            예전에는 {step === 0 && (...)} 조건부 렌더링이라 다른 화면으로
            넘어갔다 돌아오면 RecipeChatScreen의 로컬 상태(후보·이미지·
            선택)가 통째로 날아갔다. */}
        <section className="prototype-home" hidden={step !== 0}>
          {!token && <Alert tone="unavailable" title="로그인이 필요해요">계정 화면에서 로그인하면 AI 레시피 후보를 요청할 수 있습니다.</Alert>}
          <RecipeChatScreen
            token={token}
            disabled={!token}
            onSelect={(candidate, image) => setState((current) => ({
              ...current,
              recipe: candidate.id,
              llmCandidate: candidate,
              llmCandidateImage: image,
            }))}
            onIntake={(promptText, candidates) => setState((current) => ({
              ...current,
              intakePrompt: promptText,
              intakeCandidates: candidates,
            }))}
            onGenerated={() => setIntakeGeneration((current) => current + 1)}
          />
        </section>

        {step === 1 && (
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
            </section>
          </>
        )}

        {step === 2 && (
          <>
            {/* v9 후속: 비중 확인 → 담금시간 역산을 맨 위로 올린다(목표
                두께는 이 레시피의 안전 두께 범위 중앙값을 기본값으로
                채운다). 그 아래 실측 무게 입력 → 계산된 종단면 순서. */}
            <DensityCheck defaultTargetMm={recipeTargetThicknessMm} />
            <WeightInputs
              beforeG={state.beforeWeightG}
              afterG={state.afterWeightG}
              method={state.glazingMethod}
              dipSeconds={state.dipSeconds}
              onBeforeChange={(value) => setState((current) => ({ ...current, beforeWeightG: value }))}
              onAfterChange={(value) => setState((current) => ({ ...current, afterWeightG: value }))}
              onMethodChange={(value) => setState((current) => ({ ...current, glazingMethod: value }))}
              onDipSecondsChange={(value) => setState((current) => ({ ...current, dipSeconds: value }))}
              result={arealDensity}
            />
            {thicknessStatus === "error" && <Alert tone="danger" title="두께 계산 오류">{thicknessError}</Alert>}
            <ThicknessSection ware={state.ware ?? "bowl"} profile={thicknessProfile} loading={thicknessStatus === "loading"} />
            {/* v9 후속: 단일 "적용" 버튼 대신 지금 두께가 목표와 어떤
                관계인지 설명하고, 그에 맞는 행동을 사용자가 고르게 한다. */}
            <section className="thickness-decision" aria-labelledby="thickness-decision-heading">
              <h3 id="thickness-decision-heading">두께 판단과 다음 행동</h3>
              <Alert tone={computedCoating === "target" ? "unavailable" : "warning"} title={THICKNESS_DECISION_TITLE[computedCoating]}>
                {thicknessViewData.risk}
              </Alert>
              <div className="thickness-decision-actions">
                <button
                  type="button"
                  className="prototype-confirm"
                  disabled={thicknessViewData.evidence === "unavailable"}
                  aria-pressed={state.riskMitigationApplied}
                  onClick={() => setState({ ...state, riskMitigationApplied: true })}
                >
                  {computedCoating === "target" ? "이 상태로 소성 계획 확정하기" : "이대로 진행하고 소성 계획으로 위험 줄이기"}
                </button>
                {computedCoating !== "target" && (
                  <button
                    type="button"
                    className="act ghost"
                    onClick={() => setState((current) => ({ ...current, beforeWeightG: "", afterWeightG: "", dipSeconds: "", riskMitigationApplied: false }))}
                  >
                    다시 시유하기
                  </button>
                )}
              </div>
            </section>
          </>
        )}

        {step === 3 && (
          <KilnFiringScreen
            ware={state.ware ?? "bowl"}
            coating={computedCoating}
            userId={userId}
            sensors={state.sensors}
            //: KilnFiringScreen이 계정 가마 정보(kiln_sensor_plan)에서 센서
            //: 배치를 자동으로 채운다 — 몇 개인지로 sensorPlan을 역산해
            //: AiceRun.loading.sensor_plan에 그대로 남긴다.
            onSensorsChange={(sensors) => setState((current) => ({
              ...current,
              sensors,
              sensorPlan: sensors.length === 1 ? "single" : sensors.length === 3 ? "three" : "multi",
            }))}
            recipeFiringRangeC={activeFiringRangeC}
            riskMitigationApplied={state.riskMitigationApplied}
            approved={state.curveApproved}
            onApprove={(decision, samples, parameters) => setState((current) => ({ ...current, curveApproved: decision === "accepted", approvedControlSamples: samples, approvedControlParameters: parameters }))}
            simulationCompleted={state.simulationCompleted}
            onSimulationStart={() => setState((current) => ({ ...current, simulationCompleted: true }))}
          />
        )}

        {step === 4 && (
          <>
            <ResultFeedback
              value={state.evaluation}
              onChange={(evaluation) => setState((current) => ({ ...current, evaluation, result: evaluation.match ?? undefined }))}
              targetPhoto={state.llmCandidateImage}
            />
            {state.result && (
              <>
                {saveStatus === "error" && <Alert tone="danger" title="저장하지 못했어요">{saveError}</Alert>}
                {!token && <Alert tone="unavailable" title="로그인이 필요해요">로그인하면 작업기록에 저장할 수 있습니다.</Alert>}
                <button type="button" className="prototype-confirm" disabled={!token || saveStatus === "saving"} onClick={() => void saveResultToRecords()}>
                  {saveStatus === "saving" ? "저장 중…" : "저장하고 작업기록으로 이동"}
                </button>
              </>
            )}
          </>
        )}
      </main>

      <footer className="prototype-actions">
        {step > 0 && step < 4 && <button type="button" className="act ghost" onClick={() => setStep(step - 1)}>이전</button>}
        {step < 4 && <button type="button" className="act next" disabled={!canContinue} onClick={next}>{step === 0 ? (state.llmCandidate ? "선택한 후보로 계속" : "샘플 실험 시작") : "다음"}<span aria-hidden="true">→</span></button>}
        {step === 4 && <button type="button" className="act next" disabled={!state.result} onClick={restart}>새 샘플 시작<span aria-hidden="true">↻</span></button>}
      </footer>
    </div>
  );
}
