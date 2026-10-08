// 대응: src/kiln/thickness/profile.py
// ::ThicknessProfile.areal_density_g_m2(glaze_weight_g / area_m2).
//
// v9 이전에는 이 파일이 `REPRESENTATIVE_AREA_M2`(형상별 문헌 추정 면적
// 상수)로 g/m²을 직접 나눗셈했다 — 진짜 표면적 적분
// (`kiln.thickness.geometry.surface_area_m2`, 파푸스·굴딘 정리)이 아니라
// 근사 상수였다. 지금은 백엔드 `/kiln/thickness/profile`이 그 적분을
// 실제로 돌려서 area_m2·areal_density_g_m2를 함께 낸다 — 이 파일은 더
// 이상 계산하지 않고, 그 응답을 화면이 쓰던 얇은 모양(`ArealDensityResult`)
// 으로 옮기기만 한다.
import type { ThicknessComputeResponse } from "../lib/api";

export type ArealDensityResult = {
  glazeWeightG: number;
  areaM2: number;
  gramsPerM2: number;
};

export function arealDensityFromProfile(profile: ThicknessComputeResponse | null): ArealDensityResult | null {
  if (!profile || profile.glaze_weight_g <= 0) return null;
  return {
    glazeWeightG: profile.glaze_weight_g,
    areaM2: profile.area_m2,
    gramsPerM2: profile.areal_density_g_m2,
  };
}
