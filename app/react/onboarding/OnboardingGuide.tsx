import { useRef, useState, type KeyboardEvent, type UIEvent } from "react";

const GUIDES = [
  { src: "/onboarding-1.png", alt: "유약 레시피를 생성하는 방법 안내" },
  { src: "/onboarding-2.png", alt: "기물과 시유 조건을 입력하는 방법 안내" },
  { src: "/onboarding-3.png", alt: "맞춤형 가마 플랜으로 소성하는 방법 안내" },
  { src: "/onboarding-4.png", alt: "결과물을 기록하고 다음 작업에 반영하는 방법 안내" },
] as const;

export function OnboardingGuide({ onSkip, onStart }: { onSkip: () => void; onStart: () => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(0);
  const isLastPage = page === GUIDES.length - 1;

  function updatePage(event: UIEvent<HTMLDivElement>) {
    const track = event.currentTarget;
    if (!track.clientWidth) return;
    setPage(Math.min(GUIDES.length - 1, Math.max(0, Math.round(track.scrollLeft / track.clientWidth))));
  }

  function goToPage(index: number) {
    const track = trackRef.current;
    setPage(index);
    track?.scrollTo({ left: index * track.clientWidth, behavior: "smooth" });
  }

  function handleKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight" && page < GUIDES.length - 1) {
      event.preventDefault();
      goToPage(page + 1);
    }
    if (event.key === "ArrowLeft" && page > 0) {
      event.preventDefault();
      goToPage(page - 1);
    }
  }

  return (
    <main className="entry-screen onboarding-screen" aria-label="AICE Kiln 사용 가이드">
      <div
        ref={trackRef}
        className="onboarding-track"
        onScroll={updatePage}
        onKeyDown={handleKeys}
        tabIndex={0}
        aria-label={`사용 가이드 ${page + 1}/${GUIDES.length}`}
      >
        {GUIDES.map((guide, index) => (
          <section className="onboarding-slide" aria-label={`${index + 1}번째 안내`} key={guide.src}>
            <img src={guide.src} alt={guide.alt} draggable={false} />
          </section>
        ))}
      </div>

      <nav className="onboarding-pagination" aria-label="가이드 페이지 선택">
        {GUIDES.map((guide, index) => (
          <button
            type="button"
            key={guide.src}
            aria-label={`${index + 1}페이지로 이동`}
            aria-current={page === index ? "page" : undefined}
            onClick={() => goToPage(index)}
          />
        ))}
      </nav>

      <div className={`onboarding-actions${isLastPage ? " final" : ""}`}>
        {isLastPage ? (
          <button type="button" className="onboarding-join" onClick={onStart}>시작하기</button>
        ) : (
          <button type="button" className="onboarding-skip" onClick={onSkip}>건너뛰기</button>
        )}
      </div>
    </main>
  );
}
