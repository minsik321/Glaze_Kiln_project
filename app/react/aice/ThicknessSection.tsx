import type { WarePreset } from "./catalog";
import type { ThicknessComputeResponse } from "../lib/api";
import { SECTION_ASSETS, buildThicknessView, type ThicknessStatus } from "./thicknessView";
import { Alert, AsyncState, StatusBadge } from "./ui";

const STATUS_LABELS: Record<ThicknessStatus, string> = { thin: "얇음", target: "목표 근처", thick: "두꺼움", unavailable: "판정 불가" };

export function ThicknessSection({ ware, profile, loading = false, safeRangeMm }: { ware: WarePreset; profile: ThicknessComputeResponse | null; loading?: boolean; safeRangeMm?: readonly [number, number] }) {
  const asset = SECTION_ASSETS[ware];
  const view = buildThicknessView({ ware, profile, safeRangeMm });
  //: mm 평균과 g/m² 면적당 시유량은 같은 compute_profile 응답에서 함께
  //: 나온다(둘 다 실측 무게 기반). g/m²은 ρ_dry 가정에 기대지 않는
  //: 불변량이라 우선 표시한다(§5-a).
  const primaryLabel = profile !== null ? `${view.mean.label} · ${profile.areal_density_g_m2.toFixed(0)} g/m²` : view.mean.label;
  const primaryTone = profile !== null ? "info" : "unavailable";
  return (
    <section className="thickness-section" aria-labelledby="thickness-title">
      <div className="thickness-summary"><h3 id="thickness-title">유약 두께 종단면</h3><StatusBadge tone={primaryTone}>{primaryLabel}</StatusBadge></div>
      {loading && <AsyncState kind="loading" />}
      <svg viewBox="0 0 200 130" role="img" aria-label={`유약 두께 종단면. ${view.positionClaim}. ${view.risk}`}>
        <defs>
          <pattern id="pattern-thin" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 6 6 0" /></pattern>
          <pattern id="pattern-target" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="3.5" cy="3.5" r="1.4" /></pattern>
          <pattern id="pattern-thick" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 0 6 6M6 0 0 6" /></pattern>
          <pattern id="pattern-unavailable" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 4H8" /></pattern>
        </defs>
        <path className="section-body" d={asset.bodyPath} />
        {asset.glazePaths.map((path, index) => <path key={path} className={`glaze-segment ${view.segments[index].status}`} d={path} aria-label={`${view.segments[index].label}: ${STATUS_LABELS[view.segments[index].status]}`} />)}
        {asset.callouts.map((callout, index) => <g className="section-callout" key={`${callout.label}-${index}`}><circle cx={callout.x} cy={callout.y} r="3" /><path d={`M${callout.x} ${callout.y} L${callout.x < 100 ? 10 : 190} ${Math.max(12, callout.y - 12)}`} /><text x={callout.x < 100 ? 8 : 192} y={Math.max(10, callout.y - 14)} textAnchor={callout.x < 100 ? "start" : "end"}>{callout.label}</text></g>)}
      </svg>
      <div className="thickness-legend" aria-label="두께 상태 범례">{(["thin", "target", "thick", "unavailable"] as const).map((status) => <span key={status}><i className={status} aria-hidden="true" />{STATUS_LABELS[status]}</span>)}</div>
      <p className="position-evidence"><strong>{view.positionClaim}</strong> · {view.uncertainty}</p>
      <Alert tone="unavailable" title="과장 표시">두께 표현은 이해를 위해 과장됨</Alert>
      <ul className="section-callout-list">{asset.callouts.map((callout, index) => <li key={`${callout.label}-${index}`}><strong>{callout.label}</strong> — {callout.reason}</li>)}</ul>
      <p className="risk-sentence">{view.risk}</p>
    </section>
  );
}
