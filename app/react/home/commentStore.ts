import { relativeTime } from "../lib/api";
import { requireSupabase } from "../lib/supabase";
import type { PostComment } from "./PostDetailScreen";

//: 댓글은 public.post_comments에 저장한다(RLS: 읽기는 로그인 사용자 전체, 쓰기·삭제는 작성자만).
//: 작성자 이름·아바타는 public_profiles에서 읽는다 — 프로필을 바꾸면 예전 댓글에도 반영된다.

type CommentRow = { id: string; user_id: string; body: string; created_at: string };

async function toComments(rows: readonly CommentRow[]): Promise<PostComment[]> {
  const authorIds = [...new Set(rows.map((row) => row.user_id))];
  const profiles = new Map<string, { display_name: string; avatar_url: string | null }>();
  if (authorIds.length) {
    const { data } = await requireSupabase().from("public_profiles").select("id,display_name,avatar_url").in("id", authorIds);
    for (const profile of data ?? []) profiles.set(profile.id, profile);
  }
  return rows.map((row) => {
    const name = profiles.get(row.user_id)?.display_name || "가마쟁이";
    return {
      id: row.id, body: row.body, displayName: name, username: name,
      avatarUrl: profiles.get(row.user_id)?.avatar_url ?? "", createdAt: relativeTime(row.created_at),
    };
  });
}

export async function loadComments(postId: string): Promise<PostComment[]> {
  const { data, error } = await requireSupabase().from("post_comments")
    .select("id,user_id,body,created_at").eq("post_id", postId).order("created_at", { ascending: true }).order("id");
  if (error) throw error;
  return toComments((data ?? []) as CommentRow[]);
}

export async function addComment(postId: string, userId: string, body: string): Promise<PostComment> {
  const { data, error } = await requireSupabase().from("post_comments")
    .insert({ post_id: postId, user_id: userId, body }).select("id,user_id,body,created_at").single();
  if (error) throw error;
  return (await toComments([data as CommentRow]))[0];
}
