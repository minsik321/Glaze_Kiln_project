import { assertAiceRun, type AiceRun, type RecipeCandidate } from "../aice/contract";

const API_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

export type WorkRecord = {
  id: string;
  title: string;
  payload: Record<string, unknown>;
  schema_version: number;
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

export type WorkRecordPage = {
  items: WorkRecord[];
  limit: number;
  offset: number;
};

export type AiceRunRecord = {
  id: string;
  title: string;
  run: AiceRun;
  schema_version: 3;
  status: AiceRun["status"];
  goal_gloss: string;
  goal_transparency: string;
  recipe_id: string;
  ware_preset: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

export type AiceRunPage = { items: AiceRunRecord[]; limit: number; offset: number };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "api_error",
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  return requestPublic<T>(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init?.headers },
  });
}

//: 로그인이 필요 없는 순수 계산 경계(예: /kiln/firing/simulate)용 —
//: 사용자 데이터를 다루지 않으므로 Authorization 헤더를 붙이지 않는다.
async function requestPublic<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.detail;
    throw new ApiError(
      detail?.message || "서버 요청을 처리하지 못했습니다.",
      response.status,
      detail?.code,
    );
  }
  return body as T;
}

export const recordsApi = {
  listMine: (token: string, offset = 0) =>
    request<WorkRecordPage>(`/work-records?limit=20&offset=${offset}`, token),
  listPublic: (token: string, offset = 0) =>
    request<WorkRecordPage>(
      `/public/work-records?limit=20&offset=${offset}`,
      token,
    ),
  create: (
    token: string,
    input: Pick<WorkRecord, "title" | "payload" | "is_public">,
  ) =>
    request<WorkRecord>("/work-records", token, {
      method: "POST",
      body: JSON.stringify({ ...input, schema_version: 1 }),
    }),
  update: (
    token: string,
    id: string,
    input: Partial<Pick<WorkRecord, "title" | "payload" | "is_public">>,
  ) =>
    request<WorkRecord>(`/work-records/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  remove: (token: string, id: string) =>
    request<void>(`/work-records/${id}`, token, { method: "DELETE" }),
};

function validateAiceRecord(record: AiceRunRecord): AiceRunRecord {
  assertAiceRun(record.run);
  if (record.schema_version !== 3) throw new Error("AiceRun record schema_version must be 3");
  return record;
}

export type RecipeSuggestResponse = {
  prompt_text: string;
  candidates: RecipeCandidate[];
  //: 화학적으로 성립하지 않아 버린 후보의 사유(백엔드가 개별 검증 후 버림).
  dropped: string[];
};

export const recipeCandidatesApi = {
  //: 화면 1(LLM 채팅) — 자연어 입력에서 검증된 레시피 후보를 만든다
  //: (LLM 프런트도어 TODO Phase 2). 반환 후보는 kiln.chem UMF 교차 검증을
  //: 통과한 것만 담긴다 — dropped에 버려진 후보의 사유가 함께 온다.
  suggest: (token: string, promptText: string, candidateCount = 5) =>
    request<RecipeSuggestResponse>("/aice/recipe-candidates", token, {
      method: "POST",
      body: JSON.stringify({ prompt_text: promptText, candidate_count: candidateCount }),
    }),
  //: 후보 카드 1장의 예상 이미지 — 비용이 붙으므로(§8) 카드별로 명시 요청한다.
  //: 항상 AI 생성/플레이스홀더다 — 실제 소성 결과를 보여주지 않는다.
  image: (token: string, input: { candidate_name: string; materials: Record<string, number>; colorants?: Record<string, number>; style_note?: string; target_gloss?: string; target_transparency?: string }) =>
    request<{ image_base64: string; media_type: string }>("/aice/recipe-candidates/image", token, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

//: `kiln.firing.simulator.Disturbance`와 필드를 그대로 맞춘다 (12-2절).
export type KilnDisturbance = {
  supply_voltage_pct?: number;
  element_aging_pct?: number;
  thermocouple_noise_c?: number;
  thermocouple_lag_s?: number;
  load_mismatch_pct?: number;
  wall_lag_s?: number;
  seed?: number;
};

export type KilnControlSample = {
  t_s: number;
  minute: number;
  sensor_c: number;
  ware_c: number;
  power_w: number;
  phase: string;
  outer_mode: string;
  hold_extension_s: number;
  message: string;
  paused: boolean;
};

export type KilnSimulateResponse = {
  samples: KilnControlSample[];
  provenance_notes: string[];
  e_note: string;
  target_heat_work: number;
  peak_c: number;
  max_power_w: number;
};

export const kilnFiringApi = {
  //: 가상 제어기 패널(KilnFiringScreen.tsx) — `kiln.firing.controller`·
  //: `kiln.firing.simulator`를 그대로 돌린다. 사용자 데이터를 다루지 않는
  //: 순수 계산이라 로그인 없이 부른다.
  simulate: (schedule: ReadonlyArray<readonly [number, number]>, disturbance: KilnDisturbance = {}, dtS = 60) =>
    requestPublic<KilnSimulateResponse>("/kiln/firing/simulate", {
      method: "POST",
      body: JSON.stringify({ schedule, disturbance, dt_s: dtS }),
    }),
};

export type ThicknessPointOut = { z: number; radius: number; t_abs: number; t_flow: number; total: number };
export type ThicknessComputeResponse = {
  points: ThicknessPointOut[];
  area_m2: number;
  mean_mm: number;
  areal_density_g_m2: number;
  glaze_weight_g: number;
  rho_dry: number;
  has_distribution: boolean;
  within_model_scope: boolean;
  local_max_mm: number;
  local_min_mm: number;
  spread_mm: number;
  provenance_notes: string[];
};
export type ThicknessComputeInput = {
  ware_preset: string;
  weight_before_g: number;
  weight_after_g: number;
  method?: string;
  dip_seconds?: number | null;
  specific_gravity?: number | null;
  waxed_area_m2?: number;
  is_reglaze?: boolean;
  drying_complete?: boolean;
  glaze_interior?: boolean;
};

export const kilnThicknessApi = {
  //: 두께 종단면 화면(ThicknessSection.tsx) — `kiln.thickness.profile
  //: .compute_profile`을 그대로 돌린다. 순수 계산이라 로그인 없이 부른다.
  computeProfile: (input: ThicknessComputeInput) =>
    requestPublic<ThicknessComputeResponse>("/kiln/thickness/profile", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

export type DipTimeResponse = { seconds: number; predicted_mean_mm: number; feasible: boolean; reason: string };

export const kilnBatchApi = {
  //: 담금시간 역산(DensityCheck.tsx) — `kiln.batch.dip_time
  //: .recommend_dip_time` 그대로. 로그인 없이 부른다.
  dipTime: (targetMm: number, specificGravity: number, tFlowMm = 0) =>
    requestPublic<DipTimeResponse>("/kiln/batch/dip-time", {
      method: "POST",
      body: JSON.stringify({ target_mm: targetMm, specific_gravity: specificGravity, t_flow_mm: tFlowMm }),
    }),
};

export type CoefficientTableOut = {
  recipe_id: string;
  k1: number | null;
  k2: number | null;
  rho_dry: number | null;
  s: number | null;
  m_rho: number | null;
  safe_thickness_mm: [number, number];
  calibration_runs: number;
  calibrated_bisque_c: number | null;
  provenance_notes: string[];
  gloss_bias_level: number | null;
  firing_calibration_runs: number;
};
export type CalibrationRunInput = {
  ware_preset: string;
  bisque_temperature_c: number;
  weight_before_g: number;
  weight_after_g: number;
  method?: string;
  dip_seconds?: number | null;
  specific_gravity?: number | null;
  waxed_area_m2?: number;
  is_reglaze?: boolean;
  drying_complete?: boolean;
  glaze_interior?: boolean;
};
export type CalibrationRunResponse = {
  table: CoefficientTableOut;
  applied: boolean;
  k1_estimate: number | null;
  notes: string[];
};

export const calibrationApi = {
  //: 레시피별 계수 계열(Phase 5) — `kiln.calibration.registry`를 그대로
  //: 배선한다. 로그인 필요(사용자별 personal_calibrations 행).
  get: (token: string, recipeId: string) =>
    request<CoefficientTableOut>(`/aice/calibration/${encodeURIComponent(recipeId)}`, token),
  submitRun: (token: string, recipeId: string, input: CalibrationRunInput) =>
    request<CalibrationRunResponse>(`/aice/calibration/${encodeURIComponent(recipeId)}/runs`, token, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

export const aiceRunsApi = {
  listMine: async (token: string, offset = 0) => {
    const page = await request<AiceRunPage>(`/aice-runs?limit=20&offset=${offset}`, token);
    return { ...page, items: page.items.map(validateAiceRecord) };
  },
  get: async (token: string, id: string) => validateAiceRecord(await request<AiceRunRecord>(`/aice-runs/${id}`, token)),
  listPublic: async (token: string, offset = 0) => {
    const page = await request<AiceRunPage>(`/public/aice-runs?limit=20&offset=${offset}`, token);
    return { ...page, items: page.items.map(validateAiceRecord) };
  },
  getPublic: async (token: string, id: string) => validateAiceRecord(await request<AiceRunRecord>(`/public/aice-runs/${id}`, token)),
  create: async (token: string, input: { title: string; run: AiceRun; is_public?: boolean }) =>
    validateAiceRecord(await request<AiceRunRecord>("/aice-runs", token, { method: "POST", body: JSON.stringify({ ...input, is_public: input.is_public ?? false }) })),
  publish: async (token: string, id: string, consent: { photo_rights_confirmed: boolean; pii_reviewed: boolean; location_removed: boolean; withdrawal_understood: boolean }) =>
    validateAiceRecord(await request<AiceRunRecord>(`/aice-runs/${id}/publish`, token, { method: "POST", body: JSON.stringify(consent) })),
  withdraw: async (token: string, id: string) => validateAiceRecord(await request<AiceRunRecord>(`/aice-runs/${id}/publication`, token, { method: "DELETE" })),
  remove: (token: string, id: string) => request<void>(`/aice-runs/${id}`, token, { method: "DELETE" }),
};
