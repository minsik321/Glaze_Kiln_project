import type { NotificationItem } from "./notificationStore";

const DAY_MS = 86_400_000;

//: 7일 안이면 "이번 주", 그 전이면 "이전". 오늘 받은 것은 "오늘".
function groupOf(createdAt: string): "오늘" | "이번 주" | "이전" {
  const age = Date.now() - new Date(createdAt).getTime();
  return age < DAY_MS ? "오늘" : age < 7 * DAY_MS ? "이번 주" : "이전";
}

function BackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>;
}

function KindIcon({ kind }: { kind: NotificationItem["kind"] }) {
  if (kind === "message") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v10H8l-4 4z" /></svg>;
  if (kind === "comment") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v11H9l-4 3z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="8" r="3" /><path d="M4 19a6 6 0 0 1 12 0M18 8v6M15 11h6" /></svg>;
}

export function NotificationScreen({ notifications, onBack, onMarkRead, onOpenProfile, onOpenPost, onOpenChat }: {
  notifications: readonly NotificationItem[];
  onBack: () => void;
  onMarkRead: (ids: readonly string[]) => void;
  onOpenProfile?: (userId: string) => void;
  onOpenPost?: (postId: string) => void;
  onOpenChat?: (userId: string) => void;
}) {
  const unreadIds = notifications.filter((item) => !item.read).map((item) => item.id);
  const open = (item: NotificationItem) => {
    if (!item.read) onMarkRead([item.id]);
    if (item.kind === "comment" && item.postId) onOpenPost?.(item.postId);
    else if (item.kind === "message") onOpenChat?.(item.actorId);
    else if (item.kind === "follow") onOpenProfile?.(item.actorId);
  };

  return (
    <section className="notification-screen" aria-label="알림 목록 화면">
      <header className="notification-header">
        <button type="button" aria-label="홈 피드로 돌아가기" onClick={onBack}><BackIcon /></button>
        <h1>알림</h1>
        <button className="notification-read-all" type="button" disabled={unreadIds.length === 0} onClick={() => onMarkRead(unreadIds)}>모두 읽음</button>
      </header>
      <main className="notification-scroll">
        {notifications.length === 0 && <p className="notification-empty" role="status">아직 받은 알림이 없어요.</p>}
        {(["오늘", "이번 주", "이전"] as const).map((group) => {
          const items = notifications.filter((item) => groupOf(item.createdAt) === group);
          if (!items.length) return null;
          return (
            <section className="notification-group" key={group} aria-labelledby={`notification-${group}`}>
              <h2 id={`notification-${group}`}>{group}</h2>
              <div className="notification-list">
                {items.map((item) => (
                  <button className={`notification-item${item.read ? " is-read" : ""}`} type="button" key={item.id} onClick={() => open(item)}>
                    <span className="notification-avatar avatar-tone-2">
                      {item.avatarUrl && <img src={item.avatarUrl} alt="" />}
                      <i className={`notification-kind ${item.kind}`}><KindIcon kind={item.kind} /></i>
                    </span>
                    <span className="notification-copy"><strong>{item.user}</strong><span>{item.message}</span><time>{item.time}</time></span>
                    {!item.read && <b className="notification-unread" aria-label="읽지 않은 알림" />}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </main>
    </section>
  );
}
