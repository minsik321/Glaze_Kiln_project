import { useState } from "react";
import { FEED_POSTS, findFeedUser } from "./feedData";

type HomeScreenProps = {
  onStartWork: () => void;
  onOpenProfile: (userId: string) => void;
};

function GridIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
}

function ListIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>;
}

function BookmarkIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" /></svg>;
}

function FlaskIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3" /><path d="M7.5 16h9" /></svg>;
}

export function HomeScreen({ onStartWork, onOpenProfile }: HomeScreenProps) {
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);

  return (
    <section className="home-screen" aria-label="홈 피드">
      <header className="home-header">
        <div className="home-view-actions" aria-label="피드 보기 방식">
          <button type="button" aria-label="격자 보기" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}><GridIcon /></button>
          <button type="button" aria-label="목록 보기" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><ListIcon /></button>
        </div>
        <div className="home-wordmark">
          <svg className="home-wordmark-angle" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          <strong>AICE Kiln</strong>
        </div>
        <button className="home-bookmark" type="button" aria-label="저장한 게시물"><BookmarkIcon /></button>
      </header>

      <main className={`home-feed home-feed--${layout}`} data-layout={layout}>
        {layout === "grid"
          ? [FEED_POSTS.filter((_, index) => index % 2 === 0), FEED_POSTS.filter((_, index) => index % 2 === 1)].map((column, columnIndex) => (
            <div className="home-feed-column" key={columnIndex}>
              {column.map((item) => <FeedCard key={item.id} post={item} layout="grid" onOpenProfile={onOpenProfile} />)}
            </div>
          ))
          : <div className="home-feed-list">{FEED_POSTS.map((item) => <FeedCard key={item.id} post={item} layout="list" onOpenProfile={onOpenProfile} />)}</div>}
      </main>

      <div className="home-action-dock">
        <div className="home-quick-create">
          {isCreateMenuOpen && (
            <div className="home-publish-menu" role="menu" aria-label="게시 유형 선택">
              <button type="button" role="menuitem" onClick={() => setIsCreateMenuOpen(false)}>유약 게시</button>
              <button type="button" role="menuitem" onClick={() => setIsCreateMenuOpen(false)}>기물 판매</button>
            </div>
          )}
          <button
            className="home-create-button home-create-plus"
            type="button"
            aria-label="게시하기"
            aria-expanded={isCreateMenuOpen}
            onClick={() => setIsCreateMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>
        <button className="home-create-button" type="button" onClick={onStartWork}>
          <FlaskIcon />
          <span>작업하기</span>
        </button>
      </div>
    </section>
  );
}

function FeedCard({ post, layout, onOpenProfile }: { post: (typeof FEED_POSTS)[number]; layout: "grid" | "list"; onOpenProfile: (userId: string) => void }) {
  const user = findFeedUser(post.userId);
  return (
    <article className={`home-feed-card home-feed-card--${layout}`}>
      <button className="home-card-author" type="button" aria-label={`${user.username} 프로필 보기`} onClick={() => onOpenProfile(user.id)}>
        <span className={`avatar-tone-${user.avatarTone}`} aria-hidden="true" />
        <small>{user.username}</small>
      </button>
      {layout === "grid"
        ? <img className={`home-feed-photo ${post.size} crop-${post.crop}`} src={post.image} alt={post.label} loading="lazy" />
        : <div className="home-list-content">
            <div className="home-list-copy">
              <h2>{post.glazeName}</h2>
              <p>{post.firing} · {post.cone}</p>
              <small>{post.finish}</small>
            </div>
            <img className={`home-list-thumbnail crop-${post.crop}`} src={post.image} alt={post.label} loading="lazy" />
          </div>}
    </article>
  );
}
