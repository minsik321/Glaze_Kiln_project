import type { WarePreset } from "./catalog";

// LLM 프런트도어 TODO Phase 3 — "시유 전/후 무게 → kiln.thickness 계산 →
// 화면에 g/m² 우선 표시".
//
// 진짜 면적 적분(`kiln.thickness.geometry.surface_area_m2`)은 실제 형태
// 프로파일(반지름·높이 점열)을 필요로 한다 — AICE 안내형 화면은 정밀 치수를
// 받지 않고 대표 형상만 고르게 하므로(§3, WARE_CATALOG) 그 적분을 그대로
// 쓸 수 없다. 대신 카탈로그 라벨과 자리수가 맞는 "대표 형상 기준 근사
// 표면적"을 문헌 추정 상수로 둔다 — 이 근사치는 다른 형상 기반 판정
// (thicknessView.ts, kilnSimulation.ts)과 같은 수준의 단순화다. 실측 면적이
// 아니므로 g/m² 계산 결과의 source_type은 "inferred"로 남긴다(무게 자체는
// 사용자가 입력한 값이므로 "observed").
export const REPRESENTATIVE_AREA_M2: Record<WarePreset, number> = {
  bowl: 0.045,
  plate: 0.06,
  mug: 0.035,
  cylinder_vase: 0.09,
  bottle: 0.05,
  tile: 0.02,
  other: 0.045,
};

export type ArealDensityResult = {
  glazeWeightG: number;
  areaM2: number;
  gramsPerM2: number;
};

export function computeArealDensity(beforeG: number, afterG: number, ware: WarePreset): ArealDensityResult | null {
  if (!Number.isFinite(beforeG) || !Number.isFinite(afterG)) return null;
  const glazeWeightG = afterG - beforeG;
  if (glazeWeightG <= 0) return null;
  const areaM2 = REPRESENTATIVE_AREA_M2[ware];
  return { glazeWeightG, areaM2, gramsPerM2: glazeWeightG / areaM2 };
}
