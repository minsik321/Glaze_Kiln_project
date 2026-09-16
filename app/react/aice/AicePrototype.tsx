import { useEffect, useMemo, useState } from "react";
import type { SimulatorProps, SimulatorSnapshot } from "../Simulator";

type Goal = "satin-blue" | "clear-warm" | "matte-white";
type Recipe = "coastal-satin" | "warm-clear" | "soft-matte";
type Ware = "bowl" | "plate" | "mug";

type PrototypeState = {
  goal?: Goal;
  recipe?: Recipe;
  ware?: Ware;
  coatingConfirmed: boolean;
  sensorPlan?: "single" | "three";
  curveApproved: boolean;
  simulationCompleted: boolean;
  result?: "close" | "different";
};

const initialState: PrototypeState = {
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
  return (
    <section className="prototype-guidance" aria-label="추천 안내">
      <p><strong>왜 이 후보인지</strong>{reason}</p>
      <p><strong>무엇이 가정인지</strong>{assumption}</p>
      <p><strong>다음 행동</strong>{next}</p>
    </section>
  );
}

export function AicePrototype({ onSnapshotReady }: SimulatorProps) {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<PrototypeState>(initialState);

  const snapshot = useMemo<SimulatorSnapshot>(() => ({
    schema_version: 0,
    prototype: true,
    step,
    ...state,
    safety: {
      simulation_only: true,
      quality_guaranteed: false,
      real_kiln_control: false,
    },
  }), [state, step]);

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
    Boolean(state.ware),
    state.coatingConfirmed,
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
        <span className="simulation-badge">데모 · 시뮬레이션 전용</span>
      </header>

      <nav className="prototype-progress" aria-label="가상 실험 진행 단계">
        <span>{step + 1} / {screens.length}</span>
        <ol>
          {screens.map((screen, index) => (
            <li key={screen} aria-current={index === step ? "step" : undefined}>
              <span className="visually-hidden">{screen}</span>
            </li>
          ))}
        </ol>
      </nav>

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
            <div className="prototype-empty" role="status">지난 실행이 아직 없습니다.</div>
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
            <div className="prototype-grid">
              <ChoiceCard title="해안 사틴 01" description="목표와 가장 가까운 규칙 기반 후보" visual="recipe-blue" selected={state.recipe === "coastal-satin"} onClick={() => setState({ ...state, recipe: "coastal-satin" })} />
              <ChoiceCard title="웜 클리어 02" description="투명도가 높고 광택 차이가 큼" visual="recipe-clear" selected={state.recipe === "warm-clear"} onClick={() => setState({ ...state, recipe: "warm-clear" })} />
              <ChoiceCard title="소프트 매트 03" description="광택은 낮지만 색상 사례가 가까움" visual="recipe-white" selected={state.recipe === "soft-matte"} onClick={() => setState({ ...state, recipe: "soft-matte" })} />
            </div>
            <Guidance reason="선택한 광택·투명도와 규칙 점수가 가장 가깝습니다." assumption="사진 자리는 색상·질감 플레이스홀더이며 예상 실물 사진이 아닙니다." next="후보 하나를 선택하고 기물 모양을 고르세요." />
            <details><summary>상세 보기</summary><p>이 프로토타입은 출처가 있는 규칙과 합성 예시만 사용합니다. 배합 수치는 다음 Phase의 데이터 계약 뒤 연결합니다.</p></details>
          </>
        )}

        {step === 3 && (
          <div className="prototype-grid">
            <ChoiceCard title="사발" description="중간 크기 · 안/밖 시유" visual="ware-bowl" selected={state.ware === "bowl"} onClick={() => setState({ ...state, ware: "bowl" })} />
            <ChoiceCard title="접시" description="넓은 평면 · 윗면 시유" visual="ware-plate" selected={state.ware === "plate"} onClick={() => setState({ ...state, ware: "plate" })} />
            <ChoiceCard title="컵/머그" description="중간 크기 · 안/밖 시유" visual="ware-mug" selected={state.ware === "mug"} onClick={() => setState({ ...state, ware: "mug" })} />
          </div>
        )}

        {step === 4 && (
          <>
            <div className="prototype-section-figure" role="img" aria-label="사발의 형상 기반 가상 유약 단면">
              <div className="section-glaze"><span>상단 얇음</span><span>바닥 상대적으로 두꺼움</span></div>
            </div>
            <p className="prototype-caution">두께 표현은 이해를 위해 과장됨 · 위치별 분포는 형상 기반 가상 분포</p>
            <Guidance reason="선택한 대표 기물의 표면 구간을 비교합니다." assumption="실측 위치 데이터가 없어 평균 경향만 추정합니다." next="가상 분포를 확인하고 적재 화면으로 이동하세요." />
            <button type="button" className="prototype-confirm" aria-pressed={state.coatingConfirmed} onClick={() => setState({ ...state, coatingConfirmed: true })}>가상 분포를 확인했어요</button>
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
            <p className="prototype-caution">센서와 열 분포는 합성 시뮬레이션이며 실제 가마 측정이 아닙니다.</p>
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
            <details><summary>제어 상세 보기</summary><p>현재 화면은 PID 수치 입력이 아닌 설명용 계획입니다. 실제 가마 제어와 품질 보장을 제공하지 않습니다.</p></details>
          </>
        )}

        {step === 7 && (
          <>
            <div className="prototype-firing" aria-live="polite">
              <span className={state.simulationCompleted ? "complete" : "idle"}>{state.simulationCompleted ? "가상 소성 완료" : "가상 가마 준비됨"}</span>
              <div className="heat-field" aria-hidden="true" />
            </div>
            <button type="button" className="prototype-confirm" onClick={() => setState({ ...state, simulationCompleted: true })}>가상 소성 재생</button>
            <p className="prototype-caution">설명용 근사 · 실제 센서 및 가마 제어 연결 없음</p>
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

