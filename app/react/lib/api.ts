import { assertAiceRun, type AiceRun, type RecipeCandidate } from "../aice/contract";
import { persistPostImage, persistRunPhotos, signedPostImageUrl } from "../aice/photoStorage";
import { registerFeedUser, type FeedPost } from "../home/feedData";
import { requireSupabase } from "./supabase";

const API_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

export type AiceRunRecord = {
  request_id?: string | null;
  feedback_status?: "pending" | "applied" | "skipped";
  id: string;
  title: string;
  run: AiceRun;
  schema_version: 3;
  status: AiceRun["status"];
  goal_gloss: string;
  goal_transparency: string;
  recipe_id: string;
  /** recipes.id this run used (mine, or someone else's public recipe). */
  recipe_ref_id?: string | null;
  ware_preset: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

/** A recipe row. The author is never exposed; is_mine says whose it is. */
export type Recipe = {
  id: string;
  name: string;
  materials: Record<string, number>;
  colorants: Record<string, number>;
  composition_key: string;
  forked_from_id: string | null;
  forked_from: { id: string; name: string } | null;
  is_public: boolean;
  is_mine: boolean;
  created_at: string;
  updated_at: string;
};

/** 작업 기록 목록용 요약 — payload(사진·후보 등) 없이 목록이 쓰는 값만 담는다. */
export type AiceRunSummary = {
  id: string;
  title: string;
  status: AiceRun["status"];
  origin: "mine" | "imported";
  recipe_name: string;
  peak_c: number | null;
  created_at: string;
};
export type AiceRunSummaryPage = { items: AiceRunSummary[]; limit: number; offset: number };

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
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/v1${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (error) {
    throw new ApiError(
      "후보 생성 서버에 연결할 수 없습니다. 개발 서버를 다시 실행해 주세요.",
      0,
      "backend_unreachable",
    );
  }
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

function validateAiceRecord(record: AiceRunRecord): AiceRunRecord {
  assertAiceRun(record.run);
  if (record.schema_version !== 3) throw new Error("AiceRun record schema_version must be 3");
  return record;
}

const migratingRunIds = new Set<string>();

//: 옛 기록의 인라인(base64) 사진을 Storage로 옮긴다. 기록을 화면에 띄우는 것을
//: 막지 않도록 백그라운드로 돌리고(옛 사진은 data_url 그대로 읽힌다), 목록 조회에서는
//: 하지 않는다. 실패하면 다음 상세 진입 때 다시 시도한다.
function migrateStoredRunPhotos(record: AiceRunRecord): AiceRunRecord {
  if (migratingRunIds.has(record.id)) return record;
  migratingRunIds.add(record.id);
  void (async () => {
    try {
      const run = await persistRunPhotos(record.run);
      if (run === record.run) return;
      const { data, error } = await requireSupabase().from("aice_runs")
        .update({ payload: run }).eq("id", record.id).select("id").single();
      if (error || !data) throw error ?? new Error("사진이 포함된 기록을 갱신하지 못했습니다.");
    } catch (error) {
      console.warn("이전 사진을 Supabase Storage로 옮기지 못했습니다.", error);
    } finally {
      migratingRunIds.delete(record.id);
    }
  })();
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
    request<{ image_base64: string; media_type: string; source_type?: "ai" | "fallback" }>("/aice/recipe-candidates/image", token, {
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
  //: 비중 개인화 보정(kiln.calibration.density) — 이 레시피로 실제 시유에
  //: 쓴 비중 실측값들의 관측 범위. null이면 아직 관측이 없다(0과 다른
  //: 진술) — 화면은 이때 문헌 기본 범위([1.4, 1.5])로 대체해야 한다.
  specific_gravity_range: [number, number] | null;
  density_calibration_runs: number;
  //: 같은 보정(kiln.calibration.density)의 개인 다음-시도 두께 제안 —
  //: 위 safe_thickness_mm(위험 판정 경계)과 절대 같은 값이 아니다.
  next_trial_thickness_mm: [number, number] | null;
  //: 가장 최근 평가 1건에서 나온 "다음 시도 제안"(추정) — 학습값·안전 경계가
  //: 아니다. 평가할 때마다 덮어쓰며, 없으면 null/undefined.
  next_trial_suggestion?: NextTrialSuggestion | null;
};
export type NextTrialSuggestion = {
  trigger: "defect" | "gloss" | "transparency" | "texture" | "color" | "none";
  variable: "thickness" | "hold" | "none";
  magnitude: "full" | "half" | "none";
  message: string;
  change_pct: number | null;
  thickness_mm: number | null;
  hold_delta_min: number | null;
  estimated: boolean;
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
  listSummaries: (token: string, offset = 0) => request<AiceRunSummaryPage>(`/aice-runs/summaries?limit=20&offset=${offset}`, token),
  get: async (token: string, id: string) => migrateStoredRunPhotos(validateAiceRecord(await request<AiceRunRecord>(`/aice-runs/${id}`, token))),
  listPublic: async (token: string, offset = 0) => {
    const page = await request<AiceRunPage>(`/public/aice-runs?limit=20&offset=${offset}`, token);
    return { ...page, items: page.items.map(validateAiceRecord) };
  },
  getPublic: async (token: string, id: string) => validateAiceRecord(await request<AiceRunRecord>(`/public/aice-runs/${id}`, token)),
  create: async (token: string, input: { title: string; run: AiceRun; request_id?: string; is_public?: boolean; recipe_ref_id?: string | null }) => {
    const run = await persistRunPhotos(input.run);
    return validateAiceRecord(await request<AiceRunRecord>("/aice-runs", token, {
      method: "POST", body: JSON.stringify({ ...input, run, is_public: input.is_public ?? false }),
    }));
  },
  //: 작업 기록 수정 — 제목·메모·결과 관찰만 바뀐다(백엔드 PATCH). 새 결과 사진은 먼저 저장소에 올린다.
  update: async (token: string, id: string, input: { run: AiceRun; title?: string; memo?: string; result?: AiceRun["result"] }) => {
    const { run, ...changes } = input;
    const result = changes.result ? (await persistRunPhotos({ ...run, result: changes.result })).result : undefined;
    return migrateStoredRunPhotos(validateAiceRecord(await request<AiceRunRecord>(`/aice-runs/${id}`, token, {
      method: "PATCH", body: JSON.stringify({ ...changes, result }),
    })));
  },
  nextTrial: (token: string, id: string) => request<NextTrialSuggestion | null>(`/aice-runs/${id}/next-trial`, token),
  retryFeedback: async (token: string, id: string) =>
    validateAiceRecord(await request<AiceRunRecord>(`/aice-runs/${id}/feedback/retry`, token, { method: "POST" })),
  publish: async (token: string, id: string, consent: { photo_rights_confirmed: boolean; pii_reviewed: boolean; location_removed: boolean; withdrawal_understood: boolean }) =>
    validateAiceRecord(await request<AiceRunRecord>(`/aice-runs/${id}/publish`, token, { method: "POST", body: JSON.stringify(consent) })),
  withdraw: async (token: string, id: string) => validateAiceRecord(await request<AiceRunRecord>(`/aice-runs/${id}/publication`, token, { method: "DELETE" })),
  remove: (token: string, id: string) => request<void>(`/aice-runs/${id}`, token, { method: "DELETE" }),
};

export const recipesApi = {
  //: Recipes split out of runs: my own list, and one recipe (mine or public)
  //: with the recipe it was forked from.
  listMine: (token: string) => request<{ items: Recipe[] }>("/recipes", token),
  get: (token: string, id: string) => request<Recipe>(`/recipes/${encodeURIComponent(id)}`, token),
};

type FeedPostRow = { id: string; author_id?: string | null; author_name?: string; kind: "work" | "sale"; payload: Omit<FeedPost, "id" | "userId" | "image" | "publishedAt"> & { imagePath?: string | null; image?: string }; created_at: string };

export function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간 전`;
  return `${Math.floor(minutes / 1440)}일 전`;
}

async function rowToPost(row: FeedPostRow, selfId?: string): Promise<FeedPost> {
  const { imagePath, image: legacyImage, ...rest } = row.payload;
  const image = imagePath ? await signedPostImageUrl(imagePath).catch(() => null) : null;
  //: 내 글은 "self", 다른 사람 글은 그 사람의 실제 id.
  const isMine = !selfId || !row.author_id || row.author_id === selfId;
  if (!isMine && row.author_id) registerFeedUser(row.author_id, row.author_name ?? "");
  return { ...rest, id: row.id, userId: isMine ? "self" : row.author_id!, image: image ?? legacyImage ?? "", publishedAt: relativeTime(row.created_at), kind: row.kind } as FeedPost;
}

//: 사진은 저장소에 올리고 경로만 payload에 남긴다. 저장소를 못 쓰면 data URL을 그대로 둔다.
async function postBody(post: FeedPost) {
  const { id: _id, userId: _userId, image, publishedAt: _publishedAt, ...rest } = post;
  const imagePath = await persistPostImage(image);
  return JSON.stringify({ kind: post.kind ?? "work", payload: imagePath ? { ...rest, imagePath } : { ...rest, image } });
}

export const feedPostsApi = {
  //: 모든 사용자의 글(최신순). selfId와 같은 작성자의 글은 내 글("self")로 표시한다.
  listAll: async (token: string, selfId: string) => {
    const page = await request<{ items: FeedPostRow[] }>("/feed-posts?limit=100", token);
    return Promise.all(page.items.map((row) => rowToPost(row, selfId)));
  },
  create: async (token: string, post: FeedPost) =>
    rowToPost(await request<FeedPostRow>("/feed-posts", token, { method: "POST", body: await postBody(post) })),
  update: async (token: string, post: FeedPost) =>
    rowToPost(await request<FeedPostRow>(`/feed-posts/${post.id}`, token, { method: "PUT", body: await postBody(post) })),
  remove: (token: string, id: string) => request<void>(`/feed-posts/${id}`, token, { method: "DELETE" }),
};
