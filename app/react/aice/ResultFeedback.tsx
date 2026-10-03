import { useState, type ChangeEvent } from "react";
import type { RelativeObservation, ResultEvaluation } from "./feedback";
import { Alert } from "./ui";

function ChipGroup<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: Array<{ id: T; label: string }>; onChange: (value: T) => void }) {
  return <fieldset className="feedback-chip-group"><legend>{label}</legend><div className="choice-chip-row">{options.map((option) => <button type="button" className="choice-chip" aria-pressed={value === option.id} key={option.id} onClick={() => onChange(option.id)}>{option.label}</button>)}</div></fieldset>;
}

export function ResultFeedback({
  value,
  onChange,
  targetPhoto,
}: {
  value: ResultEvaluation;
  onChange: (value: ResultEvaluation) => void;
  //: 화면 1에서 선택한 레시피 후보의 자동 생성 이미지 — "목표" 자리에
  //: 그대로 보여준다. AI 생성/플레이스홀더이며 실물 사진이 아니다.
  targetPhoto?: { base64: string; mediaType: string } | null;
}) {
  const update = <K extends keyof ResultEvaluation>(key: K, next: ResultEvaluation[K]) => onChange({ ...value, [key]: next });
  const toggleDefect = (defect: string) => {
    const selected = value.defects.includes(defect);
    const defectSeverities = { ...(value.defectSeverities ?? {}) };
    if (selected) delete defectSeverities[defect];
    else defectSeverities[defect] = 1;
    onChange({
      ...value,
      defects: selected ? value.defects.filter((item) => item !== defect) : [...value.defects, defect],
      defectSeverities,
    });
  };
  const updateDefectSeverity = (defect: string, severity: number) => onChange({
    ...value,
    defectSeverities: { ...(value.defectSeverities ?? {}), [defect]: severity },
  });
  const fileInputId = "result-photo-input";
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoDeferred, setPhotoDeferred] = useState(() => Boolean(value.match || value.color || value.gloss || value.texture || value.transparency));
  const photoStepComplete = Boolean(value.resultPhoto || photoDeferred);

  function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setPhotoError("5 MB 이하 PNG·JPEG·GIF·WebP 사진을 선택해 주세요.");
      return;
    }
    setPhotoError(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPhotoDeferred(false);
        update("resultPhoto", { dataUrl: reader.result, name: file.name });
      }
    };
    reader.readAsDataURL(file);
  }

  return <section className="result-feedback" aria-labelledby="result-feedback-title">
    <div className="result-feedback-heading"><h3 id="result-feedback-title">결과를 기록해요</h3></div>
    <div className="photo-intake progressive-feedback-field"><label htmlFor={fileInputId}>관찰 사진 첨부</label><input id={fileInputId} type="file" accept="image/*" onChange={handlePhotoChange} /><button type="button" className="photo-defer-button" onClick={() => setPhotoDeferred(true)}>나중에 입력</button></div>
    {photoError && <Alert tone="warning" title="사진을 확인해 주세요">{photoError}</Alert>}
    {photoStepComplete && <div className="prototype-result-compare progressive-feedback-field">
      <div>
        {targetPhoto
          ? <img className="result-photo" src={`data:${targetPhoto.mediaType};base64,${targetPhoto.base64}`} alt="목표 레시피의 AI 예상 이미지 — 실물 사진 아님" />
          : <span className="result-swatch target" />}
        <strong>목표</strong><small>{targetPhoto ? "선택한 레시피의 예상 이미지" : "선택한 목표 스와치"}</small>
      </div>
      <div>
        {value.resultPhoto
          ? <img className="result-photo" src={value.resultPhoto.dataUrl} alt="첨부한 관찰 사진" />
          : <span className="result-swatch simulated" />}
        <strong>관찰 결과</strong><small>{value.resultPhoto ? value.resultPhoto.name : "사진 미등록 · 선택 평가"}</small>
      </div>
    </div>}
    {photoStepComplete && <div className="progressive-feedback-field"><ChipGroup label="목표와 전체 인상" value={value.match} options={[{ id: "close", label: "목표에 가까워요" }, { id: "different", label: "차이가 있어요" }]} onChange={(match) => update("match", match)} /></div>}
    {value.match && <div className="progressive-feedback-field"><ChipGroup label="색상" value={value.color} options={[{ id: "close", label: "가까움" }, { id: "lighter", label: "더 밝음" }, { id: "darker", label: "더 어두움" }, { id: "different", label: "다른 색" }]} onChange={(color) => update("color", color)} /></div>}
    {value.color && <div className="progressive-feedback-field"><ChipGroup<RelativeObservation> label="광택" value={value.gloss} options={[{ id: "much_less", label: "광택이 없음" }, { id: "less", label: "광택감이 덜함" }, { id: "match", label: "목표와 일치함" }, { id: "more", label: "광택감이 더 있음" }, { id: "much_more", label: "광택감이 심함" }]} onChange={(gloss) => update("gloss", gloss)} /></div>}
    {value.gloss && <div className="progressive-feedback-field"><ChipGroup<RelativeObservation> label="질감" value={value.texture} options={[{ id: "much_more", label: "아주 거침" }, { id: "more", label: "비교적 거침" }, { id: "match", label: "목표와 일치함" }, { id: "less", label: "비교적 매끈함" }, { id: "much_less", label: "아주 매끈함" }]} onChange={(texture) => update("texture", texture)} /></div>}
    {value.texture && <div className="progressive-feedback-field"><ChipGroup<RelativeObservation> label="투명도" value={value.transparency} options={[{ id: "much_less", label: "거의 불투명함" }, { id: "less", label: "투명도가 덜함" }, { id: "match", label: "목표와 일치함" }, { id: "more", label: "투명도가 더 높음" }, { id: "much_more", label: "매우 투명함" }]} onChange={(transparency) => update("transparency", transparency)} /></div>}
    {value.transparency && <div className="progressive-feedback-field"><fieldset className="feedback-chip-group"><legend>보이는 결함 · 복수 선택</legend><div className="choice-chip-row">{[["pinholes", "핀홀"], ["crawling", "기어감"], ["crazing", "잔금"], ["running", "흘러내림"]].map(([id, label]) => <button type="button" className="choice-chip" aria-pressed={value.defects.includes(id)} key={id} onClick={() => toggleDefect(id)}>{label}</button>)}</div>{value.defects.length > 0 && <div className="defect-severity-list">{value.defects.map((id) => { const label = ({ pinholes: "핀홀", crawling: "기어감", crazing: "잔금", running: "흘러내림" } as Record<string, string>)[id] ?? id; return <label className="defect-severity-field" key={id}><span>{label} 정도</span><select aria-label={`${label} 정도`} value={value.defectSeverities?.[id] ?? 1} onChange={(event) => updateDefectSeverity(id, Number(event.target.value))}>{[[1, "매우 약함"], [2, "약함"], [3, "보통"], [4, "강함"], [5, "매우 강함"]].map(([level, text]) => <option key={level} value={level}>{level} - {text}</option>)}</select></label>; })}</div>}</fieldset></div>}
  </section>;
}
