import { sampleAiceRun, type AiceRun, type RecipeCandidate } from "../aice/contract";
import { CLAY_BODIES, WARE_CATALOG } from "../aice/catalog";
import type { FeedPost, FeedUser } from "../home/feedData";

export const FEED_IMPORT_SOURCE_REFERENCE = "aice-feed-post-import";
export type WorkRecordOrigin = "mine" | "imported";

export function workRecordOrigin(run: AiceRun): WorkRecordOrigin {
  return run.sources.some((source) => source.reference === FEED_IMPORT_SOURCE_REFERENCE)
    ? "imported"
    : "mine";
}

export function isVisibleWorkRecord(run: AiceRun) {
  return run.status === "evaluated" || workRecordOrigin(run) === "imported";
}

export function isChatGenerationRecord(run: AiceRun) {
  return run.status === "draft"
    && workRecordOrigin(run) === "mine"
    && Boolean(run.intake?.prompt_text.trim())
    && Boolean(run.intake?.candidates.candidates.length);
}

export function importedWorkMemo(run: AiceRun) {
  return run.sources.find((source) => source.reference === FEED_IMPORT_SOURCE_REFERENCE)?.interpretation ?? "";
}

function applicationMethod(value: string): AiceRun["application"]["method"] {
  if (value.includes("붓")) return "brushing";
  if (value.includes("분무")) return "spraying";
  if (value.includes("부")) return "pouring";
  return "dipping";
}

function goalGloss(finish: string): AiceRun["goal"]["gloss"] {
  if (finish.includes("무광")) return "matte";
  if (finish.includes("반광")) return "semi_gloss";
  return "gloss";
}

export function feedPostToWorkRecord(post: FeedPost, user: FeedUser, now = new Date().toISOString()): AiceRun {
  const runId = crypto.randomUUID();
  const peak = Math.max(...post.curve.map((point) => point.temperatureC));
  const photo = {
    id: `${runId}-recipe-photo`,
    kind: "recipe" as const,
    storage_path: null,
    data_url: null,
    placeholder: true,
    source_type: "observed" as const,
    rights_confirmed: false,
    alt: post.label,
  };
  const candidate: RecipeCandidate = {
    id: `imported-${post.id}`,
    name: post.glazeName,
    materials: Object.fromEntries(post.recipe.map((item) => [item.name, item.amount])),
    colorants: Object.fromEntries(post.colorants.map((item) => [item.name, item.amount])),
    colorant_note: post.colorants.length ? "게시물에 기록된 발색 첨가물" : "첨가물 없음",
    predicted_firing_range: { value: [Math.max(0, peak - 40), peak], unit: "°C", source_type: "observed", confidence: .7, note: `${user.displayName}님의 공개 작업기록에서 가져온 범위` },
    predicted_firing_note: `${post.firing} · ${post.cone}`,
    photo,
    source_type: "observed",
    source_ids: [post.id],
    composition_note: "다른 사용자가 공개한 게시물의 배합 기록",
    target_gloss: goalGloss(post.finish).toUpperCase(),
    target_transparency: "OPAQUE",
    rationale: "게시물의 레시피와 소성 과정을 내 작업의 시작점으로 가져왔습니다.",
  };
  const base = sampleAiceRun(now);

  return {
    ...base,
    run_id: runId,
    title: `${post.glazeName} · ${user.displayName}님의 작업`,
    status: "draft",
    goal: { ...base.goal, gloss: goalGloss(post.finish), texture: post.finish },
    recipe: {
      ...base.recipe,
      id: candidate.id,
      name: post.glazeName,
      photo,
      firing_range: { ...candidate.predicted_firing_range, value: [Math.max(0, peak - 40), peak] },
      source_ids: [post.id],
      materials: { ...candidate.materials },
      colorants: { ...candidate.colorants },
      colorant_note: candidate.colorant_note,
    },
    ware: { ...base.ware, clay_body: post.clayBody },
    application: {
      ...base.application,
      method: applicationMethod(post.application),
      before_weight: { ...base.application.before_weight, note: `원 게시물 기록: ${post.application}` },
      after_weight: { ...base.application.after_weight, note: `원 게시물 기록: ${post.application}` },
    },
    curves: {
      baseline: {
        id: `imported-curve-${post.id}`,
        role: "baseline",
        points: post.curve.map((point) => ({ minute: point.minute, temperature_c: point.temperatureC })),
        source_type: "observed",
        reason: `${user.displayName}님의 게시물에 기록된 ${post.firing} 소성곡선`,
      },
      candidates: [],
      selected_id: null,
    },
    result: { ...base.result, gloss: post.finish, texture: post.finish },
    sources: [
      ...base.sources,
      {
        source_type: "observed",
        reference: FEED_IMPORT_SOURCE_REFERENCE,
        locator: post.id,
        original_condition: `${post.firing} · ${post.cone} · ${post.application}`,
        conversion: post.image,
        interpretation: post.memo,
        limitation: "다른 사용자의 공개 게시물에서 가져온 기록이며 동일한 결과를 보장하지 않음",
        confidence: "medium",
      },
    ],
    intake: {
      prompt_text: `${user.displayName}님의 ${post.glazeName} 작업기록에서 가져옴`,
      prompt_photos: [],
      candidates: { candidates: [candidate], selected_id: candidate.id },
    },
    created_at: now,
    updated_at: now,
  };
}

const METHOD_LABELS: Record<AiceRun["application"]["method"], string> = { dipping: "담금", pouring: "부기", brushing: "붓칠", spraying: "분무" };

//: 작업기록에서 "작업 게시"로 넘어갈 때 폼에 미리 채워 넣는 값. 사용자가 고칠 수
//: 있는 것은 `title`(유약 이름)·`memo`·사진뿐이고, 나머지(`details`)는 기록 그대로
//: 읽기 전용으로 보여 주며 게시물에 실린다.
export type RecordPostSeed = {
  recordId: string;
  title: string;
  memo: string;
  photo: AiceRun["recipe"]["photo"] | null;
  details: {
    ware: string;
    clayBody: string;
    application: string;
    firing: string;
    finish: string;
    recipe: Array<{ name: string; amount: number }>;
    colorants: Array<{ name: string; amount: number }>;
    curve: Array<{ minute: number; temperatureC: number }>;
  };
};

export function workRecordToPostSeed(recordId: string, run: AiceRun): RecordPostSeed {
  const curve = run.curves.baseline.points.map((point) => ({ minute: point.minute, temperatureC: point.temperature_c }));
  const peak = curve.length ? Math.max(...curve.map((point) => point.temperatureC)) : null;
  const totalMinutes = curve.length ? Math.max(...curve.map((point) => point.minute)) : 0;
  return {
    recordId,
    title: run.recipe.name,
    memo: importedWorkMemo(run),
    photo: run.result.photo?.storage_path || run.result.photo?.data_url ? run.result.photo : run.recipe.photo ?? null,
    details: {
      ware: WARE_CATALOG.find((ware) => ware.id === run.ware.preset)?.label ?? run.ware.preset,
      clayBody: CLAY_BODIES.find((body) => body.id === run.ware.clay_body)?.label ?? run.ware.clay_body,
      application: METHOD_LABELS[run.application.method],
      firing: peak === null ? "소성 기록 없음" : `최고 ${peak}℃ · ${Math.floor(totalMinutes / 60)}시간 ${totalMinutes % 60}분`,
      finish: run.result.gloss ?? "",
      recipe: Object.entries(run.recipe.materials).map(([name, amount]) => ({ name, amount })),
      colorants: Object.entries(run.recipe.colorants ?? {}).map(([name, amount]) => ({ name, amount })),
      curve,
    },
  };
}
