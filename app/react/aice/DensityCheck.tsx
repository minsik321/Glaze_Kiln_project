import { useEffect, useState } from "react";
import { ApiError, kilnBatchApi, type DipTimeResponse } from "../lib/api";
import { Alert } from "./ui";
import { assessDensity, type DensityAdvice } from "./densityAdvice";

const ALERT_TONE: Record<DensityAdvice["status"], "warning" | "danger" | "unavailable"> = {
  ok: "unavailable",
  too_thin: "warning",
  too_thick: "warning",
  out_of_range: "danger",
};

export function DensityCheck({
  rho,
  onRhoChange,
  defaultTargetMm,
  defaultTargetRho,
  densityRange,
  onDipTimeReady,
  onProgressReset,
}: {
  //: v9 후속: 비중 실측값을 이 화면 안에서만 들고 있지 않는다 — 부모
  //: (AicePrototype.tsx)가 끌어올려 두께 계산(`/kiln/thickness/profile`의
  //: `specific_gravity`)과 저장 기록(`application.density`)에도 같은 값을
  //: 쓴다. 이전에는 여기 로컬 상태였던 탓에 사용자가 입력한 비중이 두께
  //: 계산에도, 저장에도 전달되지 않고 이 화면의 판정 문구에만 쓰였다.
  rho: string;
  onRhoChange: (value: string) => void;
  defaultTargetMm?: number;
  //: 이 레시피의 목표 비중(AicePrototype.tsx의 recipeTargetRho) — 실측
  //: 범위가 있으면 그 중앙값, 없으면 문헌 기본 범위([1.4, 1.5])의
  //: 중앙값. 입력칸(ρ)을 이 값으로 덮어쓰지 않고 안내 문구로만 보여준다
  //: — 입력칸은 실제 측정값을 받는 자리다.
  defaultTargetRho?: number;
  //: 이 레시피로 실제 시유에 쓴 비중 실측값의 누적 범위
  //: (`kiln.calibration.density`, `GET /aice/calibration/{recipe_id}`의
  //: `specific_gravity_range`). 관측이 아직 없으면 `null`이고, 이때는
  //: `assessDensity`의 문헌 기본 범위([1.4, 1.5])가 그대로 쓰인다.
  densityRange?: readonly [number, number] | null;
  onDipTimeReady?: (seconds: number) => void;
  onProgressReset?: () => void;
}) {
  const [minutes, setMinutes] = useState("");
  const [advice, setAdvice] = useState<DensityAdvice | null>(null);
  //: v9 후속: "레시피상 유약 두께를 목표 평균 두께로 설정" — 목표 두께를
  //: 빈 칸에서 직접 타이핑하게 하지 않고, 현재 레시피의 계산된 목표
  //: 두께(AicePrototype.tsx가 계산해 넘긴다)를 채운다. 사용자는 여전히
  //: 이 값을 직접 바꿀 수 있다.
  //:
  //: 2026-09-20 수정: 예전엔 useState 초기값으로만 한 번 받아서, 로그인
  //: 직후(레시피별 계산이 아직 안 끝난 시점)에 찍힌 값이 그대로 굳어
  //: 있었다 — 계산이 끝나도, 레시피를 바꿔도 화면이 안 바뀌어 마치
  //: 하드코딩된 것처럼 보였다. defaultTargetMm이 바뀔 때마다 다시
  //: 채운다.
  const [targetMm, setTargetMm] = useState(String(defaultTargetMm ?? 1.0));
  useEffect(() => {
    if (defaultTargetMm != null) setTargetMm(String(defaultTargetMm));
  }, [defaultTargetMm]);
  const [dipTime, setDipTime] = useState<DipTimeResponse | null>(null);
  const [dipTimeStatus, setDipTimeStatus] = useState<"idle" | "loading" | "error">("idle");
  const [dipTimeError, setDipTimeError] = useState<string | null>(null);

  const parsedRho = Number(rho);
  const rhoValid = rho.trim() !== "" && Number.isFinite(parsedRho) && parsedRho > 1;
  const parsedMinutes = Number(minutes);
  const minutesValid = minutes.trim() !== "" && Number.isFinite(parsedMinutes) && parsedMinutes >= 0;
  const parsedTarget = Number(targetMm);
  const targetValid = targetMm.trim() !== "" && Number.isFinite(parsedTarget) && parsedTarget > 0;

  const check = () => {
    if (!rhoValid || !minutesValid) return;
    setAdvice(
      densityRange
        ? assessDensity(parsedRho, Number.isFinite(parsedMinutes) ? parsedMinutes : 0, [...densityRange])
        : assessDensity(parsedRho, Number.isFinite(parsedMinutes) ? parsedMinutes : 0),
    );
  };

  const suggestDipTime = async () => {
    if (!rhoValid || !targetValid) return;
    setDipTimeStatus("loading");
    setDipTimeError(null);
    try {
      const result = await kilnBatchApi.dipTime(parsedTarget, parsedRho);
      setDipTime(result);
      if (result.feasible) onDipTimeReady?.(result.seconds);
      setDipTimeStatus("idle");
    } catch (err) {
      setDipTimeError(err instanceof ApiError ? err.message : "담금시간을 계산하지 못했습니다.");
      setDipTimeStatus("error");
    }
  };

  return (
    <section className="density-check" aria-labelledby="density-check-title">
      <h3 id="density-check-title">유약 비중을 입력해요</h3>
      {typeof defaultTargetRho === "number" && (
        <p className="density-check-hint">
          권장 비중 약 {defaultTargetRho.toFixed(2)}
          {densityRange ? " · 개인 실측 이력 기준" : " · 기본 권장값"}
        </p>
      )}
      <div className="density-check-fields">
        <label htmlFor="density-check-rho">교반 후<input id="density-check-rho" type="number" step="0.01" min="1.01" placeholder="예: 1.45" value={rho} onChange={(event) => { onRhoChange(event.target.value); setAdvice(null); setDipTime(null); onProgressReset?.(); }} /></label>
        <label htmlFor="density-check-minutes">교반 후 경과(분)<input id="density-check-minutes" type="number" step="1" min="0" placeholder="예: 5" value={minutes} onChange={(event) => { setMinutes(event.target.value); setAdvice(null); setDipTime(null); onProgressReset?.(); }} /></label>
        <button type="button" className="act ghost" disabled={!rhoValid || !minutesValid} onClick={check}>비중 확인</button>
      </div>
      {advice && (
        <Alert tone={ALERT_TONE[advice.status]} title={`${advice.statusLabel} · ${advice.message}`}>
          {advice.annotation}{advice.remeasureRecommended ? " · 재측정 권장" : ""}
        </Alert>
      )}
      {advice && <div className="density-target-step progressive-field">
        <h3>목표 평균 시유 두께를 확인해요</h3>
        <div className="density-check-fields">
          <label htmlFor="dip-target-mm">목표 평균 두께(mm)<input id="dip-target-mm" type="number" step="0.05" min="0.05" value={targetMm} onChange={(event) => { setTargetMm(event.target.value); setDipTime(null); onProgressReset?.(); }} /></label>
          <button type="button" className="act ghost" disabled={!rhoValid || !targetValid || dipTimeStatus === "loading"} onClick={suggestDipTime}>
            {dipTimeStatus === "loading" ? "계산 중…" : "담금시간 계산"}
          </button>
        </div>
      </div>}
      {dipTimeStatus === "error" && <Alert tone="danger" title="계산 오류">{dipTimeError}</Alert>}
      {dipTime && (
        dipTime.feasible ? (
          <Alert tone="unavailable" title={`권장 담금시간 ${dipTime.seconds.toFixed(1)}초`}>
            예상 평균 두께 {dipTime.predicted_mean_mm.toFixed(2)}mm
          </Alert>
        ) : (
          <Alert tone="danger" title="이 조건으로는 도달할 수 없습니다">{dipTime.reason}</Alert>
        )
      )}
    </section>
  );
}
