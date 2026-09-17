import type { ResultEvaluation } from "./feedback";
import { feedbackTrace } from "./feedback";
import { Alert, DetailDrawer, StatusBadge } from "./ui";

// LLM 프런트도어 TODO Phase 4 — "표준 촬영 규격 정의"(부록 B 최상단
// 미해결 과제: "광택도·투명도 라벨링의 표준 촬영 규격" — 라벨 오차가
// 탐색 동작 조건이므로 우선순위가 가장 높다고 명시됨, kiln-plan-v7.md 부록 B).
// 여기 6개 항목이 그 정의다. 고정된 촬영 조건 하나로 라벨 오차가 사라지는
// 것은 아니다 — 조건을 통제해 오차의 한 원인(촬영 환경 편차)을 줄일 뿐이고,
// 실제 라벨 정확도는 축적된 사진으로 검증해야 한다(§00 — 검증 전까지는
// 제안일 뿐, "표준"이 곧 "정확도 보장"은 아님).
const PHOTO_GUIDE = [
  "무광 중성 회색 배경(먼셀 N5 근사)",
  "색온도 약 5000K(D50) 확산 조명 2개 이상, 그림자 최소화",
  "기물에서 약 50cm, 렌즈 축을 시유면에 수직으로",
  "색상 기준표(24색 컬러체커 또는 동급)를 같은 프레임에 포함",
  "화이트밸런스 고정(자동 보정 끔), 기준표 흰색 패치가 날아가지 않게 노출 고정",
  "최소 1600×1200px, 고품질(비압축 또는 JPEG 품질 90 이상)로 저장",
];

function ChipGroup<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: Array<{ id: T; label: string }>; onChange: (value: T) => void }) {
  return <fieldset className="feedback-chip-group"><legend>{label}</legend><div className="choice-chip-row">{options.map((option) => <button type="button" className="choice-chip" aria-pressed={value === option.id} key={option.id} onClick={() => onChange(option.id)}>{option.label}</button>)}</div></fieldset>;
}

export function ResultFeedback({ value, onChange }: { value: ResultEvaluation; onChange: (value: ResultEvaluation) => void }) {
  const update = <K extends keyof ResultEvaluation>(key: K, next: ResultEvaluation[K]) => onChange({ ...value, [key]: next });
  const toggleDefect = (defect: string) => update("defects", value.defects.includes(defect) ? value.defects.filter((item) => item !== defect) : [...value.defects, defect]);
  const trace = feedbackTrace(value);
  return <section className="result-feedback" aria-labelledby="result-feedback-title">
    <div className="result-feedback-heading"><div><h3 id="result-feedback-title">결과 관찰 기록</h3><p>사진과 쉬운 선택을 먼저 남기고 수치는 선택 사항입니다.</p></div><StatusBadge tone="unavailable">실제 관찰 입력 · 품질 보장 아님</StatusBadge></div>
    <div className="photo-guide"><div className="photo-frame" role="img" aria-label="표준 촬영 위치 안내"><span>50 cm</span><i>색상 기준표</i></div><div><h4>표준 촬영 가이드</h4><ol>{PHOTO_GUIDE.map((item) => <li key={item}>{item}</li>)}</ol><button type="button" className="choice-chip" disabled>사진 추가 · 로컬 데모에서는 비활성</button></div></div>
    <div className="prototype-result-compare"><div><span className="result-swatch target" /><strong>목표</strong><small>선택한 목표 스와치</small></div><div><span className="result-swatch simulated" /><strong>관찰 결과</strong><small>사진 미등록 · 선택 평가</small></div></div>
    <ChipGroup label="목표와 전체 인상" value={value.match} options={[{ id: "close", label: "목표에 가까워요" }, { id: "different", label: "차이가 있어요" }]} onChange={(match) => update("match", match)} />
    <div className="feedback-grid"><ChipGroup label="색상" value={value.color} options={[{ id: "close", label: "가까움" }, { id: "lighter", label: "더 밝음" }, { id: "darker", label: "더 어두움" }, { id: "different", label: "다른 색" }]} onChange={(color) => update("color", color)} /><ChipGroup label="광택" value={value.gloss} options={[{ id: "matte", label: "무광" }, { id: "satin", label: "사틴" }, { id: "gloss", label: "유광" }]} onChange={(gloss) => update("gloss", gloss)} /><ChipGroup label="질감" value={value.texture} options={[{ id: "smooth", label: "매끈" }, { id: "slightly_rough", label: "약간 거침" }, { id: "rough", label: "거침" }]} onChange={(texture) => update("texture", texture)} /><ChipGroup label="투명도" value={value.transparency} options={[{ id: "opaque", label: "불투명" }, { id: "translucent", label: "반투명" }, { id: "transparent", label: "투명" }]} onChange={(transparency) => update("transparency", transparency)} /></div>
    <fieldset className="feedback-chip-group"><legend>보이는 결함 · 복수 선택</legend><div className="choice-chip-row">{[["pinholes", "핀홀"], ["crawling", "기어감"], ["crazing", "잔금"], ["running", "흘러내림"]].map(([id, label]) => <button type="button" className="choice-chip" aria-pressed={value.defects.includes(id)} key={id} onClick={() => toggleDefect(id)}>{label}</button>)}</div></fieldset>
    <fieldset className="feedback-scope"><legend>이 평가의 사용 범위</legend><label><input type="radio" name="feedback-scope" checked={value.scope === "personal"} onChange={() => update("scope", "personal")} /> 개인 보정에만 사용</label><label><input type="radio" name="feedback-scope" checked={value.scope === "common_candidate"} onChange={() => update("scope", "common_candidate")} /> 익명화 후 공통 개선 검토 후보</label></fieldset>
    {value.scope === "common_candidate" && <Alert tone="warning" title="자동 반영 안 함">품질·권리·동의를 검토하는 대기열 후보일 뿐 공통 모델을 자동 갱신하지 않습니다.</Alert>}
    {value.match && <DetailDrawer summary="다음 추천에 미치는 영향"><ul>{trace.effects.map((effect) => <li key={effect}>{effect}</li>)}</ul><p>출처: {trace.sourceType} · 자동 공통 갱신: 아니오</p></DetailDrawer>}
  </section>;
}
