import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

//: 게시물 사진 영역 — 사진이 여러 장이면 가로로 넘겨 보고, 오른쪽 아래에 "1/2" 쪽 표시를 단다.
//: 터치는 브라우저의 scroll-snap이 처리하고, 마우스는 끌어서 넘길 수 있게 포인터 드래그를 더한다.
//: 한 장이면 예전과 똑같이 사진만 그린다(쪽 표시 없음).
export function PostPhotoCarousel({ images, alt, imageClassName, className = "" }: { images: readonly string[]; alt: string; imageClassName?: string; className?: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef({ active: false, startX: 0, startScroll: 0, moved: false });
  const count = images.length;

  //: 사진 장수가 바뀌면(수정) 첫 장으로 돌아간다.
  useEffect(() => {
    setIndex(0);
    trackRef.current?.scrollTo?.({ left: 0 });
  }, [count]);

  if (count <= 1) {
    return <div className={`post-photo-carousel ${className}`.trim()}><img className={imageClassName} src={images[0] ?? ""} alt={alt} /></div>;
  }

  function currentIndex(track: HTMLDivElement) {
    return Math.min(count - 1, Math.max(0, Math.round(track.scrollLeft / Math.max(1, track.clientWidth))));
  }

  function goTo(next: number) {
    const track = trackRef.current;
    if (!track) return;
    const target = Math.min(count - 1, Math.max(0, next));
    track.scrollTo?.({ left: target * track.clientWidth, behavior: "smooth" });
    setIndex(target);
  }

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || event.button !== 0 || !trackRef.current) return;
    drag.current = { active: true, startX: event.clientX, startScroll: trackRef.current.scrollLeft, moved: false };
    setDragging(true);
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const track = trackRef.current;
    if (!drag.current.active || !track) return;
    const delta = event.clientX - drag.current.startX;
    if (Math.abs(delta) > 4) drag.current.moved = true;
    track.scrollLeft = drag.current.startScroll - delta;
  }

  function endDrag() {
    const track = trackRef.current;
    if (!drag.current.active || !track) return;
    drag.current.active = false;
    setDragging(false);
    //: 끌던 위치에서 가장 가까운 장으로 맞춘다.
    goTo(currentIndex(track));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") { event.preventDefault(); goTo(index + 1); }
    if (event.key === "ArrowLeft") { event.preventDefault(); goTo(index - 1); }
  }

  return (
    <div className={`post-photo-carousel ${className}`.trim()}>
      <div
        ref={trackRef}
        className={`post-photo-track${dragging ? " is-dragging" : ""}`}
        role="group"
        aria-roledescription="carousel"
        aria-label={`${alt} 사진 ${count}장`}
        tabIndex={0}
        onScroll={(event) => { if (!drag.current.active) setIndex(currentIndex(event.currentTarget)); }}
        onKeyDown={onKeyDown}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        onClickCapture={(event) => { if (drag.current.moved) { event.preventDefault(); event.stopPropagation(); drag.current.moved = false; } }}
      >
        {images.map((src, position) => (
          <img key={`${position}-${src.slice(-24)}`} className={imageClassName} src={src} alt={`${alt} ${position + 1}/${count}`} draggable={false} />
        ))}
      </div>
      <span className="post-photo-counter" aria-live="polite">{index + 1}/{count}</span>
    </div>
  );
}
