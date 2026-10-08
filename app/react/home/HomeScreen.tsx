import { useEffect, useRef, useState } from "react";
import { FEED_POSTS, findFeedUser, type FeedPost, type FeedUser } from "./feedData";
import type { CreatePostKind } from "./CreatePostScreen";

type HomeScreenProps = {
  posts?: readonly FeedPost[];
  onStartWork: () => void;
  onCreatePost: (kind: CreatePostKind) => void;
  onOpenProfile: (userId: string) => void;
  onOpenPost: (postId: string) => void;
  onOpenSearch: () => void;
  /** @deprecated Bookmarks now open from the My screen. */
  onOpenBookmarks?: () => void;
  onOpenFollowingFeed: () => void;
  onOpenNotifications: () => void;
  //: 읽지 않은 알림이 있을 때만 알림 아이콘에 빨간 점을 단다.
  hasUnreadNotifications?: boolean;
  //: 내가 올린 게시글(`userId: "self"`)의 작성자 — 없으면 더미 목록의 첫 사용자로 잘못 표시된다.
  selfUser?: FeedUser;
};

function GridIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
}

function ListIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>;
}

function BellIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 17.5h15l-2-3V9.5a5.5 5.5 0 0 0-11 0v5z" /><path d="M9.5 20.5h5" /></svg>;
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

type FeedFilter = "all" | "recipe" | "sale";

export function HomeScreen({ posts = FEED_POSTS, onStartWork, onCreatePost, onOpenProfile, onOpenPost, onOpenSearch, onOpenFollowingFeed, onOpenNotifications, hasUnreadNotifications = false, selfUser }: HomeScreenProps) {
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterWrapRef = useRef<HTMLDivElement>(null);
  //: 홈은 다른 화면으로 가도 언마운트되지 않고 숨겨지기만 하므로, 메뉴 바깥을
  //: 누르면(다른 화면으로 가는 탭·버튼 포함) 닫아야 돌아왔을 때 열린 채 남지 않는다.
  useEffect(() => {
    if (!isFilterOpen) return;
    const close = (event: Event) => {
      if (event instanceof PointerEvent && filterWrapRef.current?.contains(event.target as Node)) return;
      setIsFilterOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setIsFilterOpen(false); };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [isFilterOpen]);
  const [filter, setFilter] = useState<FeedFilter>("all");
  const filteredPosts = posts.filter((post) => filter === "all"
    || (filter === "recipe" && post.kind !== "sale")
    || (filter === "sale" && post.kind === "sale"));

  return (
    <section className="home-screen" aria-label="홈 피드">
      <header className="home-header">
        <div className="home-view-actions" aria-label="피드 보기 방식">
          <button type="button" aria-label="격자 보기" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}><GridIcon /></button>
          <button type="button" aria-label="목록 보기" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><ListIcon /></button>
          <div className="home-type-filters" role="group" aria-label="게시물 종류 필터">
            <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>전체</button>
            <button type="button" aria-pressed={filter === "recipe"} onClick={() => setFilter((current) => current === "recipe" ? "all" : "recipe")}>레시피</button>
            <button type="button" aria-pressed={filter === "sale"} onClick={() => setFilter((current) => current === "sale" ? "all" : "sale")}>판매글</button>
          </div>
        </div>
        <div className="home-wordmark-wrap" ref={filterWrapRef}>
          <button className={`home-wordmark${isFilterOpen ? " is-open" : ""}`} type="button" aria-label="홈 피드 필터" aria-expanded={isFilterOpen} onClick={() => setIsFilterOpen((open) => !open)}>
            <svg className="home-wordmark-angle" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            <strong>AICE Kiln</strong>
          </button>
          {isFilterOpen && <div className="home-filter-menu" role="menu" aria-label="홈 피드 필터 선택">
            <button type="button" role="menuitem" onClick={() => { setIsFilterOpen(false); onOpenFollowingFeed(); }}>팔로우</button>
          </div>}
        </div>
        <div className="home-header-actions">
          <button type="button" aria-label="검색 열기" onClick={onOpenSearch}><SearchIcon /></button>
          <button className="home-notifications" type="button" aria-label="알림 목록" onClick={onOpenNotifications}><BellIcon />{hasUnreadNotifications && <span aria-hidden="true" />}</button>
        </div>
      </header>

      <main className={`home-feed home-feed--${layout}`} data-layout={layout}>
        {filteredPosts.length === 0 ? <div className="home-filter-empty" role="status"><strong>표시할 게시물이 없어요</strong><p>다른 필터를 선택해 보세요.</p></div> : layout === "grid"
          ? [filteredPosts.filter((_, index) => index % 2 === 0), filteredPosts.filter((_, index) => index % 2 === 1)].map((column, columnIndex) => (
            <div className="home-feed-column" key={columnIndex}>
              {column.map((item) => <FeedCard key={item.id} post={item} layout="grid" onOpenProfile={onOpenProfile} onOpenPost={onOpenPost} selfUser={selfUser} />)}
            </div>
          ))
          : <div className="home-feed-list">{filteredPosts.map((item) => <FeedCard key={item.id} post={item} layout="list" onOpenProfile={onOpenProfile} onOpenPost={onOpenPost} selfUser={selfUser} />)}</div>}
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

export function FeedCard({ post, layout, onOpenProfile, onOpenPost, selfUser }: { post: FeedPost; layout: "grid" | "list"; onOpenProfile: (userId: string) => void; onOpenPost: (postId: string) => void; selfUser?: FeedUser }) {
  const user = post.userId === "self" && selfUser ? selfUser : findFeedUser(post.userId);
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
            {isSale
              ? <div className="home-sale-summary"><span>판매</span><strong>{post.glazeName}</strong><b>{formatPrice(post)}</b><small>{post.saleDetails?.location} · {post.publishedAt}</small>{post.priceNegotiable && post.price && <em>가격 협의 가능</em>}</div>
              : <div className="home-work-summary"><strong>{post.glazeName}</strong><small>{post.firing} · {post.cone}</small></div>}
          </>
        : <div className="home-list-content">
            <div className="home-list-copy">
              <h2>{post.glazeName}</h2>
              {isSale ? <><p className="home-sale-price">{formatPrice(post)}</p><small>{post.saleDetails?.location} · {post.publishedAt}{post.priceNegotiable ? " · 가격 협의 가능" : ""}</small></> : <><p>{post.firing} · {post.cone}</p><small>{post.finish}</small></>}
            </div>
            <img className={`home-list-thumbnail crop-${post.crop}`} src={post.image} alt={post.label} loading="lazy" />
          </div>}
      </button>
    </article>
  );
}
