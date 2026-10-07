import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessage, ChatThread } from "./chatStore";

function ChatIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v12H9l-5 4z" /><path d="M8 10h8M8 13h5" /></svg>;
}

function BackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>;
}

function SendIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 17 8-17 8 3-8z" /><path d="M7 12h14" /></svg>;
}

function preview(thread: ChatThread) {
  return thread.messages.at(-1)?.body ?? "대화를 시작해 보세요.";
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function ChatListScreen({ threads, onOpen }: { threads: readonly ChatThread[]; onOpen: (userId: string) => void }) {
  const sorted = [...threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return (
    <section className="chat-screen chat-list-screen" aria-label="채팅">
      <header className="chat-header"><h1>채팅</h1></header>
      {sorted.length === 0 ? (
        <div className="chat-empty">
          <span aria-hidden="true"><ChatIcon /></span>
          <strong>아직 대화가 없어요</strong>
          <p>새로운 대화가 시작되면 여기에 표시됩니다.</p>
        </div>
      ) : (
        <div className="chat-list" aria-label="채팅 목록">
          {sorted.map((thread) => (
            <button type="button" className="chat-list-item" key={thread.userId} onClick={() => onOpen(thread.userId)}>
              <span className={`chat-avatar avatar-tone-${thread.avatarTone}`} aria-hidden="true" />
              <span className="chat-list-copy"><strong>{thread.displayName}</strong><small>@{thread.username}</small><span>{preview(thread)}</span></span>
              <time dateTime={thread.updatedAt}>{timeLabel(thread.updatedAt)}</time>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function ConversationScreen({ thread, onBack, onSend }: { thread: ChatThread; onBack: () => void; onSend: (message: ChatMessage) => Promise<void> | void }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [thread.messages.length]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError("");
    try {
      await onSend({ id: crypto.randomUUID(), body, sentAt: new Date().toISOString(), sender: "me" });
      setDraft("");
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "메시지를 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="conversation-screen" aria-label={`${thread.displayName}님과의 채팅`}>
      <header className="conversation-header">
        <button type="button" aria-label="채팅 목록으로 돌아가기" onClick={onBack}><BackIcon /></button>
        <span className={`chat-avatar avatar-tone-${thread.avatarTone}`} aria-hidden="true" />
        <div><strong>{thread.displayName}</strong><small>@{thread.username}</small></div>
      </header>
      <div className="conversation-messages" aria-live="polite">
        {thread.messages.length === 0 && <p className="conversation-start">{thread.displayName}님과 대화를 시작해 보세요.</p>}
        {thread.messages.map((message) => (
          <div className={`message-row ${message.sender}`} key={message.id}>
            <div><p>{message.body}</p><time dateTime={message.sentAt}>{timeLabel(message.sentAt)}</time></div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {sendError && <p role="alert">{sendError}</p>}
      <form className="message-composer" onSubmit={submit}>
        <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="메시지 입력" placeholder="메시지를 입력하세요" autoComplete="off" />
        <button type="submit" aria-label="메시지 보내기" disabled={!draft.trim() || sending}><SendIcon /></button>
      </form>
    </section>
  );
}
