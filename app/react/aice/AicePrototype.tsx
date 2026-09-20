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
import { buildCurveComparison, curveSummary, toFiringCurve, type CurveSeries, type ControllerSample } from "./curvePlan";
import { parseFiringRangeC, predictNextRun, PREDICTOR_VERSION } from "./predictionModel";
import { AI_RULE_VERSION } from "./aiMvp";
import { ResultFeedback } from "./ResultFeedback";
import { evaluationComplete, type ResultEvaluation } from "./feedback";
import { RecipeChatScreen } from "./RecipeChatScreen";

type PrototypeState = {
  runId: string;
  dryingComplete: boolean;
  approvedCurves: CurveSeries[] | null;
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
  //: v9 후속: 비중 실측값(DensityCheck.tsx가 끌어올린 controlled 값).
  //: 이전에는 DensityCheck 내부 로컬 상태라 두께 계산(g(ρ)/m(ρ))과 저장
  //: 기록(application.density) 어디에도 전달되지 않았다 — 여기로 끌어올려
  //: 두 곳 모두에 같은 실측값을 쓴다.
  specificGravity: string;
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
  runId: "",
  dryingComplete: false,
  approvedCurves: null,
  customWareNote: "",
  customSilhouette: "round",
  beforeWeightG: "",
  afterWeightG: "",
  specificGravity: "",
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
  const [state, setState] = useState<PrototypeState>(() => ({ ...initialState, runId: crypto.randomUUID() }));
  const [sourceRun, setSourceRun] = useState(restoredRun);
  const [restoredUnchanged, setRestoredUnchanged] = useState(Boolean(restoredRun));

  // 07절 두께 계산은 이제 백엔드 `/kiln/thickness/profile`(kiln.thickness
  // .profile.compute_profile)을 실제로 돌리므로 비동기다. requestId로
  // 오래된 응답이 최신 입력을 덮어쓰지 않게 막는다(KilnFiringScreen.tsx와
  // 같은 패턴).
  const [safeThicknessMm, setSafeThicknessMm] = useState<readonly [number, number] | null>(null);
  const [thicknessProfile, setThicknessProfile] = useState<ThicknessComputeResponse | null>(null);
  const [thicknessStatus, setThicknessStatus] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [thicknessError, setThicknessError] = useState<string | null>(null);
  const thicknessRequestId = useRef(0);

  const beforeWeight = Number(state.beforeWeightG);
  const afterWeight = Number(state.afterWeightG);
  const dipSeconds = state.glazingMethod === "담금" ? Number(state.dipSeconds) : null;
  //: 비중 실측이 없으면 null로 보내 백엔드가 정규화 기준값(ρ=1.45)으로
  //: 안전하게 대체하게 한다(profile.py의 _RHO_FALLBACK, provenance_notes에
  //: 그 사실이 남는다) — 입력 안 된 상태를 억지로 1.45로 지어내 보내지 않는다.
  const specificGravity = state.specificGravity.trim() !== "" ? Number(state.specificGravity) : null;
  const specificGravityValid = specificGravity === null || (Number.isFinite(specificGravity) && specificGravity > 1);
  const weightsReady = state.beforeWeightG.trim() !== "" && state.afterWeightG.trim() !== ""
    && Number.isFinite(beforeWeight) && Number.isFinite(afterWeight) && afterWeight > beforeWeight
    && (state.glazingMethod !== "담금" || (state.dipSeconds.trim() !== "" && Number.isFinite(dipSeconds) && (dipSeconds as number) > 0))
    && specificGravityValid && state.dryingComplete;

  useEffect(() => {
    const id = ++thicknessRequestId.current;
    setThicknessProfile(null);
    setThicknessError(null);
    if (!weightsReady) {
      setThicknessProfile(null);
      setThicknessStatus("idle");
      return;
    }
    setThicknessStatus("loading");
    setThicknessError(null);
    kilnThicknessApi
      .computeProfile({
        ware_preset: state.ware ?? "bowl",
        weight_before_g: beforeWeight,
        weight_after_g: afterWeight,
        method: state.glazingMethod,
        dip_seconds: dipSeconds,
        specific_gravity: specificGravity,
        drying_complete: state.dryingComplete,
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
    return () => { thicknessRequestId.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightsReady, state.ware, beforeWeight, afterWeight, state.glazingMethod, dipSeconds, specificGravity, state.dryingComplete]);

  const thicknessViewData = useMemo(
    () => buildThicknessView({ ware: state.ware ?? "bowl", profile: thicknessProfile, safeRangeMm: safeThicknessMm ?? DEFAULT_SAFE_RANGE_MM }),
    [state.ware, thicknessProfile, safeThicknessMm],
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
    return selectedRecipeForFiring ? parseFiringRangeC(selectedRecipeForFiring.firingRange) : sourceRun?.recipe.firing_range.value ?? null;
  }, [state.llmCandidate, selectedRecipeForFiring, sourceRun]);

  // Phase 5: predictNextRun의 priorRunCount는 더 이상 0으로 고정된
  // 초안이 아니다. **주의**: 두께 계수(k1·k2·ρ_dry) 캘리브레이션 회차 수
  // (`table.calibration_runs`)를 쓰지 않는다 — 그 캘리브레이션은 파단면
  // 실측 제출 화면이 없어(의도적으로 만들지 않음, MVP 스코프) 영원히
  // 0으로 남는 죽은 카운터다. 그 값을 쓰면 "회차가 쌓일수록 보정폭을
  // 줄인다"는 historyDamping(predictionModel.ts)이 실행 횟수와 무관하게
  // 항상 최대 폭으로 고정돼 버린다. 대신 `table.firing_calibration_runs`
  // (kiln.calibration.firing) — 이 레시피로 평가 완료되고 목표·실제
  // 광택이 둘 다 기록된 회차 수 — 를 쓴다. 평가 완료 회차를 저장할
  // 때마다 자동으로 늘어나므로(별도 제출 화면 불필요) 실제로 감쇠가
  // 작동한다.
  const activeRecipeId = state.llmCandidate?.id ?? state.recipe ?? null;
  const [recipeRunCount, setRecipeRunCount] = useState(0);
  //: Phase 5 후속(kiln.calibration.firing) — 이 레시피로 평가 완료된
  //: 회차들의 (실제 광택 − 목표 광택) 누적 편향. 아직 관측이 없으면
  //: null(0과 다른 진술)이며, predictNextRun이 이 값을 다음 유지온도
  //: 제안에 부호를 뒤집어 반영한다.
  const [firingGlossBias, setFiringGlossBias] = useState<number | null>(null);
  //: v9 후속(3페이지) — "레시피상 유약 두께를 목표 평균 두께로 설정"의
  //: 근거. 이 레시피의 개인 다음-시도 두께 제안(nextTrialThicknessMm,
  //: kiln.calibration.density)이 있으면 그 값을, 없으면 위험 판정 경계
  //: (safeThicknessMm, 없으면 07절 기본 DEFAULT_SAFE_RANGE_MM)의 중간값을
  //: 쓴다.
  //: v9 후속(3페이지) — "비중 역시 해당 레시피의 비중이어야" 요구사항의
  //: 근거. 이 레시피로 실제 시유에 쓴 비중 실측값의 누적 범위
  //: (kiln.calibration.density). 관측이 없으면 null이고, 이때
  //: DensityCheck는 문헌 기본 범위([1.4, 1.5])로 대체한다.
  const [densityRange, setDensityRange] = useState<readonly [number, number] | null>(null);
  //: kiln.calibration.density의 개인 "다음 시도" 두께 제안 — safeThicknessMm
  //: (kiln.risk 08절 위험 판정 경계)과 저장 위치·의미가 다르다. 둘을 같은
  //: 값으로 합치면 위험 경계가 조용히 개인 이력값으로 바뀌는 버그가 된다
  //: (2026-09-20 발견·수정). 목표 두께 설정에는 이 값을, 위험 판정에는
  //: safeThicknessMm만 쓴다.
  const [nextTrialThicknessMm, setNextTrialThicknessMm] = useState<readonly [number, number] | null>(null);
  useEffect(() => {
    if (!token || !activeRecipeId) {
      setRecipeRunCount(0);
      setFiringGlossBias(null);
      setSafeThicknessMm(null);
      setDensityRange(null);
      setNextTrialThicknessMm(null);
      return;
    }
    let cancelled = false;
    calibrationApi
      .get(token, activeRecipeId)
      .then((table) => {
        if (!cancelled) {
          setRecipeRunCount(table.firing_calibration_runs);
          setFiringGlossBias(table.gloss_bias_level);
          setSafeThicknessMm(table.safe_thickness_mm);
          setDensityRange(table.specific_gravity_range);
          setNextTrialThicknessMm(table.next_trial_thickness_mm);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecipeRunCount(0);
          setFiringGlossBias(null);
          setSafeThicknessMm(null);
          setDensityRange(null);
          setNextTrialThicknessMm(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, activeRecipeId]);
  const recipeTargetThicknessMm = useMemo(() => {
    // 개인 다음-시도 제안이 있으면 그걸 우선한다(이 레시피의 과거 성공
    // 회차 기반) — 없으면 위험 판정 경계의 중간값으로 대체한다.
    const [lo, hi] = nextTrialThicknessMm ?? safeThicknessMm ?? DEFAULT_SAFE_RANGE_MM;
    return Number(((lo + hi) / 2).toFixed(2));
  }, [nextTrialThicknessMm, safeThicknessMm]);
  //: v9 후속(2026-09-20) — "비중도 해당 레시피의 비중이어야" 요구사항의
  //: 화면 표시 근거. 이 레시피의 실측 비중 범위(densityRange)가 있으면
  //: 그 중앙값을, 없으면 문헌 기본 범위([1.4, 1.5])의 중앙값을 쓴다.
  //: DensityCheck의 ρ 입력칸 자체는 실제 측정값을 받는 자리라 이 값으로
  //: 덮어쓰지 않고, 목표값은 별도 안내 문구로 보여준다.
  const recipeTargetRho = useMemo(() => {
    const [lo, hi] = densityRange ?? [1.4, 1.5];
    return Number(((lo + hi) / 2).toFixed(2));
  }, [densityRange]);

  const executionCurves = useMemo(() => {
    const prediction = predictNextRun({
      coating: computedCoating,
      ware: state.ware ?? "bowl",
      recipeFiringRangeC: activeFiringRangeC,
      //: 이 레시피로 평가 완료되고 목표·실제 광택이 둘 다 기록된 회차 수
      //: (위 useEffect, kiln.calibration.firing) — 로그인 전이거나 아직
      //: 없으면 0.
      priorRunCount: recipeRunCount,
      //: kiln.calibration.firing이 누적한 실측 광택 편향(위 useEffect) —
      //: 로그인 전이거나 관측이 아직 없으면 null.
      firingGlossBiasLevel: firingGlossBias,
    });
    const curveSeries = buildCurveComparison(computedCoating, activeFiringRangeC, prediction.holdDeltaC, prediction.reason);
    const personalized = curveSeries.find((curve) => curve.role === "next")!;
    return [curveSeries[0], { ...personalized, id: `personalized-${computedCoating}-v1`, role: "adjusted" as const, label: "두께·개인 이력 반영 계획" }];
  }, [computedCoating, state.ware, activeFiringRangeC, recipeRunCount, firingGlossBias]);

  const snapshot = useMemo<SimulatorSnapshot>(() => {
    if (sourceRun && restoredUnchanged) return sourceRun;
    const run = sourceRun ?? sampleAiceRun();
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
    const curveSeries = state.approvedCurves ?? executionCurves;
    const adjustedCurve = curveSeries[1];
    const controlSamples = state.curveApproved ? state.approvedControlSamples : [];
    const controlParameters = state.curveApproved ? state.approvedControlParameters : {};
    return {
      ...run,
      run_id: state.runId,
      status: state.simulationCompleted && evaluationComplete(state.evaluation) ? "evaluated" : state.simulationCompleted ? "simulated" : "draft",
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
        colorants: { ...state.llmCandidate.colorants },
        colorant_note: state.llmCandidate.colorant_note,
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
        method: ({ "담금": "dipping", "부기": "pouring", "붓칠": "brushing", "분무": "spraying" } as const)[state.glazingMethod as "담금"] ?? "dipping",
        dip_seconds: dipSeconds,
        drying_complete: state.dryingComplete,
        before_weight: state.beforeWeightG.trim() ? { value: Number(state.beforeWeightG), unit: "g", source_type: "observed", confidence: 1, note: "사용자 입력" } : run.application.before_weight,
        after_weight: state.afterWeightG.trim() ? { value: Number(state.afterWeightG), unit: "g", source_type: "observed", confidence: 1, note: "사용자 입력" } : run.application.after_weight,
        //: v9 후속: 이전에는 DensityCheck.tsx 로컬 상태였던 탓에 이 값이
        //: 저장 기록에 전혀 실리지 않았다(항상 run.application.density의
        //: 자리표시 placeholder만 남음) — 사용자 요구사항 "비중도 레시피별"
        //: 되먹임(kiln.calibration.density)의 입력이 바로 이 필드다.
        density: state.specificGravity.trim() ? { value: Number(state.specificGravity), unit: "g/mL", source_type: "observed", confidence: 1, note: "사용자 입력" } : run.application.density,
      },
      thickness: {
        ...run.thickness,
        //: v9 후속: 사용자 요구사항 "그 두께가 나중의 소성과정에도 저장이
        //: 되어야" — 이전에는 areal_density·warning만 실제 계산값으로
        //: 덮어쓰고 평균 두께(mean) 자체는 원본 샘플의 자리표시값 그대로
        //: 저장됐다. thicknessProfile이 준비돼 있으면 실제 계산된
        //: 총량제약 평균(07절, W/(A·ρ_dry))을 싣는다.
        mean: thicknessProfile
          ? { value: thicknessProfile.mean_mm, unit: "mm", source_type: "inferred", confidence: .6, note: "07절 두께 산출(총량 제약) — k1·k2·ρ_dry는 문헌 추정 초기값, 미보정" }
          : run.thickness.mean,
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
        match: state.evaluation.match,
        defects_reviewed: state.evaluation.defectsReviewed ?? false,
        photo: state.evaluation.resultPhoto ? { id: `${state.runId}-result`, kind: "result", storage_path: null, data_url: state.evaluation.resultPhoto.dataUrl, placeholder: false, source_type: "observed", rights_confirmed: false, alt: state.evaluation.resultPhoto.name } : null,
        color: state.evaluation.color,
        gloss: state.evaluation.gloss,
        texture: state.evaluation.texture,
        transparency: state.evaluation.transparency,
        defects: state.evaluation.defects,
        feedback_scope: state.result ? state.evaluation.scope : null,
      },
    };
  }, [sourceRun, restoredUnchanged, state, step, thicknessViewData, thicknessProfile, arealDensity, recipeRunCount, firingGlossBias, activeFiringRangeC, executionCurves, dipSeconds]);

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
    void aiceRunsApi.create(token, { title: state.intakePrompt, run: snapshot, request_id: state.runId, is_public: false }).catch(() => {});
  }, [intakeGeneration, token, state.intakePrompt, snapshot]);

  // 9페이지: "저장" 버튼이 지금까지 만든 AiceRun 전체를 작업기록(AiceRun v2
  // 목록)에 저장하고, 성공하면 작업기록 화면으로 넘어간다(onSaved).
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pendingFeedbackId, setPendingFeedbackId] = useState<string | null>(null);
  const saveInFlight = useRef(false);
  async function saveResultToRecords() {
    if (!token || saveInFlight.current || !evaluationComplete(state.evaluation)) return;
    saveInFlight.current = true;
    setSaveStatus("saving");
    setSaveError(null);
    try {
      assertAiceRun(snapshot);
      const title = state.intakePrompt?.trim() || `${state.llmCandidate?.name ?? "유약 실험"} 결과`;
      const record = await aiceRunsApi.create(token, { title, run: snapshot, request_id: state.runId, is_public: false });
      setSaveStatus("idle");
      if (record.feedback_status === "pending") setPendingFeedbackId(record.id);
      else onSaved?.();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "저장하지 못했습니다.");
      setSaveStatus("error");
    } finally {
      saveInFlight.current = false;
    }
  }

  async function retryFeedback() {
    if (!pendingFeedbackId || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaveStatus("saving");
    try {
      const record = await aiceRunsApi.retryFeedback(token, pendingFeedbackId);
      setSaveStatus("idle");
      if (record.feedback_status !== "pending") { setPendingFeedbackId(null); onSaved?.(); }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "보정을 다시 처리하지 못했습니다.");
      setSaveStatus("error");
    } finally { saveInFlight.current = false; }
  }

  useEffect(() => {
    if (!restoredRun) return;
    setSourceRun(restoredRun);
    setRestoredUnchanged(true);
    const candidate = restoredRun.intake?.candidates.candidates.find((item) => item.id === restoredRun.recipe.id);
    const selected = restoredRun.curves.candidates.find((curve) => curve.id === restoredRun.curves.selected_id);
    const toSeries = (curve: typeof restoredRun.curves.baseline, role: "baseline" | "adjusted"): CurveSeries => ({ id: curve.id, role, label: role === "baseline" ? "기준 계획" : "저장된 실행 계획", sourceType: curve.source_type, reason: curve.reason, points: curve.points.map((point) => ({ minute: point.minute, temperatureC: point.temperature_c })) });
    setState({
      ...initialState,
      runId: restoredRun.run_id,
      recipe: restoredRun.recipe.id,
      llmCandidate: candidate,
      intakePrompt: restoredRun.intake?.prompt_text,
      intakeCandidates: restoredRun.intake?.candidates.candidates ?? [],
      ware: restoredRun.ware.preset,
      clayBody: restoredRun.ware.clay_body as PrototypeState["clayBody"],
      beforeWeightG: restoredRun.application.before_weight.value?.toString() ?? "",
      afterWeightG: restoredRun.application.after_weight.value?.toString() ?? "",
      specificGravity: restoredRun.application.density.value?.toString() ?? "",
      glazingMethod: ({ dipping: "담금", pouring: "부기", brushing: "붓칠", spraying: "분무" })[restoredRun.application.method],
      dipSeconds: restoredRun.application.dip_seconds?.toString() ?? "",
      dryingComplete: restoredRun.application.drying_complete ?? false,
      riskMitigationApplied: Boolean(selected),
      sensorPlan: restoredRun.loading.sensor_plan,
      sensors: restoredRun.loading.sensors.map((sensor) => ({ id: sensor.id, heightRatio: sensor.height_ratio, target: "복원 센서", blindSpot: "저장 기록", limitation: sensor.temperature.note })),
      curveApproved: Boolean(selected),
      approvedCurves: selected ? [toSeries(restoredRun.curves.baseline, "baseline"), toSeries(selected, "adjusted")] : null,
      approvedControlSamples: restoredRun.pid.samples.map((sample) => ({ minute: sample.minute, plannedC: sample.planned_c, sensorC: sample.sensor_c, estimatedWareC: sample.estimated_ware_c, heaterPercent: sample.heater_percent, errorC: sample.planned_c - sample.sensor_c, alarm: null })),
      approvedControlParameters: restoredRun.pid.parameters,
      simulationCompleted: restoredRun.status !== "draft",
      result: restoredRun.result.match ?? undefined,
      evaluation: {
        match: restoredRun.result.match ?? null,
        color: restoredRun.result.color as ResultEvaluation["color"],
        gloss: restoredRun.result.gloss as ResultEvaluation["gloss"],
        texture: restoredRun.result.texture as ResultEvaluation["texture"],
        transparency: restoredRun.result.transparency as ResultEvaluation["transparency"],
        defects: restoredRun.result.defects,
        defectsReviewed: restoredRun.result.defects_reviewed ?? false,
        scope: restoredRun.result.feedback_scope ?? "personal",
        resultPhoto: restoredRun.result.photo?.data_url ? { dataUrl: restoredRun.result.photo.data_url, name: restoredRun.result.photo.alt } : null,
      },
    });
    setStep(restoredRun.status === "evaluated" ? 4 : restoredRun.status === "simulated" ? 3 : 0);
  }, [restoredRun]);

  useEffect(() => {
    onSnapshotReady?.(async () => snapshot);
  }, [onSnapshotReady, snapshot]);

  const updateInputs = (patch: Partial<PrototypeState>) => {
    setRestoredUnchanged(false);
    thicknessRequestId.current++;
    setThicknessProfile(null);
    setThicknessStatus("idle");
    setState((current) => ({ ...current, ...patch, riskMitigationApplied: false, curveApproved: false, approvedCurves: null, approvedControlSamples: [], approvedControlParameters: {}, simulationCompleted: false }));
  };

  const next = () => setStep((current) => Math.min(current + 1, screens.length - 1));
  const restart = () => {
    setSourceRun(undefined);
    setRestoredUnchanged(false);
    setState({ ...initialState, runId: crypto.randomUUID() });
    setThicknessProfile(null);
    setSaveStatus("idle");
    setSaveError(null);
    setPendingFeedbackId(null);
    setStep(0);
  };
  const canContinue = [
    true,
    Boolean(state.ware && state.clayBody && (state.ware !== "other" || state.customWareNote.trim())),
    state.riskMitigationApplied && thicknessStatus === "ready" && weightsReady,
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
            onSelect={(candidate, image) => updateInputs({
              recipe: candidate.id,
              llmCandidate: candidate,
              llmCandidateImage: image,
            })}
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
                {WARE_CATALOG.map((ware) => <ChoiceCard key={ware.id} title={ware.label} description={`${ware.size} · ${ware.glazing} 시유`} visual={ware.visual} selected={state.ware === ware.id} onClick={() => updateInputs({ ware: ware.id })} />)}
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
            <DensityCheck
              rho={state.specificGravity}
              onRhoChange={(value) => updateInputs({ specificGravity: value })}
              defaultTargetMm={recipeTargetThicknessMm}
              defaultTargetRho={recipeTargetRho}
              densityRange={densityRange}
            />
            <WeightInputs
              beforeG={state.beforeWeightG}
              afterG={state.afterWeightG}
              method={state.glazingMethod}
              dipSeconds={state.dipSeconds}
              onBeforeChange={(value) => updateInputs({ beforeWeightG: value })}
              onAfterChange={(value) => updateInputs({ afterWeightG: value })}
              onMethodChange={(value) => updateInputs({ glazingMethod: value })}
              onDipSecondsChange={(value) => updateInputs({ dipSeconds: value })}
              result={arealDensity}
              dryingComplete={state.dryingComplete}
              onDryingChange={(dryingComplete) => updateInputs({ dryingComplete })}
            />
            {thicknessStatus === "error" && <Alert tone="danger" title="두께 계산 오류">{thicknessError}</Alert>}
            <ThicknessSection ware={state.ware ?? "bowl"} profile={thicknessProfile} loading={thicknessStatus === "loading"} safeRangeMm={safeThicknessMm ?? DEFAULT_SAFE_RANGE_MM} />
            {/* v9 후속: 단일 "적용" 버튼 대신 지금 두께가 목표와 어떤
                관계인지 설명하고, 그에 맞는 행동을 사용자가 고르게 한다. */}
            <section className="thickness-decision" aria-labelledby="thickness-decision-heading">
              <h3 id="thickness-decision-heading">두께 판단과 다음 행동</h3>
              <Alert tone={computedCoating === "target" ? "unavailable" : "warning"} title={THICKNESS_DECISION_TITLE[computedCoating]}>
                {thicknessViewData.risk}
              </Alert>
              {/* v9 후속(2026-09-20): "이대로 진행하고 소성 계획으로 위험
                  줄이기" 버튼이 실제로 무엇을 하는지 문구만으로는 안 보여서
                  사용자가 하드코딩된 버튼처럼 느꼈다 — 실제로 계산된 조정
                  계획(curvePlan.buildCurveComparison)의 내용을 버튼을
                  누르기 전에 그대로 보여준다. */}
              {computedCoating !== "target" && (
                <Alert tone="unavailable" title="소성 계획이 이렇게 위험을 줄입니다">
                  {executionCurves[1].reason} {curveSummary(executionCurves)}
                </Alert>
              )}
              <div className="thickness-decision-actions">
                <button
                  type="button"
                  className="prototype-confirm"
                  disabled={thicknessStatus !== "ready" || !weightsReady}
                  aria-pressed={state.riskMitigationApplied}
                  onClick={() => setState({ ...state, riskMitigationApplied: true })}
                >
                  {computedCoating === "target" ? "이 상태로 소성 계획 확정하기" : "이대로 진행하고 소성 계획으로 위험 줄이기"}
                </button>
                {computedCoating !== "target" && (
                  <button
                    type="button"
                    className="act ghost"
                    onClick={() => updateInputs({ beforeWeightG: "", afterWeightG: "", dipSeconds: "", dryingComplete: false })}
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
            executionCurves={state.approvedCurves ?? executionCurves}
            riskMitigationApplied={state.riskMitigationApplied}
            onApprove={(decision, samples, parameters) => setState((current) => ({ ...current, curveApproved: decision === "accepted", approvedCurves: decision === "accepted" ? (current.approvedCurves ?? executionCurves) : null, simulationCompleted: decision === "accepted", approvedControlSamples: samples, approvedControlParameters: parameters }))}
            simulationCompleted={state.simulationCompleted}
            onSimulationStart={() => setState((current) => ({ ...current, simulationCompleted: true }))}
          />
        )}

        {step === 4 && (
          <>
            <ResultFeedback
              value={state.evaluation}
              onChange={(evaluation) => { setRestoredUnchanged(false); setState((current) => ({ ...current, evaluation, result: evaluation.match ?? undefined })); }}
              targetPhoto={state.llmCandidateImage}
            />
            {!evaluationComplete(state.evaluation) && <Alert tone="unavailable" title="평가 입력이 남아 있어요">전체 인상·광택·투명도를 선택하고 결함 확인을 완료해 주세요.</Alert>}
            {sourceRun?.status === "evaluated" && !restoredUnchanged && <Alert tone="warning" title="완료된 회차는 수정할 수 없어요">새 회차를 시작해 새 관측을 남겨 주세요. 기존 관측은 중복 학습하지 않습니다.</Alert>}
            {pendingFeedbackId && <Alert tone="warning" title="기록은 저장됐고 보정은 처리 대기 중이에요"><button type="button" disabled={saveStatus === "saving"} onClick={() => void retryFeedback()}>보정 다시 처리</button><button type="button" onClick={onSaved}>작업기록으로 이동</button></Alert>}
            {state.result && (
              <>
                {saveStatus === "error" && <Alert tone="danger" title="저장하지 못했어요">{saveError}</Alert>}
                {!token && <Alert tone="unavailable" title="로그인이 필요해요">로그인하면 작업기록에 저장할 수 있습니다.</Alert>}
                <button type="button" className="prototype-confirm" disabled={!token || saveStatus === "saving" || Boolean(pendingFeedbackId) || !evaluationComplete(state.evaluation) || (sourceRun?.status === "evaluated" && !restoredUnchanged)} onClick={() => void saveResultToRecords()}>
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
