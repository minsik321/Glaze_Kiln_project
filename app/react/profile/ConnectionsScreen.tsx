import { useState } from "react";
import type { FeedUser } from "../home/feedData";

export type ConnectionTab = "followers" | "following";

function BackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>;
}

export function ConnectionsScreen({ ownerName, initialTab, followers, following, viewerFollowingIds, onBack, onOpenProfile, onToggleFollow }: {
  ownerName: string;
  initialTab: ConnectionTab;
  followers: readonly FeedUser[];
  following: readonly FeedUser[];
  viewerFollowingIds: ReadonlySet<string>;
  onBack: () => void;
  onOpenProfile: (userId: string) => void;
  onToggleFollow: (userId: string) => void;
}) {
  const [tab, setTab] = useState<ConnectionTab>(initialTab);
  const people = tab === "followers" ? followers : following;
  return (
    <section className="connections-screen" aria-label={`${ownerName} 팔로우 정보`}>
      <header className="connections-header">
        <button type="button" aria-label="프로필로 돌아가기" onClick={onBack}><BackIcon /></button>
        <div><strong>{ownerName}</strong><small>팔로우 정보</small></div>
        <span aria-hidden="true" />
      </header>
      <div className="connections-tabs" role="tablist" aria-label="팔로우 목록 선택">
        <button type="button" role="tab" aria-selected={tab === "followers"} onClick={() => setTab("followers")}>팔로워 <b>{followers.length}</b></button>
        <button type="button" role="tab" aria-selected={tab === "following"} onClick={() => setTab("following")}>팔로잉 <b>{following.length}</b></button>
      </div>
      <div className="connections-list" role="tabpanel">
        {people.map((person) => <article className="connection-item" key={person.id}>
          <button className={`connection-avatar avatar-tone-${person.avatarTone}`} type="button" aria-label={`${person.username} 프로필 보기`} onClick={() => onOpenProfile(person.id)} />
          <button className="connection-name" type="button" onClick={() => onOpenProfile(person.id)}><strong>{person.displayName}</strong><small>@{person.username}</small></button>
          <button className="connection-follow" type="button" aria-pressed={viewerFollowingIds.has(person.id)} onClick={() => onToggleFollow(person.id)}>{viewerFollowingIds.has(person.id) ? "팔로잉" : "팔로우"}</button>
        </article>)}
        {people.length === 0 && <div className="connections-empty" role="status"><strong>{tab === "followers" ? "아직 팔로워가 없어요" : "아직 팔로우한 사람이 없어요"}</strong><p>프로필에서 새로운 도예가를 만나보세요.</p></div>}
      </div>
    </section>
  );
}

