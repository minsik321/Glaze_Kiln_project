import type { WarePreset } from "./catalog";
import type { SourceType } from "./contract";

export type ThicknessStatus = "thin" | "target" | "thick" | "unavailable";
export type ThicknessEvidence = "unavailable" | "mass_only" | "position_observed";
export type CoatingPreset = "thin" | "target" | "thick";

export type SectionAsset = {
  bodyPath: string;
  glazePaths: readonly [string, string, string];
  labels: readonly [string, string, string];
  callouts: ReadonlyArray<{ x: number; y: number; label: string; reason: string }>;
};

export const SECTION_ASSETS: Record<WarePreset, SectionAsset> = {
  bowl: { bodyPath: "M25 32 Q36 88 100 92 Q164 88 175 32 L160 32 Q148 73 100 77 Q52 73 40 32 Z", glazePaths: ["M38 31 Q42 52 52 64", "M52 64 Q100 86 148 64", "M148 64 Q158 52 162 31"], labels: ["왼쪽 벽", "안쪽 바닥", "오른쪽 벽"], callouts: [{ x: 100, y: 80, label: "안쪽 바닥", reason: "형상상 유약이 모이는 가상 구간" }, { x: 42, y: 36, label: "구연부", reason: "얇아지기 쉬운 가장자리" }, { x: 100, y: 92, label: "굽", reason: "유약 금지 영역과 가까움" }] },
  plate: { bodyPath: "M18 62 Q55 88 100 88 Q145 88 182 62 L168 58 Q142 74 100 75 Q58 74 32 58 Z", glazePaths: ["M30 58 Q58 68 78 70", "M78 70 Q100 74 122 70", "M122 70 Q145 68 170 58"], labels: ["왼쪽 가장자리", "중앙 평면", "오른쪽 가장자리"], callouts: [{ x: 100, y: 72, label: "중앙", reason: "넓은 평면의 평균 도포 구간" }, { x: 31, y: 57, label: "모서리", reason: "도포가 얇아지기 쉬움" }] },
  mug: { bodyPath: "M42 20 L145 20 L138 92 L48 92 Z M145 40 Q184 42 172 72 Q162 86 140 74", glazePaths: ["M47 21 L50 56", "M50 56 L54 86 L132 86", "M132 86 L140 21"], labels: ["바깥 윗면", "바닥·하단", "반대 벽"], callouts: [{ x: 92, y: 86, label: "안쪽 바닥", reason: "담금 후 상대적으로 두꺼워질 수 있음" }, { x: 145, y: 45, label: "손잡이 접합", reason: "형상 급변 구간" }] },
  cylinder_vase: { bodyPath: "M55 10 L145 10 L152 94 L48 94 Z", glazePaths: ["M58 12 L55 50", "M55 50 L54 89 L146 89", "M146 89 L142 12"], labels: ["윗벽", "하단", "반대 벽"], callouts: [{ x: 100, y: 90, label: "하단", reason: "흘러내림 누적 가능 구간" }, { x: 55, y: 12, label: "구연부", reason: "가장자리 얇아짐 가능" }] },
  bottle: { bodyPath: "M80 8 L120 8 L124 34 Q158 50 150 94 L50 94 Q42 50 76 34 Z", glazePaths: ["M78 12 L74 38", "M74 38 Q50 56 56 88", "M56 88 L144 88 Q150 56 126 38"], labels: ["목", "어깨", "몸통 하단"], callouts: [{ x: 73, y: 40, label: "어깨", reason: "곡률이 크게 바뀌는 구간" }, { x: 100, y: 89, label: "하단", reason: "유약 흐름 누적 가능" }] },
  tile: { bodyPath: "M18 38 L182 38 L176 82 L24 82 Z", glazePaths: ["M24 36 L72 36", "M72 36 L128 36", "M128 36 L176 36"], labels: ["왼쪽", "중앙", "오른쪽"], callouts: [{ x: 24, y: 36, label: "모서리", reason: "끝단 도포 편차 가능" }, { x: 100, y: 36, label: "중앙", reason: "평면 평균 비교 구간" }] },
  other: { bodyPath: "M30 28 Q70 8 100 28 Q130 48 170 28 L155 92 L45 92 Z", glazePaths: ["M36 28 Q62 18 80 25", "M80 25 Q100 35 120 27", "M120 27 Q145 35 164 28"], labels: ["선택 실루엣 A", "선택 실루엣 B", "선택 실루엣 C"], callouts: [{ x: 100, y: 30, label: "형상 미상", reason: "정밀 치수 없이 판정 불가" }] },
};

export type ThicknessView = {
  evidence: ThicknessEvidence;
  mean: { label: string; sourceType: SourceType; valueMm: number | null };
  segments: ReadonlyArray<{ label: string; status: ThicknessStatus; sourceType: SourceType }>;
  positionClaim: string;
  uncertainty: string;
  risk: string;
  curveReason: string;
};

export function buildThicknessView({ ware, coating, evidence = "mass_only", meanMm = .9 }: { ware: WarePreset; coating: CoatingPreset; evidence?: ThicknessEvidence; meanMm?: number | null }): ThicknessView {
  const asset = SECTION_ASSETS[ware];
  const statuses: Record<CoatingPreset, readonly ThicknessStatus[]> = {
    thin: ["thin", "target", "thin"], target: ["target", "thick", "target"], thick: ["thick", "thick", "target"],
  };
  const unavailable = evidence === "unavailable";
  const observed = evidence === "position_observed";
  const segmentStatus = unavailable ? ["unavailable", "unavailable", "unavailable"] as const : statuses[coating];
  const risk = coating === "thick" ? "하단과 안쪽 바닥의 흘러내림 위험을 먼저 확인하세요." : coating === "thin" ? "구연부와 모서리의 부족 도포 가능성을 확인하세요." : "안쪽 바닥은 상대적으로 두꺼울 수 있어 판정 근거를 확인하세요.";
  return {
    evidence,
    mean: { label: meanMm === null || unavailable ? "판정 불가" : `평균 추정 ${meanMm.toFixed(2)} mm`, sourceType: unavailable ? "inferred" : "inferred", valueMm: unavailable ? null : meanMm },
    segments: asset.labels.map((label, index) => ({ label, status: segmentStatus[index], sourceType: observed ? "observed" : "synthetic" })),
    positionClaim: observed ? "구간 측정에 근거한 위치별 비교" : unavailable ? "위치별 판정 불가" : "형상 기반 가상 분포",
    uncertainty: observed ? "관측 구간 밖은 여전히 추정" : "위치별 범위 ±35% 설명용 불확실성",
    risk,
    curveReason: coating === "thick" ? "상대 과도포 가정으로 승온을 완만하게 한 후보" : coating === "thin" ? "상대 부족도포 가정으로 기준 변경을 최소화한 후보" : "목표 근처 가정으로 기준 계획에 가까운 후보",
  };
}

