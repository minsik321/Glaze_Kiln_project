import { relativeTime } from "../lib/api";
import { requireSupabase } from "../lib/supabase";

//: 알림은 public.notifications에 저장한다(RLS: 받는 사람만 읽고 read_at만 바꾼다).
//: 알림 생성은 DB 트리거(follows·post_comments insert)가 한다 — 앱은 읽고 읽음 처리만 한다.

export type NotificationItem = {
  id: string;
  kind: "follow" | "comment" | "message";
  actorId: string;
  user: string;
  avatarUrl: string;
  postId: string | null;
  message: string;
  time: string;
  createdAt: string;
  read: boolean;
};

type Row = { id: string; kind: "follow" | "comment" | "message"; actor_id: string; post_id: string | null; body: string | null; read_at: string | null; created_at: string };

export async function loadNotifications(): Promise<NotificationItem[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from("notifications")
    .select("id,kind,actor_id,post_id,body,read_at,created_at").order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  const rows = (data ?? []) as Row[];
  const actorIds = [...new Set(rows.map((row) => row.actor_id))];
  const profiles = new Map<string, { display_name: string | null; avatar_url: string | null }>();
  if (actorIds.length) {
    const { data: people } = await supabase.from("public_profiles").select("id,display_name,avatar_url").in("id", actorIds);
    for (const person of people ?? []) profiles.set(person.id, person);
  }
  return rows.map((row) => {
    const profile = profiles.get(row.actor_id);
    return {
      id: row.id, kind: row.kind, actorId: row.actor_id, postId: row.post_id,
      user: profile?.display_name || "가마쟁이", avatarUrl: profile?.avatar_url ?? "",
      message: row.kind === "follow" ? "회원님을 팔로우하기 시작했어요."
        : row.kind === "message" ? `메시지를 보냈어요. “${row.body ?? ""}”`
        : `회원님의 게시글에 댓글을 남겼어요. “${row.body ?? ""}”`,
      time: relativeTime(row.created_at), createdAt: row.created_at, read: row.read_at !== null,
    };
  });
}

export async function markNotificationsRead(ids: readonly string[]) {
  if (!ids.length) return;
  const { error } = await requireSupabase().from("notifications")
    .update({ read_at: new Date().toISOString() }).in("id", [...ids]).is("read_at", null);
  if (error) throw error;
}
