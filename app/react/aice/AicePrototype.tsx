import { useEffect, useMemo, useState } from "react";
import type { SimulatorProps, SimulatorSnapshot } from "../Simulator";
import { Alert, AsyncState, DetailDrawer, ExplanationPanel, ProgressHeader, StateGallery, StatusBadge } from "./ui";
import { sampleAiceRun } from "./contract";
import { CLAY_BODIES, RECIPE_CANDIDATES, SOURCE_LABELS, WARE_CATALOG, type RecipeId, type WarePreset } from "./catalog";
import { ThicknessSection } from "./ThicknessSection";
import { buildThicknessView, type CoatingPreset } from "./thicknessView";

type Goal = "satin-blue" | "clear-warm" | "matte-white";

type PrototypeState = {
  goal?: Goal;
  recipe?: RecipeId;
  ware?: WarePreset;
  clayBody?: (typeof CLAY_BODIES)[number]["id"];
  customWareNote: string;
  customSilhouette: "round" | "tall" | "flat";
  coating?: CoatingPreset;
  coatingConfirmed: boolean;
  sensorPlan?: "single" | "three";
  curveApproved: boolean;
  simulationCompleted: boolean;
  result?: "close" | "different";
};

const initialState: PrototypeState = {
  customWareNote: "",
  customSilhouette: "round",
  coatingConfirmed: false,
  curveApproved: false,
  simulationCompleted: false,
};

const screens = [
  "홈",
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
  ["한 번의 가상 실험을 시작해요", "사진과 쉬운 선택으로 끝까지 안내합니다."],
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

function Guidance({ reason, assumption, next }: { reason: string; assumption: string; next: string }) {
  return <ExplanationPanel reason={reason} assumption={assumption} next={next} />;
}

export function AicePrototype({ onSnapshotReady }: SimulatorProps) {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<PrototypeState>(initialState);

  const snapshot = useMemo<SimulatorSnapshot>(() => {
    const run = sampleAiceRun();
    const goal = state.goal === "clear-warm"
      ? { gloss: "gloss" as const, transparency: "transparent" as const, color: "#c7aa7d", texture: "smooth" }
      : state.goal === "matte-white"
        ? { gloss: "matte" as const, transparency: "opaque" as const, color: "#e7e5de", texture: "soft" }
        : run.goal;
    const thicknessView = buildThicknessView({ ware: state.ware ?? "bowl", coating: state.coating ?? "target", evidence: "mass_only", meanMm: null });
    return {
      ...run,
      status: state.result ? "evaluated" : state.simulationCompleted ? "simulated" : "draft",
      revision: step + 1,
      goal,
      recipe: { ...run.recipe, id: state.recipe ?? run.recipe.id, name: RECIPE_CANDIDATES.find((item) => item.id === state.recipe)?.name ?? run.recipe.name },
      ware: { ...run.ware, preset: state.ware ?? run.ware.preset, clay_body: state.clayBody ?? run.ware.clay_body },
      loading: { ...run.loading, sensor_plan: state.sensorPlan ?? run.loading.sensor_plan },
      thickness: { ...run.thickness, warning: `${run.thickness.warning} · ${thicknessView.risk}` },
      curves: { ...run.curves, candidates: run.curves.candidates.map((curve) => ({ ...curve, reason: thicknessView.curveReason })), selected_id: state.curveApproved ? run.curves.selected_id : null },
      result: { ...run.result, gloss: state.result, feedback_scope: state.result ? "personal" : null },
    };
  }, [state, step]);

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
            <div className="prototype-hero" aria-hidden="true"><span>9단계</span></div>
            <p><strong>초보자용 샘플 실험</strong></p>
            <p>사틴 청색 목표와 사발 예시로 추천, 도포, 가상 소성, 결과 기록을 체험합니다.</p>
            <AsyncState kind="empty" />
            <DetailDrawer summary="화면 상태 예시"><StateGallery /></DetailDrawer>
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
            <div className="prototype-grid recipe-grid">
              {RECIPE_CANDIDATES.map((candidate) => (
                <article className="recipe-card" key={candidate.id}>
                  <button type="button" className="prototype-choice" aria-pressed={state.recipe === candidate.id} onClick={() => setState({ ...state, recipe: candidate.id })}>
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
            <DetailDrawer><p>이 프로토타입은 출처가 있는 규칙과 합성 예시만 사용합니다. 배합 수치는 다음 Phase의 데이터 계약 뒤 연결합니다.</p></DetailDrawer>
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
            <ThicknessSection ware={state.ware ?? "bowl"} coating={state.coating ?? "target"} evidence="mass_only" />
            <Guidance reason={buildThicknessView({ ware: state.ware ?? "bowl", coating: state.coating ?? "target", meanMm: null }).risk} assumption="실제 무게·면적·건조밀도가 없어 평균은 판정 불가이며 위치별 값은 형상 기반 합성 분포입니다." next="단면과 위험 문장을 확인하고 적재 화면으로 이동하세요." />
            <button type="button" className="prototype-confirm" disabled={!state.coating} aria-pressed={state.coatingConfirmed} onClick={() => setState({ ...state, coatingConfirmed: true })}>가상 분포와 위험을 확인했어요</button>
          </>
        )}

        {step === 5 && (
          <>
            <div className="prototype-kiln" role="img" aria-label="선반 세 단과 기물이 있는 가상 전기가마 종단면">
              <span className="kiln-sensor top">센서</span><span className="kiln-shelf top" />
              <span className="kiln-sensor middle">센서</span><span className="kiln-shelf middle" />
              <span className="kiln-sensor bottom">센서</span><span className="kiln-shelf bottom" />
            </div>
            <div className="prototype-grid compact">
              <ChoiceCard title="기본 1개" description="중앙을 대표 · 상하 사각지대 큼" visual="sensor-one" selected={state.sensorPlan === "single"} onClick={() => setState({ ...state, sensorPlan: "single" })} />
              <ChoiceCard title="상·중·하 3개" description="층별 편차 관찰 · 합성 센서" visual="sensor-three" selected={state.sensorPlan === "three"} onClick={() => setState({ ...state, sensorPlan: "three" })} />
            </div>
            <Alert tone="unavailable" title="합성 시뮬레이션">센서와 열 분포는 실제 가마 측정이 아닙니다.</Alert>
          </>
        )}

        {step === 6 && (
          <>
            <div className="prototype-curves" role="img" aria-label="기준 계획과 두께 반영 수정 계획 비교 그래프">
              <span className="curve baseline">기준 계획</span>
              <span className="curve adjusted">두께 반영 수정 계획</span>
              <span className="curve-note">완만한 승온 후보</span>
            </div>
            <Guidance reason="형상 기반 가상 분포에서 바닥 쪽 상대 두께가 커 보입니다." assumption="미정 계수의 기본값을 만들지 않고 설명용 후보만 비교합니다." next="후보를 승인하면 가상 제어기에만 전달됩니다." />
            <button type="button" className="prototype-confirm" aria-pressed={state.curveApproved} onClick={() => setState({ ...state, curveApproved: true })}>이 후보로 가상 소성 준비</button>
            <DetailDrawer summary="제어 상세 보기"><p>현재 화면은 PID 수치 입력이 아닌 설명용 계획입니다. 실제 가마 제어와 품질 보장을 제공하지 않습니다.</p></DetailDrawer>
          </>
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
          <>
            <div className="prototype-result-compare">
              <div><span className="result-swatch target" /><strong>목표</strong></div>
              <div><span className="result-swatch simulated" /><strong>합성 결과</strong></div>
            </div>
            <div className="prototype-grid compact">
              <ChoiceCard title="목표에 가까워요" description="개인 기록에만 반영" visual="result-close" selected={state.result === "close"} onClick={() => setState({ ...state, result: "close" })} />
              <ChoiceCard title="차이가 있어요" description="다음 후보 제안에 연결" visual="result-different" selected={state.result === "different"} onClick={() => setState({ ...state, result: "different" })} />
            </div>
            {state.result && <Guidance reason="이번 합성 결과와 선택한 평가를 함께 기록합니다." assumption="실제 소성 품질이나 재현성을 검증한 결과가 아닙니다." next="새 샘플을 시작하거나 기록 화면에서 스냅샷을 확인하세요." />}
          </>
        )}
      </main>

      <footer className="prototype-actions">
        {step > 0 && step < 8 && <button type="button" className="act ghost" onClick={() => setStep(step - 1)}>이전</button>}
        {step < 8 && <button type="button" className="act next" disabled={!canContinue} onClick={next}>{step === 0 ? "샘플 실험 시작" : "다음"}<span aria-hidden="true">→</span></button>}
        {step === 8 && <button type="button" className="act next" disabled={!state.result} onClick={restart}>새 샘플 시작<span aria-hidden="true">↻</span></button>}
      </footer>
    </div>
  );
}
