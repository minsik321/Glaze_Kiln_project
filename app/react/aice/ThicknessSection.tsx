import { useId } from "react";
import type { WarePreset } from "./catalog";
import type { ThicknessComputeResponse } from "../lib/api";
import { DEFAULT_SAFE_RANGE_MM, SECTION_ASSETS, buildThicknessView } from "./thicknessView";
import { AsyncState } from "./ui";

//: 기물 선택 카드 실루엣(%)을 옮겨 그릴 SVG 안의 박스.
const BOX = { x: 20, y: 12, w: 160, h: 106 };
const SEGMENT_LENGTH = 3;

//: 높이 비율 h(0=굽, 1=구연부)에서의 두께 — profile.points(z 오름차순)를 선형 보간.
function thicknessAt(points: ThicknessComputeResponse["points"], h: number): number {
  const sorted = [...points].sort((p, q) => p.z - q.z);
  if (sorted.length === 1) return sorted[0].total;
  const zMin = sorted[0].z;
  const zSpan = sorted[sorted.length - 1].z - zMin || 1;
  const z = zMin + h * zSpan;
  for (let i = 1; i < sorted.length; i += 1) {
    if (z <= sorted[i].z) {
      const span = sorted[i].z - sorted[i - 1].z || 1;
      const f = (z - sorted[i - 1].z) / span;
      return sorted[i - 1].total + f * (sorted[i].total - sorted[i - 1].total);
    }
  }
  return sorted[sorted.length - 1].total;
}

//: 안전 범위 하한 이하 = 초록·가는 선, 상한 이상 = 빨강·굵은 선. 차이가 눈에 띄도록 과장한다.
function strokeFor(totalMm: number, [lo, hi]: readonly [number, number]) {
  const u = Math.min(1, Math.max(0, (totalMm - lo) / ((hi - lo) || 1)));
  //: 선은 기물 벽 아래에 깔리고 벽이 안쪽 절반을 덮으므로, 보이는 두께는 width의 절반이다.
  return { color: `hsl(${Math.round(120 * (1 - u))} 72% 42%)`, width: 3 + 8 * u };
}

export function ThicknessSection({ ware, profile, loading = false, safeRangeMm = DEFAULT_SAFE_RANGE_MM }: { ware: WarePreset; profile: ThicknessComputeResponse | null; loading?: boolean; safeRangeMm?: readonly [number, number] }) {
  const clipId = `glaze-above-foot-${useId().replace(/:/g, "")}`;
  const asset = SECTION_ASSETS[ware];
  const view = buildThicknessView({ ware, profile, safeRangeMm });
  const judgment = view.overallStatus === "thick"
    ? "목표보다 두꺼워요"
    : view.overallStatus === "thin"
      ? "목표보다 얇아요"
      : view.overallStatus === "target"
        ? "목표 범위에 적절해요"
        : "아직 판단할 수 없어요";
  const toPoint = ([px, py]: readonly [number, number]) => ({ x: BOX.x + (px / 100) * BOX.w, y: BOX.y + (py / 100) * BOX.h });
  const outline = asset.outline.map(toPoint);
  const yTop = Math.min(...outline.map((p) => p.y));
  const yBottom = Math.max(...outline.map((p) => p.y));
  const bodyPoints = outline.map((p) => `${p.x},${p.y}`).join(" ");
  const glaze: Array<{ key: string; x1: number; y1: number; x2: number; y2: number; color?: string; width?: number }> = [];
  for (let i = 0; i < outline.length - 1; i += 1) {
    const a = outline[i];
    const b = outline[i + 1];
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / SEGMENT_LENGTH));
    for (let j = 0; j < count; j += 1) {
      const p = { x: a.x + ((b.x - a.x) * j) / count, y: a.y + ((b.y - a.y) * j) / count };
      const q = { x: a.x + ((b.x - a.x) * (j + 1)) / count, y: a.y + ((b.y - a.y) * (j + 1)) / count };
      const entry = { key: `${i}-${j}`, x1: p.x, y1: p.y, x2: q.x, y2: q.y };
      if (profile && profile.points.length > 0) {
        const h = (yBottom - (p.y + q.y) / 2) / ((yBottom - yTop) || 1);
        const stroke = strokeFor(thicknessAt(profile.points, Math.min(1, Math.max(0, h))), safeRangeMm);
        glaze.push({ ...entry, ...stroke });
      } else {
        glaze.push(entry);
      }
    }
  }
  return (
    <section className="thickness-section" aria-labelledby="thickness-title">
      <div className="thickness-summary"><h3 id="thickness-title">유약 두께 종단면을 확인해요</h3></div>
      {loading && <AsyncState kind="loading" />}
      <svg viewBox="0 0 200 130" role="img" aria-label={`유약 두께 종단면. ${judgment}`}>
        <defs><clipPath id={clipId}><rect x="0" y="0" width="200" height={yBottom} /></clipPath></defs>
        <g clipPath={`url(#${clipId})`}>
        {glaze.map((g) => <line key={g.key} className={`glaze-segment${g.color ? "" : " unavailable"}`} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} style={g.color ? { stroke: g.color, strokeWidth: g.width } : undefined} />)}
        </g>
        <polygon className="section-body" points={bodyPoints} />
      </svg>
      {profile && <div className="thickness-scale" aria-hidden="true"><span>얇음 {safeRangeMm[0].toFixed(1)}mm</span><i /><span>두꺼움 {safeRangeMm[1].toFixed(1)}mm</span></div>}
      <p className={`thickness-judgment ${view.overallStatus}`}><strong>판단 결과</strong><span>{judgment}</span></p>
      {view.overallStatus === "thick" && (
        <p className="thickness-alert" role="alert">⚠ 유약이 너무 두껍게 발렸어요. 흘러내림 위험이 있으니 유약을 씻어내고 재시유하세요.</p>
      )}
      {profile && <p className="thickness-measurement">평균 {profile.mean_mm.toFixed(2)}mm · {profile.areal_density_g_m2.toFixed(0)}g/m²</p>}
    </section>
  );
}
