// 대응: src/kiln/thickness/profile.py(compute_profile, 07절 두께 산출)
// · src/kiln/thickness/geometry.py(파푸스·굴딘 표면적). 실제 계산은
// 백엔드 `/kiln/thickness/profile`(kiln_bridge.compute_thickness,
// compute_profile을 그대로 호출)이 수행한다 — 이 파일은 그 결과(`profile`)를
// 3개 삽화 구간에 매핑하는 표시 전용 로직만 담는다. `profile`이 없으면
// (무게 미입력 등) 판정 불가로 내린다 — coating 프리셋으로 지어낸 정적
// 조회표가 아니다.
import type { WarePreset } from "./catalog";
import type { SourceType } from "./contract";
import type { ThicknessComputeResponse } from "../lib/api";

export type ThicknessStatus = "thin" | "target" | "thick" | "unavailable";
export type ThicknessEvidence = "unavailable" | "mass_only";
//: 도포 프리셋 — 이 화면의 두께 판정에는 더 이상 쓰이지 않는다(위 판정은
//: 실측 무게에서 나온다). curvePlan.ts·kilnSimulation.ts의 합성 삽화가
//: 여전히 이 프리셋을 입력으로 쓴다 — 두 화면은 이번 수정의 범위 밖이다.
export type CoatingPreset = "thin" | "target" | "thick";

export type SectionAsset = {
  //: 기물을 세로로 반 갈랐을 때의 벽 단면 꼭짓점(박스 대비 %). 바깥 모양은
  //: 기물 선택 카드(app.css·design-system.css의 `.ware-*` clip-path)와 같고,
  //: 안쪽 면은 벽 두께만큼 들어간 곡선이다. 왼쪽 굽 모서리에서 시작해
  //: 바깥면 → 구연부 → 안쪽면 → 안쪽 바닥 → 안쪽면 → 구연부 → 바깥면 순으로
  //: 오른쪽 굽 모서리까지 이어진다 — 이 선이 곧 유약이 발리는 면이고, 마지막과
  //: 처음 사이의 바닥 변은 굽(유약 금지)이라 유약에서 뺀다. 타일처럼 속이 찬
  //: 기물은 윗면과 옆면만 있다.
  outline: ReadonlyArray<readonly [number, number]>;
  labels: readonly [string, string, string];
};

export const SECTION_ASSETS: Record<WarePreset, SectionAsset> = {
  bowl: { outline: [[24, 84], [8, 24], [15, 24], [29, 76], [71, 76], [85, 24], [92, 24], [76, 84]], labels: ["왼쪽 벽", "안쪽 바닥", "오른쪽 벽"] },
  plate: { outline: [[22, 72], [4, 50], [10, 50], [23, 66], [77, 66], [90, 50], [96, 50], [78, 72]], labels: ["왼쪽 가장자리", "중앙 평면", "오른쪽 가장자리"] },
  mug: { outline: [[20, 88], [20, 12], [28, 12], [28, 78], [62, 78], [62, 12], [70, 12], [70, 88]], labels: ["바깥 윗면", "바닥·하단", "반대 벽"] },
  cylinder_vase: { outline: [[28, 95], [28, 5], [36, 5], [36, 86], [64, 86], [64, 5], [72, 5], [72, 95]], labels: ["윗벽", "하단", "반대 벽"] },
  bottle: { outline: [[34, 99], [28, 50], [42, 34], [45, 1], [48, 1], [48, 34], [36, 50], [40, 91], [60, 91], [64, 50], [52, 34], [52, 1], [55, 1], [58, 34], [72, 50], [66, 99]], labels: ["목", "어깨", "몸통 하단"] },
  jar: { outline: [[27, 92], [16, 64], [22, 38], [36, 27], [40, 14], [44, 14], [42, 30], [28, 42], [23, 64], [32, 84], [68, 84], [77, 64], [72, 42], [58, 30], [56, 14], [60, 14], [64, 27], [78, 38], [84, 64], [73, 92]], labels: ["어깨", "몸통 하단", "반대 벽"] },
  tile: { outline: [[5, 88], [5, 12], [95, 12], [95, 88]], labels: ["왼쪽", "중앙", "오른쪽"] },
  other: { outline: [[0, 100], [0, 0], [100, 0], [100, 100]], labels: ["선택 실루엣 A", "선택 실루엣 B", "선택 실루엣 C"] },
};

export type ThicknessView = {
  evidence: ThicknessEvidence;
  mean: { label: string; sourceType: SourceType; valueMm: number | null };
  segments: ReadonlyArray<{ label: string; status: ThicknessStatus; sourceType: SourceType }>;
  //: v9: 5페이지가 더 이상 도포 상태를 버튼으로 고르지 않는다 — 세 구간
  //: 중 가장 위험한 쪽(두꺼움 우선, 다음 얇음)을 계산해 이 화면과 이후
  //: 화면(가마·소성곡선)이 함께 쓸 단일 값으로 내린다.
  overallStatus: ThicknessStatus;
  positionClaim: string;
  uncertainty: string;
  risk: string;
};

//: 07절 안전 두께 범위 기본값 — src/kiln/domain/models.py
//: ::CoefficientTable.safe_thickness_mm의 기본값(0.8, 1.3mm)과 같다.
//: 레시피별로 캘리브레이션되면 달라질 수 있지만(calibrationApi.get()),
//: 이 화면은 아직 레시피별 계수 테이블을 불러오지 않는다 — 기본값 사용
//: 사실 자체가 사용자에게 보이는 문구(uncertainty)에 남는다.
export const DEFAULT_SAFE_RANGE_MM: readonly [number, number] = [0.8, 1.3];

function classify(totalMm: number, [lo, hi]: readonly [number, number] = DEFAULT_SAFE_RANGE_MM): ThicknessStatus {
  if (totalMm < lo) return "thin";
  if (totalMm > hi) return "thick";
  return "target";
}

export function buildThicknessView({ ware, profile, safeRangeMm = DEFAULT_SAFE_RANGE_MM }: { ware: WarePreset; profile: ThicknessComputeResponse | null; safeRangeMm?: readonly [number, number] }): ThicknessView {
  const asset = SECTION_ASSETS[ware];

  if (!profile || profile.points.length === 0) {
    return {
      evidence: "unavailable",
      mean: { label: "판정 불가", sourceType: "inferred", valueMm: null },
      segments: asset.labels.map((label) => ({ label, status: "unavailable" as const, sourceType: "inferred" as const })),
      overallStatus: "unavailable",
      positionClaim: "위치별 판정 불가",
      uncertainty: "시유 전/후 무게를 모두 입력하면 계산됩니다",
      risk: "두께를 계산할 수 없어 위험을 판정할 수 없습니다.",
    };
  }

  const points = profile.points;
  const midIndex = Math.floor((points.length - 1) / 2);
  const sampled = [points[0], points[midIndex], points[points.length - 1]];
  const statuses = sampled.map((point) => classify(point.total, safeRangeMm));
  const worst: ThicknessStatus = statuses.includes("thick") ? "thick" : statuses.includes("thin") ? "thin" : "target";
  const risk = worst === "thick"
    ? "하단과 안쪽 바닥의 흘러내림 위험을 먼저 확인하세요."
    : worst === "thin"
      ? "구연부와 모서리의 부족 도포 가능성을 확인하세요."
      : "안전 범위 안이지만 위치별 값은 여전히 대표 형상 근사입니다.";

  return {
    evidence: "mass_only",
    mean: { label: `평균 추정 ${profile.mean_mm.toFixed(2)} mm`, sourceType: "inferred", valueMm: profile.mean_mm },
    segments: asset.labels.map((label, index) => ({ label, status: statuses[index], sourceType: "inferred" as const })),
    overallStatus: worst,
    positionClaim: profile.has_distribution
      ? "형상 적분(07절 t_abs+t_flow) 기반 위치별 추정"
      : "이 시유 방법은 분포 모델이 없어 평균값을 모든 위치에 표시",
    uncertainty: `대표 형상 근사 — 실측 치수 아님 (유약 ${profile.glaze_weight_g.toFixed(1)}g ÷ 면적 ${profile.area_m2.toFixed(3)}m²)`,
    risk,
  };
}

