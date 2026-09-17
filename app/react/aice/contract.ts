export const AICE_SCHEMA_VERSION = 3 as const;

export const SOURCE_TYPES = [
  "observed",
  "patent_example",
  "patent_range",
  "literature",
  "inferred",
  "synthetic",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export type SourceReference = {
  source_type: SourceType;
  reference: string;
  locator?: string;
  original_condition?: string;
  conversion?: string;
  interpretation?: string;
  limitation: string;
  confidence: "low" | "medium" | "high";
};

export type SourcedValue<T> = {
  value: T | null;
  unit: string;
  source_type: SourceType;
  confidence: number | null;
  note: string;
};

export type PhotoAsset = {
  id: string;
  kind: "recipe" | "result";
  storage_path: string | null;
  placeholder: boolean;
  source_type: SourceType;
  rights_confirmed: boolean;
  alt: string;
};

export type RecipeCandidate = {
  id: string;
  name: string;
  materials: Record<string, number>;
  /** 건조 기본 유약 100g 대비 외배합 발색 산화물 wt% */
  colorants: Record<string, number>;
  colorant_note: string;
  predicted_firing_range: SourcedValue<[number | null, number | null]>;
  predicted_firing_note: string;
  photo: PhotoAsset;
  source_type: SourceType;
  source_ids: string[];
};

export type RecipeCandidateSet = {
  candidates: RecipeCandidate[];
  selected_id: string | null;
};

export type ChatIntake = {
  prompt_text: string;
  prompt_photos: PhotoAsset[];
  candidates: RecipeCandidateSet;
};

export type CurvePoint = { minute: number; temperature_c: number };
export type FiringCurve = {
  id: string;
  role: "baseline" | "candidate" | "selected" | "actual" | "next";
  points: CurvePoint[];
  source_type: SourceType;
  reason: string;
};

export type AiceRun = {
  schema_version: typeof AICE_SCHEMA_VERSION;
  run_id: string;
  revision: number;
  title: string;
  status: "draft" | "simulated" | "evaluated";
  goal: {
    gloss: "dry" | "matte" | "satin" | "semi_gloss" | "gloss";
    transparency: "opaque" | "semi_opaque" | "translucent" | "transparent";
    color: string;
    texture: string;
  };
  recipe: {
    id: string;
    name: string;
    photo: PhotoAsset;
    firing_range: SourcedValue<[number, number]>;
    source_ids: string[];
  };
  ware: {
    preset: "bowl" | "plate" | "mug" | "cylinder_vase" | "bottle" | "tile" | "other";
    clay_body: string;
    size_category: "small" | "medium" | "large";
    glazing: "inside" | "outside" | "both";
    geometry_source: SourceType;
  };
  application: {
    method: "dipping" | "pouring" | "brushing" | "spraying";
    before_weight: SourcedValue<number>;
    after_weight: SourcedValue<number>;
    density: SourcedValue<number>;
  };
  thickness: {
    mean: SourcedValue<number>;
    distribution: "unavailable" | "shape_based" | "position_observed";
    uncertainty: SourcedValue<[number, number]>;
    warning: string;
    //: 면적당 시유량 [g/m²] — mean(mm)과 별개 단위의 1급 필드 (Phase 1).
    areal_density: SourcedValue<number>;
  };
  loading: {
    kiln_profile_id: string;
    sensor_plan: "single" | "three" | "multi";
    sensors: Array<{ id: string; height_ratio: number; temperature: SourcedValue<number> }>;
  };
  curves: {
    baseline: FiringCurve;
    candidates: FiringCurve[];
    selected_id: string | null;
  };
  //: LLM 프런트도어 TODO Phase 3 — v2의 이름 붙은 프리셋(빠른 반응/균형/
  //: 안정 우선)은 설명용 합성 게인 3벌을 제품 옵션처럼 보이게 했다. v3은
  //: 사용자에게 이진 결정만 노출한다: 실제 게인 수치는 parameters에 그대로
  //: 남는다(src/kiln/aice/contract.py PidExecution.decision과 대응).
  pid: {
    decision: "accepted" | "regenerate";
    controller_kind: "feedforward_p" | "pid";
    parameters: Record<string, SourcedValue<number>>;
    samples: Array<{ minute: number; planned_c: number; sensor_c: number; estimated_ware_c: number; heater_percent: number }>;
    alarms: string[];
  };
  result: {
    photo: PhotoAsset | null;
    color: string | null;
    gloss: string | null;
    texture: string | null;
    transparency: string | null;
    defects: string[];
    feedback_scope: "personal" | "common_candidate" | null;
  };
  sources: SourceReference[];
  consent: {
    share_allowed: boolean;
    photo_rights_confirmed: boolean;
    pii_reviewed: boolean;
    location_removed: boolean;
    withdrawn_at: string | null;
  };
  versions: {
    data: string;
    rule_model: string;
    simulator: string;
    predictor: string | null;
  };
  //: 화면 1(LLM 채팅) 입력·출력 기록. 채팅에서 시작하지 않은 실행은 null (Phase 1).
  intake: ChatIntake | null;
  created_at: string;
  updated_at: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const isSourceType = (value: unknown): value is SourceType => typeof value === "string" && SOURCE_TYPES.includes(value as SourceType);

function isSourcedValue(value: unknown): boolean {
  return isRecord(value) && "value" in value && typeof value.unit === "string" && isSourceType(value.source_type) &&
    (value.confidence === null || (typeof value.confidence === "number" && value.confidence >= 0 && value.confidence <= 1)) && typeof value.note === "string";
}

export function validateAiceRun(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["run must be an object"];
  if (value.schema_version !== AICE_SCHEMA_VERSION) errors.push(`schema_version must be ${AICE_SCHEMA_VERSION}`);
  for (const key of ["run_id", "title", "status", "created_at", "updated_at"])
    if (typeof value[key] !== "string" || !value[key]) errors.push(`${key} is required`);
  if (typeof value.revision !== "number" || value.revision < 1) errors.push("revision must be positive");
  for (const key of ["goal", "recipe", "ware", "application", "thickness", "loading", "curves", "pid", "result", "consent", "versions"])
    if (!isRecord(value[key])) errors.push(`${key} must be an object`);
  if (isRecord(value.application)) for (const key of ["before_weight", "after_weight", "density"]) if (!isSourcedValue(value.application[key])) errors.push(`application.${key} is invalid`);
  if (isRecord(value.thickness)) for (const key of ["mean", "uncertainty", "areal_density"]) if (!isSourcedValue(value.thickness[key])) errors.push(`thickness.${key} is invalid`);
  if (!Array.isArray(value.sources) || value.sources.some((source) => !isRecord(source) || !isSourceType(source.source_type) || typeof source.limitation !== "string")) errors.push("sources are invalid");
  return errors;
}

export function assertAiceRun(value: unknown): asserts value is AiceRun {
  const errors = validateAiceRun(value);
  if (errors.length) throw new Error(errors.join("; "));
}

export function sampleAiceRun(now = "2026-09-16T00:00:00.000Z"): AiceRun {
  const inferred = <T>(value: T | null, unit: string, note: string, confidence = .6): SourcedValue<T> => ({ value, unit, source_type: "inferred", confidence, note });
  const synthetic = <T>(value: T | null, unit: string, note: string, confidence = .5): SourcedValue<T> => ({ value, unit, source_type: "synthetic", confidence, note });
  const curve = (id: string, role: FiringCurve["role"]): FiringCurve => ({ id, role, source_type: "synthetic", reason: "설명용 가상 계획", points: [{ minute: 0, temperature_c: 20 }, { minute: 480, temperature_c: 1220 }] });
  return {
    schema_version: 3, run_id: "sample-aice-run", revision: 1, title: "사틴 청색 사발 샘플", status: "simulated",
    goal: { gloss: "satin", transparency: "opaque", color: "#668594", texture: "smooth" },
    recipe: { id: "coastal-satin", name: "해안 사틴 01", photo: { id: "recipe-placeholder", kind: "recipe", storage_path: null, placeholder: true, source_type: "synthetic", rights_confirmed: true, alt: "실물 사진이 아닌 청회색 질감 플레이스홀더" }, firing_range: { value: [1180, 1230], unit: "°C", source_type: "literature", confidence: .4, note: "문헌 범위이며 이 레시피의 품질 보장이 아님" }, source_ids: ["literature-firing-range"] },
    ware: { preset: "bowl", clay_body: "white-stoneware", size_category: "medium", glazing: "both", geometry_source: "inferred" },
    application: { method: "dipping", before_weight: inferred<number>(null, "g", "샘플 흐름에서는 관측하지 않음", 0), after_weight: inferred<number>(null, "g", "샘플 흐름에서는 관측하지 않음", 0), density: inferred<number>(null, "g/mL", "샘플 흐름에서는 관측하지 않음", 0) },
    thickness: { mean: inferred<number>(null, "mm", "면적과 건조밀도 관측이 없어 판정 불가", 0), distribution: "shape_based", uncertainty: synthetic<[number, number]>([0.7, 1.4], "relative", "형상 기반 가상 분포"), warning: "두께 표현은 이해를 위해 과장됨", areal_density: inferred<number>(null, "g/m²", "판정 불가", 0) },
    loading: { kiln_profile_id: "virtual-electric-kiln", sensor_plan: "three", sensors: ["top", "middle", "bottom"].map((id, index) => ({ id, height_ratio: 1 - index * .5, temperature: synthetic<number>(null, "°C", "가상 소성 전") })) },
    curves: { baseline: curve("baseline", "baseline"), candidates: [curve("candidate-balanced", "candidate")], selected_id: "candidate-balanced" },
    pid: { decision: "accepted", controller_kind: "feedforward_p", parameters: {}, samples: [], alarms: [] },
    result: { photo: null, color: null, gloss: null, texture: null, transparency: null, defects: [], feedback_scope: null },
    sources: [{ source_type: "literature", reference: "kiln-plan-v7", locator: "12절", limitation: "실물 가마 정확도와 품질을 보장하지 않음", confidence: "medium" }],
    consent: { share_allowed: false, photo_rights_confirmed: false, pii_reviewed: false, location_removed: false, withdrawn_at: null },
    versions: { data: "aice-sample-1", rule_model: "rule-rank-1", simulator: "kiln-simulator-0.7", predictor: null },
    intake: null, created_at: now, updated_at: now,
  };
}

export function legacyWorkRecordToAiceRun(record: { id?: string; title?: string; payload?: Record<string, unknown>; created_at?: string; updated_at?: string }): AiceRun {
  const run = sampleAiceRun(record.created_at ?? new Date(0).toISOString());
  return { ...run, run_id: record.id ?? `legacy-${run.run_id}`, title: record.title?.trim() || "이전 작업 기록", status: "draft", sources: [...run.sources, { source_type: "inferred", reference: "work_records schema v1", limitation: "이전 범용 payload에서 직접 매핑되지 않은 필드는 샘플 기본 구조이며 관측값이 아님", confidence: "low" }], updated_at: record.updated_at ?? run.updated_at };
}

export function aiceRunToLegacyWorkRecord(run: AiceRun) {
  return {
    title: run.title,
    schema_version: 1,
    is_public: false,
    payload: { aice_run: run, compatibility: "read_only", original_schema_version: AICE_SCHEMA_VERSION },
  };
}
