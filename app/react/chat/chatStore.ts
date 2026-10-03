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

const STORAGE_KEY = "aice-kiln-chat-threads-v1";

export function loadChatThreads(): ChatThread[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveChatThreads(threads: ChatThread[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
  } catch {
    // The chat still works in memory when storage is unavailable.
  }
}

