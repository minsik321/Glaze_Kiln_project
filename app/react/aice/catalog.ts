import type { SourceType } from "./contract";
import type { GlossLevel, TransparencyLevel } from "./targetCoordinate";

export type RecipeId = "coastal-satin" | "warm-clear" | "soft-matte";
export type WarePreset = "bowl" | "plate" | "mug" | "cylinder_vase" | "bottle" | "tile" | "other";

export const SOURCE_LABELS: Record<SourceType, string> = {
  observed: "자체 관측",
  patent_example: "특허 실시예",
  patent_range: "특허 범위",
  literature: "문헌",
  inferred: "AICE 추론",
  synthetic: "합성",
};

export const RECIPE_CANDIDATES: ReadonlyArray<{
  id: RecipeId;
  name: string;
  visual: string;
  similarityReason: string;
  firingRange: string;
  sourceType: SourceType;
  dataCount: number;
  uncertainty: string;
  risk: string;
  photoAvailable: false;
  detail: string;
  //: 문헌 추정 (광택도, 투명도) 좌표 — 실측 아님. aiMvp.ts가 목표와의
  //: 거리를 실제로 계산하는 데만 쓴다(4-1절 좌표계, kiln.search.objective).
  gloss: GlossLevel;
  transparency: TransparencyLevel;
}> = [
  { id: "coastal-satin", name: "해안 사틴 01", visual: "recipe-blue", similarityReason: "사틴 광택과 불투명 목표가 가장 가까움", firingRange: "1180–1230 °C", sourceType: "literature", dataCount: 3, uncertainty: "높음 · 실제 결과 사진 없음", risk: "흘러내림·균열은 판정 불가", photoAvailable: false, detail: "배합 퍼센트와 화학 상세는 문헌 원조건 확인 전 제품 판단에 사용하지 않습니다.", gloss: "satin", transparency: "opaque" },
  { id: "warm-clear", name: "웜 클리어 02", visual: "recipe-clear", similarityReason: "색상은 가깝지만 광택·투명도 차이가 큼", firingRange: "1200–1240 °C", sourceType: "patent_range", dataCount: 2, uncertainty: "높음 · 특정 실시 조건", risk: "현재 소지 조건 적용 가능성 판정 불가", photoAvailable: false, detail: "특허 범위를 일반 유약의 관측값으로 취급하지 않습니다.", gloss: "gloss", transparency: "transparent" },
  { id: "soft-matte", name: "소프트 매트 03", visual: "recipe-white", similarityReason: "질감 사례는 가깝지만 목표 색상과 차이", firingRange: "1160–1220 °C", sourceType: "synthetic", dataCount: 0, uncertainty: "매우 높음 · 설명용 합성", risk: "실제 결함 위험 판정 불가", photoAvailable: false, detail: "규칙 비교용 합성 후보이며 실제 배합 또는 결과 예측이 아닙니다.", gloss: "matte", transparency: "opaque" },
] as const;

export const WARE_CATALOG: ReadonlyArray<{
  id: WarePreset;
  label: string;
  visual: string;
  size: string;
  glazing: string;
}> = [
  { id: "bowl", label: "사발", visual: "ware-bowl", size: "중간", glazing: "안/밖" },
  { id: "plate", label: "접시", visual: "ware-plate", size: "넓은 평면", glazing: "윗면" },
  { id: "mug", label: "컵/머그", visual: "ware-mug", size: "중간", glazing: "안/밖" },
  { id: "cylinder_vase", label: "원통 화병", visual: "ware-cylinder", size: "큰 세로형", glazing: "밖" },
  { id: "bottle", label: "병", visual: "ware-bottle", size: "중간 세로형", glazing: "밖" },
  { id: "tile", label: "타일/평판", visual: "ware-tile", size: "작은 평면", glazing: "윗면" },
  { id: "other", label: "기타", visual: "ware-other", size: "설명으로 기록", glazing: "선택" },
] as const;

export const CLAY_BODIES = [
  { id: "white-stoneware", label: "백색 석기 소지", note: "샘플 기본 소지" },
  { id: "oxidation-stoneware", label: "산화 석기 소지", note: "색 영향 가능" },
  { id: "earthenware", label: "도기 소지", note: "소성 범위 재확인 필요" },
] as const;

