import type { FiringCurve, SourceType } from "./contract";
import type { GlossLevel, TransparencyLevel } from "./targetCoordinate";

export type RelativeObservation = "much_less" | "less" | "match" | "more" | "much_more";

const RELATIVE_OFFSET: Record<RelativeObservation, number> = {
  much_less: -2,
  less: -1,
  match: 0,
  more: 1,
  much_more: 2,
};

const GLOSS_SCALE: GlossLevel[] = ["dry", "matte", "satin", "semi_gloss", "gloss"];
const TRANSPARENCY_SCALE: TransparencyLevel[] = ["opaque", "semi_opaque", "translucent", "transparent"];
const TEXTURE_SCALE = ["smooth", "slightly_rough", "rough", "very_rough", "extremely_rough"] as const;

function resolveRelative<T extends string>(target: T, comparison: RelativeObservation | null, scale: readonly T[]): T | null {
  if (!comparison) return null;
  const targetIndex = scale.indexOf(target);
  if (targetIndex < 0) return target;
  if (comparison === "much_less") return scale[0];
  if (comparison === "much_more") return scale[scale.length - 1];
  const nextIndex = Math.max(0, Math.min(scale.length - 1, targetIndex + RELATIVE_OFFSET[comparison]));
  return scale[nextIndex];
}

function compareOrdinal<T extends string>(target: T, observed: string | null, scale: readonly T[]): RelativeObservation | null {
  if (!observed) return null;
  if (observed in RELATIVE_OFFSET) return observed as RelativeObservation;
  const targetIndex = scale.indexOf(target);
  const observedIndex = scale.indexOf(observed as T);
  if (targetIndex < 0 || observedIndex < 0) return observed === target ? "match" : null;
  const difference = observedIndex - targetIndex;
  if (difference <= -2) return "much_less";
  if (difference === -1) return "less";
  if (difference === 0) return "match";
  if (difference === 1) return "more";
  return "much_more";
}

export const resolveGlossObservation = (target: GlossLevel, comparison: RelativeObservation | null) => resolveRelative(target, comparison, GLOSS_SCALE);
export const resolveTransparencyObservation = (target: TransparencyLevel, comparison: RelativeObservation | null) => resolveRelative(target, comparison, TRANSPARENCY_SCALE);
export const resolveTextureObservation = (target: string, comparison: RelativeObservation | null) => resolveRelative(target, comparison, TEXTURE_SCALE);
export const compareGlossObservation = (target: GlossLevel, observed: string | null) => compareOrdinal(target, observed, GLOSS_SCALE);
export const compareTransparencyObservation = (target: TransparencyLevel, observed: string | null) => compareOrdinal(target, observed, TRANSPARENCY_SCALE);
export const compareTextureObservation = (target: string, observed: string | null) => compareOrdinal(target, observed, TEXTURE_SCALE);

export type ResultEvaluation = {
  match: "close" | "different" | null;
  color: "close" | "lighter" | "darker" | "different" | null;
  gloss: RelativeObservation | null;
  texture: RelativeObservation | null;
  transparency: RelativeObservation | null;
  defects: string[];
  defectSeverities: Record<string, number>;
  scope: "personal" | "common_candidate";
  resultPhoto: { dataUrl?: string; storagePath?: string; name: string } | null;
};

export function evaluationComplete(value: ResultEvaluation): boolean {
  return Boolean(value.match && value.color && value.gloss && value.texture && value.transparency);
}

export type ShareConsent = { photoRights: boolean; piiReviewed: boolean; locationRemoved: boolean; withdrawalUnderstood: boolean };

export function canPublish(consent: ShareConsent) {
  return Object.values(consent).every(Boolean);
}

export function feedbackTrace(evaluation: ResultEvaluation) {
  //: 실제 동작과 일치시킨다 — 서버가 평가 저장 시 학습값(비중·두께 범위, 광택 편향)을
  //: 보수적으로 갱신하고, 어긋난 항목 하나를 골라 "다음 시도 제안"(추정)을 만든다.
  //: ("차이가 있어요"여도 학습값은 결함이 없으면 그대로이며 제안만 생긴다.)
  const effects = evaluation.match === "different"
    ? ["개인 기록에 목표와 다른 결과로 저장", "어긋난 항목 하나를 골라 다음 시도 제안(추정) 생성"]
    : ["개인 기록에서 현재 후보를 가까운 사례로 저장", "일부 항목이 어긋났다면 절반 폭의 미세 조정 제안(추정) 생성"];
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
