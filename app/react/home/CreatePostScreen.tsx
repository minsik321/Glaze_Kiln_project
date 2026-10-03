import { useState, type ChangeEvent, type FormEvent } from "react";

export type CreatePostKind = "work" | "sale";

export type CreatePostDraft = {
  kind: CreatePostKind;
  title: string;
  description: string;
  images: string[];
  price: number | null;
  priceNegotiable: boolean;
};

type Props = {
  kind: CreatePostKind;
  onBack: () => void;
  onSubmit: (draft: CreatePostDraft) => void;
};

function BackIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>;
}

function CameraIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h4l1.5-2h5L16 7h4v12H4z" /><circle cx="12" cy="13" r="3.5" /></svg>;
}

function fileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("사진을 불러오지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

export function CreatePostScreen({ kind, onBack, onSubmit }: Props) {
  const [images, setImages] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [priceNegotiable, setPriceNegotiable] = useState(false);
  const [imageError, setImageError] = useState("");
  const isSale = kind === "sale";
  const priceValue = Number(price.replace(/,/g, ""));
  const canSubmit = images.length > 0
    && title.trim().length > 0
    && description.trim().length > 0
    && (!isSale || priceNegotiable || priceValue > 0);

  async function addImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    try {
      const next = await Promise.all(files.slice(0, 10 - images.length).map(fileDataUrl));
      setImages((current) => [...current, ...next].slice(0, 10));
      setImageError("");
    } catch {
      setImageError("사진을 불러오지 못했습니다. 다시 선택해 주세요.");
    } finally {
      event.target.value = "";
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      kind,
      title: title.trim(),
      description: description.trim(),
      images,
      price: isSale && priceValue > 0 ? priceValue : null,
      priceNegotiable: isSale && priceNegotiable,
    });
  }

  return (
    <section className="create-post-screen" aria-label={isSale ? "내 기물 판매하기 화면" : "작업 게시하기 화면"}>
      <header className="create-post-header">
        <button type="button" aria-label="홈으로 돌아가기" onClick={onBack}><BackIcon /></button>
        <h1>{isSale ? "내 기물 판매하기" : "작업 게시하기"}</h1>
        <span aria-hidden="true" />
      </header>

      <form className="create-post-form" onSubmit={submit}>
        <section className="create-photo-section" aria-labelledby="create-photo-title">
          <div className="create-field-heading"><strong id="create-photo-title">사진</strong><span>{images.length}/10</span></div>
          <div className="create-photo-list">
            <label className="create-photo-add">
              <CameraIcon />
              <span>사진 추가</span>
              <input type="file" accept="image/*" multiple aria-label="게시물 사진 선택" onChange={(event) => void addImages(event)} />
            </label>
            {images.map((image, index) => (
              <div className="create-photo-preview" key={`${image.slice(0, 30)}-${index}`}>
                <img src={image} alt={`선택한 사진 ${index + 1}`} />
                <button type="button" aria-label={`${index + 1}번째 사진 삭제`} onClick={() => setImages((current) => current.filter((_, currentIndex) => currentIndex !== index))}>×</button>
                {index === 0 && <small>대표</small>}
              </div>
            ))}
          </div>
          {imageError && <p className="create-post-error" role="alert">{imageError}</p>}
        </section>

        <label className="create-post-field">
          <span>{isSale ? "기물 제목" : "작업 제목"}</span>
          <input value={title} maxLength={50} onChange={(event) => setTitle(event.target.value)} placeholder={isSale ? "판매할 작품의 제목을 입력해 주세요" : "작업 제목을 입력해 주세요"} />
          <small>{title.length}/50</small>
        </label>

        {isSale && (
          <fieldset className="create-price-field">
            <legend>가격</legend>
            <div className="create-price-input"><input type="number" min="0" inputMode="numeric" aria-label="판매 가격" value={price} disabled={priceNegotiable} onChange={(event) => setPrice(event.target.value)} placeholder="가격 입력" /><span>원</span></div>
            <label className="create-negotiable"><input type="checkbox" checked={priceNegotiable} onChange={(event) => setPriceNegotiable(event.target.checked)} /><span>가격 협의 가능</span></label>
          </fieldset>
        )}

        <label className="create-post-field create-description-field">
          <span>내용 설명</span>
          <textarea value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)} placeholder={isSale ? "크기, 재료, 상태, 거래 방법 등을 자세히 적어주세요." : "작업 과정과 유약, 소성 결과 등을 소개해 주세요."} />
          <small>{description.length}/1000</small>
        </label>

        <button className="create-post-submit" type="submit" disabled={!canSubmit}>게시하기</button>
      </form>
    </section>
  );
}
