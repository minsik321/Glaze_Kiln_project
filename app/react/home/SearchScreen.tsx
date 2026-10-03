import { useMemo, useState, type AnimationEvent as ReactAnimationEvent } from "react";
import type { FeedPost } from "./feedData";

function BackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>;
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></svg>;
}

function priceLabel(post: FeedPost) {
  return post.price ? `${post.price.toLocaleString("ko-KR")}원` : "가격 협의";
}

export function SearchScreen({ posts, closing = false, onBack, onOpenPost, onAnimationEnd }: {
  posts: readonly FeedPost[];
  closing?: boolean;
  onBack: () => void;
  onOpenPost: (postId: string) => void;
  onAnimationEnd?: (event: ReactAnimationEvent<HTMLElement>) => void;
}) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLocaleLowerCase("ko");
  const results = useMemo(() => normalized
    ? posts.filter((post) => [post.glazeName, post.label, post.memo].some((value) => value.toLocaleLowerCase("ko").includes(normalized)))
    : [], [normalized, posts]);

  return (
    <section className={`search-slide-panel${closing ? " is-closing" : ""}`} aria-label="검색 화면" onAnimationEnd={onAnimationEnd}>
      <div className="search-toolbar">
        <button className="search-back" type="button" aria-label="홈으로 돌아가기" onClick={onBack}><BackIcon /></button>
        <div className="search-input-wrap"><SearchIcon /><input type="search" aria-label="검색" value={query} autoFocus placeholder="유약 레시피 또는 기물 이름 검색" onChange={(event) => setQuery(event.target.value)} /></div>
      </div>
      {!normalized ? <div className="search-guide"><span aria-hidden="true"><SearchIcon /></span><strong>무엇을 찾고 계신가요?</strong><p>유약 레시피 이름이나 판매 중인 기물 이름을 검색해 보세요.</p></div>
      : results.length === 0 ? <div className="search-no-results" role="status"><strong>검색 결과가 없어요</strong><p>“{query.trim()}”이 포함된 게시물을 찾지 못했습니다.</p></div>
      : <div className="search-results" aria-label="검색 결과">
          <p><strong>{results.length}</strong>개의 게시물을 찾았어요</p>
          {results.map((post) => <button className="search-result-card" type="button" key={post.id} onClick={() => onOpenPost(post.id)}>
            <img src={post.image} alt="" />
            <span><em>{post.kind === "sale" ? "판매글" : "레시피"}</em><strong>{post.glazeName}</strong><small>{post.kind === "sale" ? priceLabel(post) : `${post.firing} · ${post.cone}`}</small><p>{post.memo}</p></span>
          </button>)}
        </div>}
    </section>
  );
}

