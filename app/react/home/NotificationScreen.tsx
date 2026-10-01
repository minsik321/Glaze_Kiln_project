import { useState } from "react";

type NotificationItem = {
  id: string;
  kind: "comment" | "follow" | "like";
  user: string;
  message: string;
  time: string;
  avatarTone: number;
  image?: string;
  group: "오늘" | "이번 주";
};

const notifications: readonly NotificationItem[] = [
  { id: "n1", kind: "comment", user: "mira.ceramic", message: "청록 결정유 작업에 댓글을 남겼어요. “결정이 정말 선명하게 나왔네요!”", time: "8분 전", avatarTone: 2, image: "/glaze-textures/crystalline-turquoise.png", group: "오늘" },
  { id: "n2", kind: "follow", user: "dohoon.kiln", message: "회원님을 팔로우하기 시작했어요.", time: "1시간 전", avatarTone: 3, group: "오늘" },
  { id: "n3", kind: "like", user: "sena.glaze", message: "아이보리 시노유 작업을 저장했어요.", time: "3시간 전", avatarTone: 4, image: "/glaze-textures/shino-ivory.png", group: "오늘" },
  { id: "n4", kind: "comment", user: "jun.claylab", message: "흑유 오일스팟의 소성곡선에 답글을 남겼어요.", time: "어제", avatarTone: 5, image: "/glaze-textures/tenmoku-oilspot.png", group: "이번 주" },
  { id: "n5", kind: "follow", user: "haeun.pottery", message: "회원님을 팔로우하기 시작했어요.", time: "3일 전", avatarTone: 6, group: "이번 주" },
] as const;

function BackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>;
}

function KindIcon({ kind }: { kind: NotificationItem["kind"] }) {
  if (kind === "comment") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v11H9l-4 3z" /></svg>;
  if (kind === "follow") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="8" r="3" /><path d="M4 19a6 6 0 0 1 12 0M18 8v6M15 11h6" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>;
}

export function NotificationScreen({ onBack }: { onBack: () => void }) {
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set(["n4", "n5"]));
  const markAllRead = () => setReadIds(new Set(notifications.map((item) => item.id)));

  return (
    <section className="notification-screen" aria-label="알림 목록 화면">
      <header className="notification-header">
        <button type="button" aria-label="홈 피드로 돌아가기" onClick={onBack}><BackIcon /></button>
        <h1>알림</h1>
        <button className="notification-read-all" type="button" onClick={markAllRead}>모두 읽음</button>
      </header>
      <main className="notification-scroll">
        {(["오늘", "이번 주"] as const).map((group) => (
          <section className="notification-group" key={group} aria-labelledby={`notification-${group}`}>
            <h2 id={`notification-${group}`}>{group}</h2>
            <div className="notification-list">
              {notifications.filter((item) => item.group === group).map((item) => {
                const isRead = readIds.has(item.id);
                return (
                  <button className={`notification-item${isRead ? " is-read" : ""}`} type="button" key={item.id} onClick={() => setReadIds((current) => new Set(current).add(item.id))}>
                    <span className={`notification-avatar avatar-tone-${item.avatarTone}`}><i className={`notification-kind ${item.kind}`}><KindIcon kind={item.kind} /></i></span>
                    <span className="notification-copy"><strong>{item.user}</strong><span>{item.message}</span><time>{item.time}</time></span>
                    {item.image && <img src={item.image} alt="관련 유약 게시물" />}
                    {!isRead && <b className="notification-unread" aria-label="읽지 않은 알림" />}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </section>
  );
}
