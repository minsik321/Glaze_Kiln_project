import { useState } from "react";
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

  const parsedRho = Number(rho);
  const rhoValid = rho.trim() !== "" && Number.isFinite(parsedRho) && parsedRho > 1;

  const check = () => {
    if (!rhoValid) return;
    const parsedMinutes = Number(minutes);
    setAdvice(assessDensity(parsedRho, Number.isFinite(parsedMinutes) ? parsedMinutes : 0));
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
    </section>
  );
}
