import { useState, type ChangeEvent } from "react";
import type { ResultEvaluation } from "./feedback";
import { Alert, StatusBadge } from "./ui";

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
  const toggleDefect = (defect: string) => onChange({ ...value, defectsReviewed: false, defects: value.defects.includes(defect) ? value.defects.filter((item) => item !== defect) : [...value.defects, defect] });
  const fileInputId = "result-photo-input";
  const [photoError, setPhotoError] = useState<string | null>(null);

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
      if (typeof reader.result === "string") update("resultPhoto", { dataUrl: reader.result, name: file.name });
    };
    reader.readAsDataURL(file);
  }

  return <section className="result-feedback" aria-labelledby="result-feedback-title">
    <div className="result-feedback-heading"><div><h3 id="result-feedback-title">결과 관찰 기록</h3><p>평가 완료에는 전체 인상·광택·투명도와 결함 확인이 필요합니다. 사진·색상·질감은 선택 사항입니다.</p></div><StatusBadge tone="unavailable">실제 관찰 입력 · 품질 보장 아님</StatusBadge></div>
    <div className="photo-intake"><label htmlFor={fileInputId}>관찰 사진 첨부</label><input id={fileInputId} type="file" accept="image/*" onChange={handlePhotoChange} /></div>
    {photoError && <Alert tone="warning" title="사진을 확인해 주세요">{photoError}</Alert>}
    <div className="prototype-result-compare">
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
    </div>
    <ChipGroup label="목표와 전체 인상" value={value.match} options={[{ id: "close", label: "목표에 가까워요" }, { id: "different", label: "차이가 있어요" }]} onChange={(match) => update("match", match)} />
    <div className="feedback-grid"><ChipGroup label="색상" value={value.color} options={[{ id: "close", label: "가까움" }, { id: "lighter", label: "더 밝음" }, { id: "darker", label: "더 어두움" }, { id: "different", label: "다른 색" }]} onChange={(color) => update("color", color)} /><ChipGroup label="광택" value={value.gloss} options={[{ id: "matte", label: "무광" }, { id: "satin", label: "사틴" }, { id: "gloss", label: "유광" }]} onChange={(gloss) => update("gloss", gloss)} /><ChipGroup label="질감" value={value.texture} options={[{ id: "smooth", label: "매끈" }, { id: "slightly_rough", label: "약간 거침" }, { id: "rough", label: "거침" }]} onChange={(texture) => update("texture", texture)} /><ChipGroup label="투명도" value={value.transparency} options={[{ id: "opaque", label: "불투명" }, { id: "translucent", label: "반투명" }, { id: "transparent", label: "투명" }]} onChange={(transparency) => update("transparency", transparency)} /></div>
    <fieldset className="feedback-chip-group"><legend>보이는 결함 · 복수 선택</legend><div className="choice-chip-row">{[["pinholes", "핀홀"], ["crawling", "기어감"], ["crazing", "잔금"], ["running", "흘러내림"]].map(([id, label]) => <button type="button" className="choice-chip" aria-pressed={value.defects.includes(id)} key={id} onClick={() => toggleDefect(id)}>{label}</button>)}</div></fieldset>
    <label><input type="checkbox" checked={value.defectsReviewed ?? false} onChange={(event) => update("defectsReviewed", event.target.checked)} /> 결함을 확인했습니다 (선택하지 않았으면 결함 없음)</label>
    <fieldset className="feedback-scope"><legend>이 평가의 사용 범위</legend><label><input type="radio" name="feedback-scope" checked={value.scope === "personal"} onChange={() => update("scope", "personal")} /> 개인 보정에만 사용</label><label><input type="radio" name="feedback-scope" checked={value.scope === "common_candidate"} onChange={() => update("scope", "common_candidate")} /> 익명화 후 공통 개선 검토 후보</label></fieldset>
    {value.scope === "common_candidate" && <Alert tone="warning" title="자동 반영 안 함">품질·권리·동의를 검토하는 대기열 후보일 뿐 공통 모델을 자동 갱신하지 않습니다.</Alert>}
  </section>;
}
