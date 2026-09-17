export const AICE_SCHEMA_VERSION = 2 as const;

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
  pid: {
    preset: "fast" | "balanced" | "stable";
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
  if (value.schema_version !== AICE_SCHEMA_VERSION) errors.push("schema_version must be 2");
  for (const key of ["run_id", "title", "status", "created_at", "updated_at"])
    if (typeof value[key] !== "string" || !value[key]) errors.push(`${key} is required`);
  if (typeof value.revision !== "number" || value.revision < 1) errors.push("revision must be positive");
  for (const key of ["goal", "recipe", "ware", "application", "thickness", "loading", "curves", "pid", "result", "consent", "versions"])
    if (!isRecord(value[key])) errors.push(`${key} must be an object`);
  if (isRecord(value.application)) for (const key of ["before_weight", "after_weight", "density"]) if (!isSourcedValue(value.application[key])) errors.push(`application.${key} is invalid`);
  if (isRecord(value.thickness)) for (const key of ["mean", "uncertainty"]) if (!isSourcedValue(value.thickness[key])) errors.push(`thickness.${key} is invalid`);
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
    schema_version: 2, run_id: "sample-aice-run", revision: 1, title: "사틴 청색 사발 샘플", status: "simulated",
    goal: { gloss: "satin", transparency: "opaque", color: "#668594", texture: "smooth" },
    recipe: { id: "coastal-satin", name: "해안 사틴 01", photo: { id: "recipe-placeholder", kind: "recipe", storage_path: null, placeholder: true, source_type: "synthetic", rights_confirmed: true, alt: "실물 사진이 아닌 청회색 질감 플레이스홀더" }, firing_range: { value: [1180, 1230], unit: "°C", source_type: "literature", confidence: .4, note: "문헌 범위이며 이 레시피의 품질 보장이 아님" }, source_ids: ["literature-firing-range"] },
    ware: { preset: "bowl", clay_body: "white-stoneware", size_category: "medium", glazing: "both", geometry_source: "inferred" },
    application: { method: "dipping", before_weight: inferred<number>(null, "g", "샘플 흐름에서는 관측하지 않음", 0), after_weight: inferred<number>(null, "g", "샘플 흐름에서는 관측하지 않음", 0), density: inferred<number>(null, "g/mL", "샘플 흐름에서는 관측하지 않음", 0) },
    thickness: { mean: inferred<number>(null, "mm", "면적과 건조밀도 관측이 없어 판정 불가", 0), distribution: "shape_based", uncertainty: synthetic<[number, number]>([0.7, 1.4], "relative", "형상 기반 가상 분포"), warning: "두께 표현은 이해를 위해 과장됨" },
    loading: { kiln_profile_id: "virtual-electric-kiln", sensor_plan: "three", sensors: ["top", "middle", "bottom"].map((id, index) => ({ id, height_ratio: 1 - index * .5, temperature: synthetic<number>(null, "°C", "가상 소성 전") })) },
    curves: { baseline: curve("baseline", "baseline"), candidates: [curve("candidate-balanced", "candidate")], selected_id: "candidate-balanced" },
    pid: { preset: "balanced", controller_kind: "feedforward_p", parameters: {}, samples: [], alarms: [] },
    result: { photo: null, color: null, gloss: null, texture: null, transparency: null, defects: [], feedback_scope: null },
    sources: [{ source_type: "literature", reference: "kiln-plan-v7", locator: "12절", limitation: "실물 가마 정확도와 품질을 보장하지 않음", confidence: "medium" }],
    consent: { share_allowed: false, photo_rights_confirmed: false, pii_reviewed: false, location_removed: false, withdrawn_at: null },
    versions: { data: "aice-sample-1", rule_model: "rule-rank-1", simulator: "kiln-simulator-0.7", predictor: null }, created_at: now, updated_at: now,
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
