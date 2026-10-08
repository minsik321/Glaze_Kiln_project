import { requireSupabase } from "../lib/supabase";

export type ChatMessage = {
  id: string;
  body: string;
  sentAt: string;
  sender: "me" | "other";
};

export type ChatThread = {
  userId: string;
  username: string;
  displayName: string;
  avatarTone: number;
  updatedAt: string;
  messages: ChatMessage[];
};

type ThreadRow = {
  peer_id: string;
  username: string;
  display_name: string;
  avatar_tone: number;
  updated_at: string;
};

type MessageRow = {
  id: string;
  peer_id: string;
  body: string;
  sent_at: string;
  sender: "me" | "other";
};

export async function loadChatThreads(ownerId: string): Promise<ChatThread[]> {
  const db = requireSupabase();
  const { data: threadRows, error: threadError } = await db.from("chat_threads")
    .select("peer_id,username,display_name,avatar_tone,updated_at")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });
  if (threadError) throw threadError;
  const messagesByPeer = new Map<string, ChatMessage[]>();
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data: messageRows, error: messageError } = await db.from("chat_messages")
      .select("id,peer_id,body,sent_at,sender")
      .eq("owner_id", ownerId)
      .order("sent_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (messageError) throw messageError;
    for (const row of (messageRows ?? []) as MessageRow[]) {
      const messages = messagesByPeer.get(row.peer_id) ?? [];
      messages.push({ id: row.id, body: row.body, sentAt: row.sent_at, sender: row.sender });
      messagesByPeer.set(row.peer_id, messages);
    }
    if (!messageRows || messageRows.length < pageSize) break;
  }
  return ((threadRows ?? []) as ThreadRow[]).map((row) => ({
    userId: row.peer_id,
    username: row.username,
    displayName: row.display_name,
    avatarTone: row.avatar_tone,
    updatedAt: row.updated_at,
    messages: messagesByPeer.get(row.peer_id) ?? [],
  }));
}

export async function saveChatThread(ownerId: string, thread: ChatThread): Promise<void> {
  const { error } = await requireSupabase().from("chat_threads").upsert({
    owner_id: ownerId,
    peer_id: thread.userId,
    username: thread.username,
    display_name: thread.displayName,
    avatar_tone: thread.avatarTone,
  }, { onConflict: "owner_id,peer_id" });
  if (error) throw error;
}

//: 보낸 사람 사본과 (상대가 실제 가입자면) 받는 사람 사본을 서버 함수가 함께 만든다.
//: ownerId는 호출부 시그니처 호환용 — 서버는 로그인 세션의 사용자로 처리한다.
export async function saveChatMessage(_ownerId: string, peerId: string, message: ChatMessage): Promise<void> {
  const { error } = await requireSupabase().rpc("send_chat_message", {
    p_id: message.id,
    p_peer: peerId,
    p_body: message.body,
    p_sent_at: message.sentAt,
  });
  if (error) throw error;
}
