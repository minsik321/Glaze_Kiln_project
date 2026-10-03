import { useState } from "react";
import { FEED_POSTS, findFeedUser, type FeedPost } from "./feedData";
import type { CreatePostKind } from "./CreatePostScreen";

type HomeScreenProps = {
  posts?: readonly FeedPost[];
  onStartWork: () => void;
  onCreatePost: (kind: CreatePostKind) => void;
  onOpenProfile: (userId: string) => void;
  onOpenPost: (postId: string) => void;
  onOpenSearch: () => void;
  onOpenNotifications: () => void;
};

function GridIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
}

function ListIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>;
}

function BellIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 16.5h11l-1.5-2V10a4 4 0 0 0-8 0v4.5z" /><path d="M10 19h4" /></svg>;
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>;
}

function FlaskIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3" /><path d="M7.5 16h9" /></svg>;
}

function PublishIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h10l4 4v12H5z" /><path d="M15 4v4h4M8 13h8M8 16h6" /></svg>;
}

function SaleIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16l-1 4a3 3 0 0 1-3 2 3 3 0 0 1-2-.8 3 3 0 0 1-4 0 3 3 0 0 1-2 .8 3 3 0 0 1-3-2z" /><path d="M6 12v8h12v-8M9 20v-5h6v5" /></svg>;
}

export function HomeScreen({ posts = FEED_POSTS, onStartWork, onCreatePost, onOpenProfile, onOpenPost, onOpenSearch, onOpenNotifications }: HomeScreenProps) {
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
        <div className="home-header-actions">
          <button type="button" aria-label="검색 열기" onClick={onOpenSearch}><SearchIcon /></button>
          <button className="home-notifications" type="button" aria-label="알림 목록" onClick={onOpenNotifications}><BellIcon /><span aria-hidden="true" /></button>
        </div>
      </header>

      <main className={`home-feed home-feed--${layout}`} data-layout={layout}>
        {layout === "grid"
          ? [posts.filter((_, index) => index % 2 === 0), posts.filter((_, index) => index % 2 === 1)].map((column, columnIndex) => (
            <div className="home-feed-column" key={columnIndex}>
              {column.map((item) => <FeedCard key={item.id} post={item} layout="grid" onOpenProfile={onOpenProfile} onOpenPost={onOpenPost} />)}
            </div>
          ))
          : <div className="home-feed-list">{posts.map((item) => <FeedCard key={item.id} post={item} layout="list" onOpenProfile={onOpenProfile} onOpenPost={onOpenPost} />)}</div>}
      </main>

      {isCreateMenuOpen && <button className="home-create-backdrop" type="button" aria-label="게시 메뉴 바깥 영역 닫기" onClick={() => setIsCreateMenuOpen(false)} />}

      <div className={`home-action-dock${isCreateMenuOpen ? " is-create-open" : ""}`}>
        <div className="home-quick-create">
          {isCreateMenuOpen && (
            <div className="home-publish-menu" id="home-publish-menu" role="menu" aria-label="게시 유형 선택">
              <button type="button" role="menuitem" onClick={() => { setIsCreateMenuOpen(false); onCreatePost("sale"); }}><SaleIcon /><span>내 기물 판매하기</span></button>
              <button type="button" role="menuitem" onClick={() => { setIsCreateMenuOpen(false); onCreatePost("work"); }}><PublishIcon /><span>작업 게시하기</span></button>
            </div>
          )}
          <button
            className={`home-create-button home-create-plus${isCreateMenuOpen ? " is-open" : ""}`}
            type="button"
            aria-label={isCreateMenuOpen ? "게시 메뉴 닫기" : "게시하기"}
            aria-expanded={isCreateMenuOpen}
            aria-controls="home-publish-menu"
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

function formatPrice(post: FeedPost) {
  if (post.price) return `${post.price.toLocaleString("ko-KR")}원`;
  return post.priceNegotiable ? "가격 협의" : "";
}

function FeedCard({ post, layout, onOpenProfile, onOpenPost }: { post: FeedPost; layout: "grid" | "list"; onOpenProfile: (userId: string) => void; onOpenPost: (postId: string) => void }) {
  const user = findFeedUser(post.userId);
  const isSale = post.kind === "sale";
  return (
    <article className={`home-feed-card home-feed-card--${layout}${isSale ? " is-sale" : ""}`}>
      <button className="home-card-author" type="button" aria-label={`${user.username} 프로필 보기`} onClick={() => onOpenProfile(user.id)}>
        <span className={`avatar-tone-${user.avatarTone}`} aria-hidden="true" />
        <small>{user.username}</small>
      </button>
      <button className="home-post-open" type="button" aria-label={`${post.glazeName} 게시물 보기`} onClick={() => onOpenPost(post.id)}>
        {layout === "grid"
        ? <><img className={`home-feed-photo ${post.size} crop-${post.crop}`} src={post.image} alt={post.label} loading="lazy" />
            {isSale && <div className="home-sale-summary"><span>판매</span><strong>{post.glazeName}</strong><b>{formatPrice(post)}</b>{post.priceNegotiable && post.price && <small>가격 협의 가능</small>}</div>}
          </>
        : <div className="home-list-content">
            <div className="home-list-copy">
              <h2>{post.glazeName}</h2>
              {isSale ? <><p className="home-sale-price">{formatPrice(post)}</p><small>{post.priceNegotiable ? "가격 협의 가능" : "기물 판매"}</small></> : <><p>{post.firing} · {post.cone}</p><small>{post.finish}</small></>}
            </div>
            <img className={`home-list-thumbnail crop-${post.crop}`} src={post.image} alt={post.label} loading="lazy" />
          </div>}
      </button>
    </article>
  );
}
