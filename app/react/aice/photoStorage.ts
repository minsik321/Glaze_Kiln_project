import { useEffect, useState } from "react";
import { requireSupabase, isSupabaseConfigured } from "../lib/supabase";
import type { AiceRun, PhotoAsset } from "./contract";

const BUCKET = { recipe: "aice-recipe-photos", result: "aice-result-photos" } as const;
const EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const uploaded = new Map<string, string>();

async function decodePhoto(dataUrl: string): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const match = /^data:(image\/(?:png|jpeg|webp|gif|svg\+xml));base64,([\s\S]+)$/i.exec(dataUrl);
  if (!match) return null;
  if (match[1].toLowerCase() === "image/svg+xml") {
    // Storage intentionally disallows SVG; render the local fallback preview as PNG.
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(image.naturalWidth || 512, 2048);
    canvas.height = Math.min(image.naturalHeight || 512, 2048);
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("예상 이미지를 PNG로 변환하지 못했습니다.");
    if (blob.size > 10 * 1024 * 1024) throw new Error("사진은 10 MB 이하만 저장할 수 있습니다.");
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: "image/png" };
  }
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("사진은 10 MB 이하만 저장할 수 있습니다.");
  return { bytes, mimeType: match[1].toLowerCase() };
}

async function storePhoto(photo: PhotoAsset, ownerId: string): Promise<PhotoAsset> {
  if (photo.storage_path) return { ...photo, data_url: null };
  if (!photo.data_url) return photo;
  const decoded = await decodePhoto(photo.data_url);
  if (!decoded) return photo;
  const cacheKey = `${ownerId}:${photo.kind}:${photo.data_url}`;
  let path = uploaded.get(cacheKey);
  if (!path) {
    path = `${ownerId}/${crypto.randomUUID()}.${EXTENSION[decoded.mimeType]}`;
    const { error } = await requireSupabase().storage.from(BUCKET[photo.kind]).upload(
      path, new Blob([decoded.bytes as BlobPart], { type: decoded.mimeType }),
      { contentType: decoded.mimeType, upsert: false },
    );
    if (error) throw new Error(`사진을 Supabase에 저장하지 못했습니다: ${error.message}`);
    uploaded.set(cacheKey, path);
    if (uploaded.size > 100) uploaded.delete(uploaded.keys().next().value!);
  }
  return { ...photo, storage_path: path, data_url: null };
}

export async function persistRunPhotos(run: AiceRun): Promise<AiceRun> {
  const photos = [run.recipe.photo, run.result.photo, ...(run.intake?.candidates.candidates.map((candidate) => candidate.photo) ?? [])];
  if (!isSupabaseConfigured || !photos.some((photo) => photo?.data_url && /^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,/i.test(photo.data_url))) return run;
  const { data, error } = await requireSupabase().auth.getUser();
  if (error || !data.user) throw new Error("사진을 저장하려면 다시 로그인해 주세요.");
  const ownerId = data.user.id;
  const candidates = run.intake?.candidates.candidates;
  const savedCandidates = candidates ? await Promise.all(candidates.map(async (candidate) => ({
    ...candidate, photo: await storePhoto(candidate.photo, ownerId),
  }))) : null;
  const selectedPhoto = savedCandidates?.find((candidate) => candidate.id === run.recipe.id)?.photo;
  return {
    ...run,
    recipe: { ...run.recipe, photo: selectedPhoto ?? await storePhoto(run.recipe.photo, ownerId) },
    intake: run.intake && savedCandidates ? {
      ...run.intake,
      candidates: { ...run.intake.candidates, candidates: savedCandidates },
    } : run.intake,
    result: { ...run.result, photo: run.result.photo ? await storePhoto(run.result.photo, ownerId) : null },
  };
}

export async function signedPhotoUrl(photo: Pick<PhotoAsset, "kind" | "storage_path" | "data_url">): Promise<string | null> {
  if (!photo.storage_path) return photo.data_url ?? null;
  const { data, error } = await requireSupabase().storage.from(BUCKET[photo.kind]).createSignedUrl(photo.storage_path, 3600);
  if (error) throw new Error(`저장된 사진을 불러오지 못했습니다: ${error.message}`);
  return data.signedUrl;
}

export function usePhotoUrl(photo: Pick<PhotoAsset, "kind" | "storage_path" | "data_url"> | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(photo?.data_url ?? null);
  useEffect(() => {
    let active = true;
    setUrl(photo?.data_url ?? null);
    if (photo?.storage_path) void signedPhotoUrl(photo).then((next) => {
      if (active) setUrl(next);
    }).catch(() => { if (active) setUrl(null); });
    return () => { active = false; };
  }, [photo?.kind, photo?.storage_path, photo?.data_url]);
  return url;
}

//: 홈 피드 게시글 사진 — 결과 사진 버킷의 내 폴더에 올리고 경로만 DB에 둔다.
//: 작업기록의 사진은 1시간짜리 서명 URL로 폼에 들어온다. 그대로 저장하면 곧 만료돼 사진이
//: 사라지므로, 받아서 data URL로 바꿔 내 폴더에 새로 올린다.
async function remoteImageToDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function persistPostImage(image: string): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  if (/^https?:\/\//i.test(image)) {
    const dataUrl = await remoteImageToDataUrl(image);
    return dataUrl ? persistPostImage(dataUrl) : null;
  }
  if (!/^data:image\//i.test(image)) return null;
  const { data, error } = await requireSupabase().auth.getUser();
  if (error || !data.user) throw new Error("사진을 저장하려면 다시 로그인해 주세요.");
  const stored = await storePhoto({ id: crypto.randomUUID(), kind: "result", storage_path: null, data_url: image, placeholder: false, source_type: "observed", rights_confirmed: false, alt: "" }, data.user.id);
  return stored.storage_path;
}

export function signedPostImageUrl(storagePath: string): Promise<string | null> {
  return signedPhotoUrl({ kind: "result", storage_path: storagePath, data_url: null });
}
