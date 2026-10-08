import { requireSupabase } from "../lib/supabase";
import { registerFeedUser } from "./feedData";

//: 팔로우 관계는 public.follows에 저장한다(RLS: 읽기는 로그인 사용자 전체, 쓰기는 본인 관계만).
//: followee_id는 더미 작가 id("mira")이거나 실제 가입자 uuid다.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

//: 실제 가입자 id의 표시 이름을 한 번에 가져와 findFeedUser가 찾을 수 있게 등록한다.
async function registerNames(ids: readonly string[]) {
  const real = [...new Set(ids.filter((id) => UUID.test(id)))];
  if (!real.length) return;
  const { data, error } = await requireSupabase().from("public_profiles").select("id,display_name").in("id", real);
  if (error) throw error;
  for (const row of data ?? []) registerFeedUser(row.id, row.display_name ?? "");
}

export async function loadFollowing(ownerId: string): Promise<string[]> {
  const { data, error } = await requireSupabase().from("follows").select("followee_id").eq("follower_id", ownerId);
  if (error) throw error;
  const ids = (data ?? []).map((row) => row.followee_id as string);
  await registerNames(ids).catch(() => undefined);
  return ids;
}

export async function loadFollowers(ownerId: string): Promise<string[]> {
  const { data, error } = await requireSupabase().from("follows").select("follower_id").eq("followee_id", ownerId);
  if (error) throw error;
  const ids = (data ?? []).map((row) => row.follower_id as string);
  await registerNames(ids).catch(() => undefined);
  return ids;
}

export async function setFollowing(ownerId: string, targetId: string, follow: boolean) {
  const table = requireSupabase().from("follows");
  const { error } = follow
    ? await table.upsert({ follower_id: ownerId, followee_id: targetId }, { onConflict: "follower_id,followee_id", ignoreDuplicates: true })
    : await table.delete().eq("follower_id", ownerId).eq("followee_id", targetId);
  if (error) throw error;
}
