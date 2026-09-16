import { assertAiceRun, type AiceRun } from "../aice/contract";

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
  schema_version: 2;
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
  const response = await fetch(`${API_URL}/api/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
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
  if (record.schema_version !== 2) throw new Error("AiceRun record schema_version must be 2");
  return record;
}

export const aiceRunsApi = {
  listMine: async (token: string, offset = 0) => {
    const page = await request<AiceRunPage>(`/aice-runs?limit=20&offset=${offset}`, token);
    return { ...page, items: page.items.map(validateAiceRecord) };
  },
  get: async (token: string, id: string) => validateAiceRecord(await request<AiceRunRecord>(`/aice-runs/${id}`, token)),
  create: async (token: string, input: { title: string; run: AiceRun; is_public?: boolean }) =>
    validateAiceRecord(await request<AiceRunRecord>("/aice-runs", token, { method: "POST", body: JSON.stringify({ ...input, is_public: input.is_public ?? false }) })),
};
