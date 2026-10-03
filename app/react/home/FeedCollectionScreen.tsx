import { useState } from "react";
import type { FeedPost } from "./feedData";
import { FeedCard } from "./HomeScreen";

function BackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>;
}

function GridIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
}

function ListIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>;
}

export function FeedCollectionScreen({ title, posts, emptyTitle, emptyDescription, onBack, onOpenProfile, onOpenPost }: {
  title: string;
  posts: readonly FeedPost[];
  emptyTitle: string;
  emptyDescription: string;
  onBack: () => void;
  onOpenProfile: (userId: string) => void;
  onOpenPost: (postId: string) => void;
}) {
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  return <section className="collection-feed-screen" aria-label={title}>
    <header className="collection-feed-header">
      <button type="button" aria-label="홈으로 돌아가기" onClick={onBack}><BackIcon /></button>
      <h1>{title}</h1>
      <div><button type="button" aria-label="격자 보기" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}><GridIcon /></button><button type="button" aria-label="목록 보기" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><ListIcon /></button></div>
    </header>
    {posts.length === 0 ? <div className="collection-feed-empty" role="status"><strong>{emptyTitle}</strong><p>{emptyDescription}</p></div>
    : <main className={`collection-feed collection-feed--${layout}`}>
        {layout === "grid" ? [posts.filter((_, index) => index % 2 === 0), posts.filter((_, index) => index % 2 === 1)].map((column, index) => <div className="home-feed-column" key={index}>{column.map((post) => <FeedCard key={post.id} post={post} layout="grid" onOpenProfile={onOpenProfile} onOpenPost={onOpenPost} />)}</div>)
        : <div className="home-feed-list">{posts.map((post) => <FeedCard key={post.id} post={post} layout="list" onOpenProfile={onOpenProfile} onOpenPost={onOpenPost} />)}</div>}
      </main>}
  </section>;
}

