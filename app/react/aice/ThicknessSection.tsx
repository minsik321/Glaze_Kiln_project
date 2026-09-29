import type { WarePreset } from "./catalog";
import type { ThicknessComputeResponse } from "../lib/api";
import { SECTION_ASSETS, buildThicknessView, type ThicknessStatus } from "./thicknessView";
import { AsyncState } from "./ui";

const STATUS_LABELS: Record<ThicknessStatus, string> = { thin: "얇음", target: "목표 근처", thick: "두꺼움", unavailable: "판정 불가" };

export function ThicknessSection({ ware, profile, loading = false, safeRangeMm }: { ware: WarePreset; profile: ThicknessComputeResponse | null; loading?: boolean; safeRangeMm?: readonly [number, number] }) {
  const asset = SECTION_ASSETS[ware];
  const view = buildThicknessView({ ware, profile, safeRangeMm });
  const judgment = view.overallStatus === "thick"
    ? "목표보다 두꺼워요"
    : view.overallStatus === "thin"
      ? "목표보다 얇아요"
      : view.overallStatus === "target"
        ? "목표 범위에 적절해요"
        : "아직 판단할 수 없어요";
  return (
    <section className="thickness-section" aria-labelledby="thickness-title">
      <div className="thickness-summary"><h3 id="thickness-title">유약 두께 종단면을 확인해요</h3></div>
      {loading && <AsyncState kind="loading" />}
      <svg viewBox="0 0 200 130" role="img" aria-label={`유약 두께 종단면. ${judgment}`}>
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
      <p className={`thickness-judgment ${view.overallStatus}`}><strong>판단 결과</strong><span>{judgment}</span></p>
      {profile && <p className="thickness-measurement">평균 {profile.mean_mm.toFixed(2)}mm · {profile.areal_density_g_m2.toFixed(0)}g/m²</p>}
    </section>
  );
}
