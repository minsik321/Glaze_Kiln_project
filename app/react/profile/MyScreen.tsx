import { useState } from "react";

type MyScreenProps = {
  username?: string;
  displayName?: string;
  variant?: "mine" | "other";
  avatarTone?: number;
  stats?: { records: number; followers: number; following: number };
  posts?: readonly { id: string; image: string; label: string; crop?: number }[];
  onBack?: () => void;
  onEditProfile?: () => void;
};

const posts = [
  "청회색 유약 테스트 타일",
  "검푸른 유약 사발",
  "분청 유약 머그",
  "아이보리 유약 샘플",
  "겹쳐 쌓은 손잡이 잔",
  "공방의 유약 그릇",
  "회백색 유약 테스트",
] as const;

function GridIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></svg>;
}

function ListIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" /></svg>;
}

function MenuIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" /></svg>;
}

function BackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>;
}

function MoreIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="18" cy="12" r="1" /></svg>;
}

export function MyScreen({ username = "Chloe.jung", displayName = "가마쟁이", variant = "mine", avatarTone = 1, stats = { records: 2, followers: 545, following: 256 }, posts: suppliedPosts, onBack, onEditProfile }: MyScreenProps) {
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [following, setFollowing] = useState(false);
  const isMine = variant === "mine";

  return (
    <section className={`my-screen ${isMine ? "mine" : "other"}`} aria-label={isMine ? "마이 프로필" : `${username} 프로필`}>
      <header className="my-header">
        {isMine
          ? <span aria-hidden="true" />
          : <button type="button" aria-label="홈 피드로 돌아가기" onClick={onBack}><BackIcon /></button>}
        <strong>{username}</strong>
        <button type="button" aria-label={isMine ? "마이 메뉴" : "프로필 더보기"}>{isMine ? <MenuIcon /> : <MoreIcon />}</button>
      </header>

      <div className="my-profile-summary">
        <div className={`my-avatar avatar-tone-${avatarTone}`} aria-label={`${displayName} 프로필 이미지`} />
        <strong className="my-display-name">{displayName}</strong>
        {isMine
          ? <button className="my-edit-button" type="button" onClick={onEditProfile}>프로필 편집</button>
          : <button className="my-follow-button" type="button" aria-pressed={following} onClick={() => setFollowing((value) => !value)}>{following ? "팔로잉" : "팔로우"}</button>}
      </div>

      <dl className="my-stats" aria-label="프로필 통계">
        <div><dt>기록</dt><dd>{stats.records}</dd></div>
        <div><dt>팔로워</dt><dd>{stats.followers}</dd></div>
        <div><dt>팔로잉</dt><dd>{stats.following}</dd></div>
      </dl>

      <div className="my-layout-tabs" role="tablist" aria-label="게시물 보기 방식">
        <button type="button" role="tab" aria-selected={layout === "grid"} aria-label="격자로 보기" onClick={() => setLayout("grid")}><GridIcon /></button>
        <button type="button" role="tab" aria-selected={layout === "list"} aria-label="목록으로 보기" onClick={() => setLayout("list")}><ListIcon /></button>
      </div>

      <div className={`my-posts ${layout}`} aria-label="내 게시물">
        {(suppliedPosts ?? posts.map((label, index) => ({ id: label, label, image: "", crop: index + 1 }))).map((post, index) => (
          <article className="my-post" key={post.id}>
            {post.image
              ? <img className={`my-post-placeholder crop-${post.crop ?? index + 1}`} src={post.image} alt={post.label} />
              : <div className={`my-post-placeholder tone-${index + 1}`} role="img" aria-label={post.label} />}
            {layout === "list" && <div className="my-post-copy"><strong>{post.label}</strong><small>{username}</small></div>}
          </article>
        ))}
      </div>
    </section>
  );
}
