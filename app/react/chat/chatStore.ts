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

export async function saveChatMessage(ownerId: string, peerId: string, message: ChatMessage): Promise<void> {
  const { error } = await requireSupabase().from("chat_messages").insert({
    id: message.id,
    owner_id: ownerId,
    peer_id: peerId,
    body: message.body,
    sent_at: message.sentAt,
    sender: message.sender,
  });
  if (error) throw error;
}
