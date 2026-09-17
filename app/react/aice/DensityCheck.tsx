import { useState } from "react";
import { ApiError, kilnBatchApi, type DipTimeResponse } from "../lib/api";
import { Alert } from "./ui";
import { assessDensity, type DensityAdvice } from "./densityAdvice";

const ALERT_TONE: Record<DensityAdvice["status"], "warning" | "danger" | "unavailable"> = {
  ok: "unavailable",
  too_thin: "warning",
  too_thick: "warning",
  out_of_range: "danger",
};

export function DensityCheck() {
  const [rho, setRho] = useState("");
  const [minutes, setMinutes] = useState("0");
  const [advice, setAdvice] = useState<DensityAdvice | null>(null);
  const [targetMm, setTargetMm] = useState("1.0");
  const [dipTime, setDipTime] = useState<DipTimeResponse | null>(null);
  const [dipTimeStatus, setDipTimeStatus] = useState<"idle" | "loading" | "error">("idle");
  const [dipTimeError, setDipTimeError] = useState<string | null>(null);

  const parsedRho = Number(rho);
  const rhoValid = rho.trim() !== "" && Number.isFinite(parsedRho) && parsedRho > 1;
  const parsedTarget = Number(targetMm);
  const targetValid = targetMm.trim() !== "" && Number.isFinite(parsedTarget) && parsedTarget > 0;

  const check = () => {
    if (!rhoValid) return;
    const parsedMinutes = Number(minutes);
    setAdvice(assessDensity(parsedRho, Number.isFinite(parsedMinutes) ? parsedMinutes : 0));
  };

  const suggestDipTime = async () => {
    if (!rhoValid || !targetValid) return;
    setDipTimeStatus("loading");
    setDipTimeError(null);
    try {
      const result = await kilnBatchApi.dipTime(parsedTarget, parsedRho);
      setDipTime(result);
      setDipTimeStatus("idle");
    } catch (err) {
      setDipTimeError(err instanceof ApiError ? err.message : "담금시간을 계산하지 못했습니다.");
      setDipTimeStatus("error");
    }
  };

  return (
    <section className="density-check" aria-labelledby="density-check-title">
      <h3 id="density-check-title">비중 확인</h3>
      <div className="density-check-fields">
        <label htmlFor="density-check-rho">비중(ρ)<input id="density-check-rho" type="number" step="0.01" min="1.01" placeholder="예: 1.45" value={rho} onChange={(event) => setRho(event.target.value)} /></label>
        <label htmlFor="density-check-minutes">교반 후 경과(분)<input id="density-check-minutes" type="number" step="1" min="0" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
        <button type="button" className="act ghost" disabled={!rhoValid} onClick={check}>비중 확인하기</button>
      </div>
      {advice && (
        <Alert tone={ALERT_TONE[advice.status]} title={`${advice.statusLabel} · ${advice.message}`}>
          {advice.annotation}{advice.remeasureRecommended ? " · 재측정 권장" : ""}
        </Alert>
      )}
      <p className="density-check-note">이 판정은 진행을 막지 않는 참고 안내이며, kiln.batch의 비중 경고 로직(6-4절)과 같은 기준을 프런트엔드에서 재현합니다.</p>

      <h4>담금시간 역산 (06절)</h4>
      <div className="density-check-fields">
        <label htmlFor="dip-target-mm">목표 평균 두께(mm)<input id="dip-target-mm" type="number" step="0.05" min="0.05" value={targetMm} onChange={(event) => setTargetMm(event.target.value)} /></label>
        <button type="button" className="act ghost" disabled={!rhoValid || !targetValid || dipTimeStatus === "loading"} onClick={suggestDipTime}>
          {dipTimeStatus === "loading" ? "계산 중…" : "권장 담금시간 계산"}
        </button>
      </div>
      {dipTimeStatus === "error" && <Alert tone="danger" title="계산 오류">{dipTimeError}</Alert>}
      {dipTime && (
        dipTime.feasible ? (
          <Alert tone="unavailable" title={`권장 담금시간 ${dipTime.seconds.toFixed(1)}초`}>
            이 비중으로 목표 두께 근처(예상 {dipTime.predicted_mean_mm.toFixed(2)}mm)에 도달합니다 — kiln.batch.dip_time.recommend_dip_time(6-1절) 그대로.
          </Alert>
        ) : (
          <Alert tone="danger" title="이 조건으로는 도달할 수 없습니다">{dipTime.reason}</Alert>
        )
      )}
    </section>
  );
}
