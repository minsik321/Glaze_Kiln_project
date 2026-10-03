import { useState, type FormEvent } from "react";
import type { FeedPost, FeedUser } from "./feedData";

export type PostComment = {
  id: string;
  body: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  createdAt: string;
};

function BackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>;
}

function MoreIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>;
}

function ShareIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m0 0L7 8m5-5 5 5" /><path d="M5 12v8h14v-8" /></svg>;
}

function BookmarkIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" /></svg>;
}

function PlusIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
}

function CheckIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7" /></svg>;
}

function FiringCurve({ post }: { post: FeedPost }) {
  const maxMinute = Math.max(...post.curve.map((point) => point.minute));
  const maxTemperature = Math.max(...post.curve.map((point) => point.temperatureC));
  const points = post.curve.map((point) => {
    const x = 38 + point.minute / maxMinute * 394;
    const y = 178 - point.temperatureC / 1350 * 144;
    return `${x},${y}`;
  }).join(" ");

  return (
    <section className="post-detail-card post-curve-card" aria-labelledby="post-curve-title">
      <div className="post-section-heading"><div><span>FIRING CURVE</span><h2 id="post-curve-title">소성곡선</h2></div><strong>{maxTemperature}℃</strong></div>
      <svg viewBox="0 0 470 210" role="img" aria-label={`${post.glazeName} 소성곡선, 최고온도 ${maxTemperature}도`}>
        <defs><linearGradient id={`curve-fill-${post.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1eadff" stopOpacity=".22" /><stop offset="1" stopColor="#1eadff" stopOpacity="0" /></linearGradient></defs>
        {[400, 800, 1200].map((temperature) => <g key={temperature}><line x1="38" x2="432" y1={178 - temperature / 1350 * 144} y2={178 - temperature / 1350 * 144} /><text x="31" y={181 - temperature / 1350 * 144} textAnchor="end">{temperature}</text></g>)}
        <line x1="38" x2="432" y1="178" y2="178" />
        <polygon points={`38,178 ${points} 432,178`} fill={`url(#curve-fill-${post.id})`} />
        <polyline className="post-curve-line" points={points} />
        {post.curve.map((point) => <circle key={`${point.minute}-${point.temperatureC}`} cx={38 + point.minute / maxMinute * 394} cy={178 - point.temperatureC / 1350 * 144} r="3.5" />)}
        <text x="38" y="198">0h</text><text x="432" y="198" textAnchor="end">{Math.round(maxMinute / 60)}h {maxMinute % 60}m</text>
      </svg>
      <div className="post-curve-summary">
        <div><small>최고온도</small><strong>{maxTemperature}℃</strong></div>
        <div><small>총 소성시간</small><strong>{Math.floor(maxMinute / 60)}시간 {maxMinute % 60}분</strong></div>
        <div><small>소성 방식</small><strong>{post.firing}</strong></div>
      </div>
    </section>
  );
}

export function PostDetailScreen({ post, user, viewer, comments, isOwnPost = false, isFollowing = false, isSaved = false, onToggleFollow, onToggleSaved, onEdit, onDelete, onImportRecipe, onAddComment, onBack, onOpenProfile, onStartChat }: { post: FeedPost; user: FeedUser; viewer: { displayName: string; username: string; avatarUrl: string }; comments: readonly PostComment[]; isOwnPost?: boolean; isFollowing?: boolean; isSaved?: boolean; onToggleFollow?: () => void; onToggleSaved?: () => void; onEdit?: (changes: Pick<FeedPost, "glazeName" | "memo" | "price" | "priceNegotiable">) => void; onDelete?: () => void; onImportRecipe?: () => Promise<void>; onAddComment: (body: string) => void; onBack: () => void; onOpenProfile: (userId: string) => void; onStartChat?: () => void }) {
  const [commentDraft, setCommentDraft] = useState("");
  const [importStatus, setImportStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [importError, setImportError] = useState("");
  const [importDialog, setImportDialog] = useState<"confirm" | "success" | "error" | null>(null);
  const [ownerDialog, setOwnerDialog] = useState<"edit" | "edited" | "delete" | null>(null);
  const [editTitle, setEditTitle] = useState(post.glazeName);
  const [editMemo, setEditMemo] = useState(post.memo);
  const [editPrice, setEditPrice] = useState(post.price ? String(post.price) : "");
  const [editNegotiable, setEditNegotiable] = useState(Boolean(post.priceNegotiable));

  function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = commentDraft.trim();
    if (!body) return;
    onAddComment(body);
    setCommentDraft("");
  }

  async function importRecipe() {
    if (!onImportRecipe || importStatus === "saving" || importStatus === "saved") return;
    setImportStatus("saving");
    setImportError("");
    try {
      await onImportRecipe();
      setImportStatus("saved");
      setImportDialog("success");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "작업기록에 추가하지 못했습니다.");
      setImportStatus("error");
      setImportDialog("error");
    }
  }

  function openEdit() {
    setEditTitle(post.glazeName);
    setEditMemo(post.memo);
    setEditPrice(post.price ? String(post.price) : "");
    setEditNegotiable(Boolean(post.priceNegotiable));
    setOwnerDialog("edit");
  }

  function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editTitle.trim() || !editMemo.trim()) return;
    onEdit?.({ glazeName: editTitle.trim(), memo: editMemo.trim(), price: post.kind === "sale" && editPrice ? Number(editPrice) : post.price, priceNegotiable: post.kind === "sale" ? editNegotiable : post.priceNegotiable });
    setOwnerDialog("edited");
  }

  const ownerDialogLayer = ownerDialog && (
    <div className="post-owner-dialog-layer">
      <section className="post-owner-dialog" role={ownerDialog === "edit" ? "dialog" : "alertdialog"} aria-modal="true" aria-labelledby="post-owner-dialog-title">
        {ownerDialog === "edit" && <form onSubmit={saveEdit}>
          <h2 id="post-owner-dialog-title">게시물 수정</h2>
          <label><span>{post.kind === "sale" ? "상품 이름" : "유약 이름"}</span><input value={editTitle} maxLength={50} onChange={(event) => setEditTitle(event.target.value)} /></label>
          {post.kind === "sale" && <label><span>가격</span><div className="post-owner-price"><input type="number" min="0" value={editPrice} onChange={(event) => setEditPrice(event.target.value)} /><b>원</b></div></label>}
          {post.kind === "sale" && <label className="post-owner-check"><input type="checkbox" checked={editNegotiable} onChange={(event) => setEditNegotiable(event.target.checked)} /><span>가격 협의 가능</span></label>}
          <label><span>상세 설명</span><textarea value={editMemo} maxLength={1000} onChange={(event) => setEditMemo(event.target.value)} /></label>
          <div className="post-owner-dialog-actions"><button type="button" onClick={() => setOwnerDialog(null)}>취소</button><button className="primary" type="submit" disabled={!editTitle.trim() || !editMemo.trim()}>저장</button></div>
        </form>}
        {ownerDialog === "edited" && <><h2 id="post-owner-dialog-title">수정되었습니다.</h2><button className="post-owner-dialog-done" type="button" onClick={() => setOwnerDialog(null)}>확인</button></>}
        {ownerDialog === "delete" && <><h2 id="post-owner-dialog-title">삭제하시겠습니까?</h2><p>삭제한 게시물은 다시 복구할 수 없습니다.</p><div className="post-owner-dialog-actions"><button type="button" onClick={() => setOwnerDialog(null)}>취소</button><button className="danger" type="button" onClick={onDelete}>삭제</button></div></>}
      </section>
    </div>
  );

  if (post.kind === "sale") {
    const price = post.price ? `${post.price.toLocaleString("ko-KR")}원` : "가격 협의";
    return (
      <section className="post-detail-screen sale-detail-screen" aria-label={`${post.glazeName} 판매 게시물`}>
        <header className="post-detail-header">
          <button type="button" aria-label="홈 피드로 돌아가기" onClick={onBack}><BackIcon /></button>
          <strong>기물 판매</strong>
          <button type="button" aria-label={isSaved ? "게시물 저장 취소" : "게시물 저장"} aria-pressed={isSaved} onClick={onToggleSaved}><BookmarkIcon /></button>
        </header>
        <main className="post-detail-scroll sale-detail-scroll">
          <section className={`post-author-panel${isOwnPost ? " own-post" : ""}`} aria-label="작성자 정보">
            <button className={`post-author-avatar avatar-tone-${user.avatarTone}`} type="button" aria-label={`${user.username} 프로필 보기`} onClick={() => onOpenProfile(user.id)} />
            <button className="post-author-name" type="button" onClick={() => onOpenProfile(user.id)}><strong>{user.displayName}</strong><span>@{user.username}</span></button>
            {isOwnPost && <button className="post-edit-button" type="button" onClick={openEdit}>수정</button>}
            {isOwnPost && <button className="post-delete-button" type="button" onClick={() => setOwnerDialog("delete")}>삭제</button>}
          </section>
          <img className="sale-detail-image" src={post.image} alt={post.label} />
          <section className="sale-detail-copy">
            <span>판매 중</span>
            <h1>{post.glazeName}</h1>
            <strong>{price}</strong>
            {post.priceNegotiable && <small>가격 협의 가능</small>}
            <time>{post.publishedAt}</time>
            {post.saleDetails && <dl className="sale-detail-facts">
              <div><dt>상품 상태</dt><dd>{post.saleDetails.condition}</dd></div>
              <div><dt>크기</dt><dd>{post.saleDetails.dimensions}</dd></div>
              <div><dt>거래 지역</dt><dd>{post.saleDetails.location}</dd></div>
              <div><dt>거래 방법</dt><dd>{post.saleDetails.delivery}</dd></div>
            </dl>}
            <p>{post.memo}</p>
          </section>
        </main>
        {!isOwnPost && <button className="sale-chat-button" type="button" onClick={onStartChat}>채팅으로 문의하기</button>}
        {ownerDialogLayer}
      </section>
    );
  }

  return (
    <section className="post-detail-screen" aria-label={`${post.glazeName} 게시물`}>
      <header className="post-detail-header">
        <button type="button" aria-label="홈 피드로 돌아가기" onClick={onBack}><BackIcon /></button>
        <strong>{user.username}</strong>
        <button type="button" aria-label="게시물 더보기"><MoreIcon /></button>
      </header>
      <main className="post-detail-scroll">
        <section className={`post-author-panel${isOwnPost ? " own-post" : ""}`} aria-label="작성자 정보">
          <button className={`post-author-avatar avatar-tone-${user.avatarTone}`} type="button" aria-label={`${user.username} 프로필 보기`} onClick={() => onOpenProfile(user.id)} />
          <button className="post-author-name" type="button" onClick={() => onOpenProfile(user.id)}><strong>{user.displayName}</strong><span>@{user.username}</span></button>
          {!isOwnPost && <button className="post-follow-button" type="button" aria-pressed={isFollowing} onClick={onToggleFollow}>{isFollowing ? "팔로잉" : "팔로우"}</button>}
          {isOwnPost && <button className="post-edit-button" type="button" onClick={openEdit}>수정</button>}
          {isOwnPost && <button className="post-delete-button" type="button" onClick={() => setOwnerDialog("delete")}>삭제</button>}
        </section>

        <figure className="post-hero">
          <img className={`crop-${post.crop}`} src={post.image} alt={post.label} />
          <figcaption>
            <div><span>{post.publishedAt}</span><h1>{post.glazeName}</h1><p>{post.finish}</p></div>
            <div className="post-hero-actions">
              <button type="button" aria-label={isSaved ? "게시물 저장 취소" : "게시물 저장"} aria-pressed={isSaved} onClick={onToggleSaved}><BookmarkIcon /></button>
              <button type="button" aria-label="공유"><ShareIcon /></button>
              {onImportRecipe && <button className={importStatus === "saved" ? "is-added" : ""} type="button" aria-label={importStatus === "saved" ? "작업기록에 추가됨" : "내 작업 레시피에 추가"} disabled={importStatus === "saving" || importStatus === "saved"} onClick={() => setImportDialog("confirm")}>{importStatus === "saved" ? <CheckIcon /> : <PlusIcon />}</button>}
            </div>
          </figcaption>
        </figure>

        <div className="post-detail-tags" aria-label="작업 핵심 정보"><span>{post.firing}</span><span>{post.cone}</span><span>{post.clayBody}</span></div>
        <FiringCurve post={post} />

        <section className="post-detail-card post-recipe-card" aria-labelledby="post-recipe-title">
          <div className="post-section-heading"><div><span>GLAZE RECIPE</span><h2 id="post-recipe-title">유약 레시피</h2></div><small>기본 배합 100%</small></div>
          <div className="post-recipe-list">
            {post.recipe.map((material) => <div key={material.name}><span>{material.name}</span><i><b style={{ width: `${material.amount}%` }} /></i><strong>{material.amount}%</strong></div>)}
          </div>
          <div className="post-colorants"><strong>발색 첨가물</strong>{post.colorants.length ? post.colorants.map((item) => <span key={item.name}>{item.name} {item.amount}%</span>) : <span>첨가물 없음</span>}</div>
        </section>

        <section className="post-detail-card post-info-card" aria-labelledby="post-info-title">
          <div className="post-section-heading"><div><span>WORK DETAILS</span><h2 id="post-info-title">작업 정보</h2></div></div>
          <dl>
            <div><dt>소지</dt><dd>{post.clayBody}</dd></div>
            <div><dt>시유</dt><dd>{post.application}</dd></div>
            <div><dt>소성</dt><dd>{post.firing}</dd></div>
            <div><dt>온도 기준</dt><dd>{post.cone}</dd></div>
            <div><dt>표면</dt><dd>{post.finish}</dd></div>
          </dl>
        </section>

        <section className="post-detail-card post-memo-card" aria-labelledby="post-memo-title">
          <div className="post-section-heading"><div><span>KILN NOTE</span><h2 id="post-memo-title">작업 메모</h2></div></div>
          <p>{post.memo}</p>
        </section>

        <section className="post-detail-card post-comments-card" aria-labelledby="post-comments-title">
          <div className="post-section-heading"><div><span>COMMENTS</span><h2 id="post-comments-title">댓글 <small>{comments.length}</small></h2></div></div>
          <form className="post-comment-form" onSubmit={submitComment}>
            <span className="post-comment-avatar avatar-tone-1" style={viewer.avatarUrl ? { backgroundImage: `url(${viewer.avatarUrl})` } : undefined} aria-label={`${viewer.displayName} 프로필 이미지`} />
            <label className="sr-only" htmlFor={`post-comment-${post.id}`}>댓글 입력</label>
            <input id={`post-comment-${post.id}`} value={commentDraft} maxLength={300} onChange={(event) => setCommentDraft(event.target.value)} placeholder="댓글을 남겨보세요" />
            <button type="submit" disabled={!commentDraft.trim()}>등록</button>
          </form>
          <div className="post-comment-list" aria-live="polite">
            {comments.length === 0 && <p className="post-comments-empty">첫 댓글을 남겨보세요.</p>}
            {comments.map((comment) => (
              <article className="post-comment" key={comment.id}>
                <span className="post-comment-avatar avatar-tone-1" style={comment.avatarUrl ? { backgroundImage: `url(${comment.avatarUrl})` } : undefined} aria-label={`${comment.displayName} 프로필 이미지`} />
                <div><header><strong>{comment.displayName}</strong><span>@{comment.username}</span><time>{comment.createdAt}</time></header><p>{comment.body}</p></div>
              </article>
            ))}
          </div>
        </section>
      </main>
      {importDialog && (
        <div className="post-import-dialog-layer">
          <section className="post-import-dialog" role="alertdialog" aria-modal="true" aria-labelledby="post-import-dialog-title">
            {importDialog === "confirm" && <>
              <h2 id="post-import-dialog-title">작업 기록을 가져오시겠습니까?</h2>
              <p>레시피와 소성 과정이 내 작업기록에 저장됩니다.</p>
              <div className="post-import-dialog-actions">
                <button type="button" disabled={importStatus === "saving"} onClick={() => setImportDialog(null)}>아니오</button>
                <button className="primary" type="button" disabled={importStatus === "saving"} onClick={() => void importRecipe()}>{importStatus === "saving" ? "저장 중…" : "예"}</button>
              </div>
            </>}
            {importDialog === "success" && <>
              <h2 id="post-import-dialog-title">작업 기록을 저장했습니다</h2>
              <button className="post-import-dialog-done" type="button" onClick={() => setImportDialog(null)}>확인</button>
            </>}
            {importDialog === "error" && <>
              <h2 id="post-import-dialog-title">작업 기록을 저장하지 못했습니다</h2>
              <p>{importError}</p>
              <div className="post-import-dialog-actions">
                <button type="button" onClick={() => setImportDialog(null)}>닫기</button>
                <button className="primary" type="button" onClick={() => { setImportStatus("idle"); setImportDialog("confirm"); }}>다시 시도</button>
              </div>
            </>}
          </section>
        </div>
      )}
      {ownerDialogLayer}
    </section>
  );
}
