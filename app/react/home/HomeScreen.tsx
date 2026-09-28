type HomeScreenProps = {
  onStartWork: () => void;
};

const feedItems = [
  { id: "tiles", user: "chloe.jung", className: "glaze-tiles", label: "색색의 유약 테스트 타일" },
  { id: "dark-bowl", user: "chloe.jung", className: "glaze-dark-bowl", label: "검푸른 유약을 입힌 사발" },
  { id: "stacked-mugs", user: "chloe.jung", className: "glaze-mugs", label: "겹쳐 쌓은 손잡이 잔" },
  { id: "blue-bowl", user: "chloe.jung", className: "glaze-blue-bowl", label: "청회색 유약 사발" },
  { id: "studio-bowls", user: "chloe.jung", className: "glaze-studio", label: "공방의 여러 유약 그릇" },
  { id: "pink-cup", user: "chloe.jung", className: "glaze-pink-cup", label: "분홍빛 유약 컵" },
] as const;

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

export function HomeScreen({ onStartWork }: HomeScreenProps) {
  return (
    <section className="home-screen" aria-label="홈 피드">
      <header className="home-header">
        <div className="home-view-actions" aria-label="피드 보기 방식">
          <button type="button" aria-label="격자 보기"><GridIcon /></button>
          <button type="button" aria-label="목록 보기"><ListIcon /></button>
        </div>
        <div className="home-wordmark"><span aria-hidden="true">⌄</span><strong>AICE Kiln</strong></div>
        <button className="home-bookmark" type="button" aria-label="저장한 게시물"><BookmarkIcon /></button>
      </header>

      <main className="home-feed">
        {[feedItems.filter((_, index) => index % 2 === 0), feedItems.filter((_, index) => index % 2 === 1)].map((column, columnIndex) => (
          <div className="home-feed-column" key={columnIndex}>
            {column.map((item) => (
              <article className="home-feed-card" key={item.id}>
                <div className="home-card-author"><span aria-hidden="true" /><small>{item.user}</small></div>
                <div className={`home-feed-photo ${item.className}`} role="img" aria-label={item.label} />
              </article>
            ))}
          </div>
        ))}
      </main>

      <button className="home-create-button" type="button" onClick={onStartWork}>
        <FlaskIcon />
        <span>작업하기</span>
      </button>
    </section>
  );
}
