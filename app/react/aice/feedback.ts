import type { FiringCurve, SourceType } from "./contract";

export type ResultEvaluation = {
  match: "close" | "different" | null;
  color: "close" | "lighter" | "darker" | "different" | null;
  gloss: "matte" | "satin" | "gloss" | null;
  texture: "smooth" | "slightly_rough" | "rough" | null;
  transparency: "opaque" | "translucent" | "transparent" | null;
  defects: string[];
  scope: "personal" | "common_candidate";
  //: 9페이지 — 첨부한 관찰 사진(파일 첨부, 로컬 데이터URL). 클라우드
  //: 스토리지 연동 없이 작업기록 payload(jsonb)에 그대로 실려 저장된다.
  resultPhoto: { dataUrl: string; name: string } | null;
};

export type ShareConsent = { photoRights: boolean; piiReviewed: boolean; locationRemoved: boolean; withdrawalUnderstood: boolean };

export function canPublish(consent: ShareConsent) {
  return Object.values(consent).every(Boolean);
}

export function feedbackTrace(evaluation: ResultEvaluation) {
  const effects = evaluation.match === "different"
    ? ["개인 기록 검색에서 유사 실패 사례의 가중치를 높임", "다음 레시피·곡선 후보 재비교 요청"]
    : ["개인 기록에서 현재 후보를 가까운 사례로 표시"];
  if (evaluation.scope === "common_candidate") effects.push("공통 모델에 자동 반영하지 않고 익명화·품질 검토 대기열에만 등록");
  return { sourceType: "observed" as SourceType, scope: evaluation.scope, effects, automaticCommonUpdate: false };
}

export function transformSharedCurve(curve: FiringCurve, input: { sourceKilnProfile: string; targetKilnProfile: string; targetLoad: "light" | "medium" | "dense" }) {
  const delta = input.targetLoad === "dense" ? 12 : input.targetLoad === "light" ? -8 : 0;
  return {
    ...curve,
    id: `${curve.id}-transformed-${input.targetKilnProfile}`,
    role: "candidate" as const,
    source_type: "inferred" as const,
    reason: `공유 곡선을 복사하지 않고 ${input.sourceKilnProfile}→${input.targetKilnProfile}, ${input.targetLoad} 적재 조건의 합성 변환 후보로 재시뮬레이션 필요`,
    points: curve.points.map((point) => ({ ...point, temperature_c: point.minute >= 300 && point.minute <= 400 ? point.temperature_c + delta : point.temperature_c })),
  };
}
