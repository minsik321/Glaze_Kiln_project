import type { ChangeEvent } from "react";
import type { AiceRun } from "../aice/contract";
import type { NextTrialSuggestion } from "../lib/api";
import type { RelativeObservation } from "../aice/feedback";
import { usePhotoUrl } from "../aice/photoStorage";
import { workRecordMemo, type RecordEditDraft, type WorkRecordOrigin } from "./workRecords";

type Props = {
  run: AiceRun;
  origin: WorkRecordOrigin;
  nextTrial?: NextTrialSuggestion | null;
  //: 있으면 폼 자체가 편집 모드가 된다 — 제목·사진·메모·결과 관찰이 그 자리에서 입력창으로 바뀐다.
  edit?: { draft: RecordEditDraft; onChange: (draft: RecordEditDraft) => void; error?: string };
};

const RELATIVE_ORDER: RelativeObservation[] = ["much_less", "less", "match", "more", "much_more"];
const GLOSS_OPTIONS: Record<RelativeObservation, string> = { much_less: "광택이 없음", less: "광택감이 덜함", match: "목표와 일치함", more: "광택감이 더 있음", much_more: "광택감이 심함" };
const TEXTURE_OPTIONS: Record<RelativeObservation, string> = { much_less: "아주 매끈함", less: "비교적 매끈함", match: "목표와 일치함", more: "비교적 거침", much_more: "아주 거침" };
const TRANSPARENCY_OPTIONS: Record<RelativeObservation, string> = { much_less: "거의 불투명함", less: "투명도가 덜함", match: "목표와 일치함", more: "투명도가 더 높음", much_more: "매우 투명함" };
const DEFECT_LABELS: Record<string, string> = { pinholes: "핀홀", crawling: "기어감", crazing: "잔금", running: "흘러내림" };

function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: ReadonlyArray<readonly [T, string]>; onChange: (value: T) => void }) {
  return <select aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value as T)}>
    {value === null && <option value="" disabled>선택해 주세요</option>}
    {options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}
  </select>;
}

export function WorkRecordDetail({ run, origin, nextTrial, edit }: Props) {
  const peak = Math.max(...run.curves.baseline.points.map((point) => point.temperature_c));
  const totalMinutes = Math.max(...run.curves.baseline.points.map((point) => point.minute));
  const method = ({ dipping: "담금", pouring: "붓기", brushing: "붓칠", spraying: "분무" } as const)[run.application.method];
  const source = run.sources.find((item) => item.reference === "aice-feed-post-import");
  const memo = workRecordMemo(run);
  const draft = edit?.draft;
  const patch = (changes: Partial<RecordEditDraft>) => edit?.onChange({ ...edit.draft, ...changes });
  const storedRecipePhoto = usePhotoUrl(run.recipe.photo);
  const resultPhoto = usePhotoUrl(draft ? draft.photo : run.result.photo);
  const photo = resultPhoto ?? storedRecipePhoto ?? source?.conversion;
  const workDate = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(run.created_at));
  const overallLabel = ({ close: "목표에 가까워요", different: "목표와 차이가 있어요" } as Record<string, string>)[run.result.match ?? ""] ?? "기록 없음";
  const colorLabel = ({ close: "목표와 가까움", lighter: "목표보다 밝음", darker: "목표보다 어두움", different: "다른 색" } as Record<string, string>)[run.result.color ?? ""] ?? "기록 없음";
  const relativeLabel = ({ much_less: "매우 낮음", less: "낮음", match: "목표와 일치함", more: "높음", much_more: "매우 높음" } as Record<string, string>);
  const textureLabel = ({ much_more: "아주 거침", more: "비교적 거침", match: "목표와 일치함", less: "비교적 매끈함", much_less: "아주 매끈함" } as Record<string, string>);
  const defectLabels = ({ pinholes: "핀홀", crawling: "기어감", crazing: "잔금", running: "흘러내림" } as Record<string, string>);

  function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !edit) return;
    if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      patch({ photo: { id: `${run.run_id}-result`, kind: "result", storage_path: null, data_url: reader.result, placeholder: false, source_type: "observed", rights_confirmed: false, alt: file.name } });
    };
    reader.readAsDataURL(file);
  }
  const toggleDefect = (defect: string) => {
    if (!draft) return;
    const selected = draft.defects.includes(defect);
    patch({
      defects: selected ? draft.defects.filter((item) => item !== defect) : [...draft.defects, defect],
      defectSeverities: selected ? Object.fromEntries(Object.entries(draft.defectSeverities).filter(([key]) => key !== defect)) : { ...draft.defectSeverities, [defect]: 1 },
    });
  };

  return (
    <section className={`work-record-entry${draft ? " is-editing" : ""}`} aria-labelledby="work-record-entry-title">
      <div className={`work-record-entry-hero${photo ? "" : " without-photo"}`}>
        {photo && <img src={photo} alt={run.recipe.photo.alt} />}
        <div>
          <span className={`work-record-entry-origin ${origin}`}>{origin === "imported" ? "다른 사람의 작업에서 가져옴" : "내 완료 기록"}</span>
          <h3 id="work-record-entry-title">{run.recipe.name}</h3>
          {draft
            ? <input className="work-record-edit-title" aria-label="작업 제목" value={draft.title} maxLength={200} onChange={(event) => patch({ title: event.target.value })} />
            : <p>{run.title}</p>}
          {draft && <div className="work-record-edit-photo">
            <label className="work-record-edit-button"><span>사진 {draft.photo ? "변경" : "추가"}</span><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="작업 사진 변경" onChange={pickPhoto} /></label>
            {draft.photo && <button type="button" className="work-record-edit-button" onClick={() => patch({ photo: null })}>사진 삭제</button>}
          </div>}
        </div>
      </div>

      <section className="work-record-entry-card" aria-labelledby="record-recipe-title">
        <div className="work-record-entry-heading"><span>RECIPE</span><h4 id="record-recipe-title">유약 레시피</h4></div>
        <div className="work-record-materials">
          {Object.entries(run.recipe.materials).map(([name, amount]) => <div key={name}><span>{name}</span><i><b style={{ width: `${amount}%` }} /></i><strong>{amount}%</strong></div>)}
        </div>
        {run.recipe.colorants && Object.keys(run.recipe.colorants).length > 0 && <div className="work-record-colorants"><strong>발색 첨가물</strong>{Object.entries(run.recipe.colorants).map(([name, amount]) => <span key={name}>{name} {amount}%</span>)}</div>}
      </section>

      <section className="work-record-entry-card" aria-labelledby="record-firing-title">
        <div className="work-record-entry-heading"><span>FIRING</span><h4 id="record-firing-title">소성 방법</h4></div>
        <div className="work-record-firing-summary">
          <div><small>방식</small><strong>{source?.original_condition?.split(" · ")[0] ?? "저장된 소성 계획"}</strong></div>
          <div><small>최고온도</small><strong>{peak}℃</strong></div>
          <div><small>총 시간</small><strong>{Math.floor(totalMinutes / 60)}시간 {totalMinutes % 60}분</strong></div>
          <div><small>권장 범위</small><strong>{run.recipe.firing_range.value?.join("–") ?? "기록 없음"}℃</strong></div>
        </div>
      </section>

      <section className="work-record-entry-card" aria-labelledby="record-observation-title">
        <div className="work-record-entry-heading"><span>PREVIOUS LOG</span><h4 id="record-observation-title">이전 작업 기록</h4></div>
        <dl className="work-record-facts">
          <div><dt>기물</dt><dd>{run.ware.preset}</dd></div>
          <div><dt>소지</dt><dd>{run.ware.clay_body}</dd></div>
          <div><dt>시유</dt><dd>{method}{source?.original_condition ? ` · ${source.original_condition.split(" · ").slice(2).join(" · ")}` : ""}</dd></div>
          <div><dt>작업 일시</dt><dd>{workDate}</dd></div>
          <div><dt>시유 전 무게</dt><dd>{run.application.before_weight.value != null ? `${run.application.before_weight.value} g` : "기록 없음"}</dd></div>
          <div><dt>시유 후 무게</dt><dd>{run.application.after_weight.value != null ? `${run.application.after_weight.value} g` : "기록 없음"}</dd></div>
          <div><dt>비중</dt><dd>{run.application.density.value ?? "기록 없음"}</dd></div>
          <div><dt>평균 두께</dt><dd>{run.thickness.mean.value != null ? `${run.thickness.mean.value.toFixed(2)} mm` : "기록 없음"}</dd></div>
          <div><dt>기록 상태</dt><dd>{origin === "imported" ? "가져온 참고 기록" : "평가 완료"}</dd></div>
        </dl>
        {draft
          ? <label className="work-record-edit-memo"><span>메모</span><textarea aria-label="메모" value={draft.memo} maxLength={1000} placeholder="이 작업에 대해 남기고 싶은 메모를 적어 주세요." onChange={(event) => patch({ memo: event.target.value })} /></label>
          : memo && <blockquote>{memo}</blockquote>}
      </section>

      <section className="work-record-entry-card" aria-labelledby="record-result-title">
        <div className="work-record-entry-heading"><span>RESULT</span><h4 id="record-result-title">결과 관찰 기록</h4></div>
        {resultPhoto && <img className="work-record-result-photo" src={resultPhoto} alt="작업 결과 관찰" />}
        {draft ? <dl className="work-record-facts work-record-facts-edit">
          <div><dt>전체 인상</dt><dd><Select label="전체 인상" value={draft.match ?? null} options={[["close", "목표에 가까워요"], ["different", "차이가 있어요"]] as const} onChange={(match) => patch({ match })} /></dd></div>
          <div><dt>색상</dt><dd><Select label="색상" value={draft.color as "close" | "lighter" | "darker" | "different" | null} options={[["close", "목표와 가까움"], ["lighter", "목표보다 밝음"], ["darker", "목표보다 어두움"], ["different", "다른 색"]] as const} onChange={(color) => patch({ color })} /></dd></div>
          <div><dt>광택</dt><dd><Select label="광택" value={draft.gloss} options={RELATIVE_ORDER.map((id) => [id, GLOSS_OPTIONS[id]] as const)} onChange={(gloss) => patch({ gloss })} /></dd></div>
          <div><dt>질감</dt><dd><Select label="질감" value={draft.texture} options={[...RELATIVE_ORDER].reverse().map((id) => [id, TEXTURE_OPTIONS[id]] as const)} onChange={(texture) => patch({ texture })} /></dd></div>
          <div><dt>투명도</dt><dd><Select label="투명도" value={draft.transparency} options={RELATIVE_ORDER.map((id) => [id, TRANSPARENCY_OPTIONS[id]] as const)} onChange={(transparency) => patch({ transparency })} /></dd></div>
          <div className="wide"><dt>보이는 결함</dt><dd>
            <span className="work-record-edit-chips">{Object.entries(DEFECT_LABELS).map(([id, label]) => <button type="button" key={id} className="choice-chip" aria-pressed={draft.defects.includes(id)} onClick={() => toggleDefect(id)}>{label}</button>)}</span>
            {draft.defects.map((id) => <label className="work-record-edit-severity" key={id}><span>{DEFECT_LABELS[id] ?? id} 정도</span><select aria-label={`${DEFECT_LABELS[id] ?? id} 정도`} value={draft.defectSeverities[id] ?? 1} onChange={(event) => patch({ defectSeverities: { ...draft.defectSeverities, [id]: Number(event.target.value) } })}>{[[1, "매우 약함"], [2, "약함"], [3, "보통"], [4, "강함"], [5, "매우 강함"]].map(([level, text]) => <option key={level} value={level}>{level} - {text}</option>)}</select></label>)}
          </dd></div>
        </dl> : <dl className="work-record-facts">
          <div><dt>전체 인상</dt><dd>{overallLabel}</dd></div>
          <div><dt>색상</dt><dd>{colorLabel}</dd></div>
          <div><dt>광택</dt><dd>{relativeLabel[run.result.gloss_comparison ?? ""] ?? run.result.gloss ?? "기록 없음"}</dd></div>
          <div><dt>질감</dt><dd>{textureLabel[run.result.texture_comparison ?? ""] ?? run.result.texture ?? "기록 없음"}</dd></div>
          <div><dt>투명도</dt><dd>{relativeLabel[run.result.transparency_comparison ?? ""] ?? run.result.transparency ?? "기록 없음"}</dd></div>
          <div><dt>보이는 결함</dt><dd>{run.result.defects.length ? run.result.defects.map((defect) => `${defectLabels[defect] ?? defect} ${run.result.defect_severities?.[defect] ?? 1}단계`).join(" · ") : "선택한 결함 없음"}</dd></div>
        </dl>}
        {edit?.error && <p className="work-record-edit-error" role="alert">{edit.error}</p>}
        {draft && <p className="work-record-edit-hint">결과를 고치고 저장하면 다음 시도 제안도 새 결과로 다시 계산돼요.</p>}
        {origin === "mine" && nextTrial && nextTrial.variable !== "none" && <div className="next-trial-suggestion" role="note" aria-label="다음 시도 제안">
          <strong>다음 시도 제안</strong>
          <p>{nextTrial.message}</p>
        </div>}
      </section>

      <p className="work-record-entry-guide">이 기록의 레시피와 소성 계획을 기준으로 새 작업을 시작합니다. 다음 단계에서 기물과 실제 작업 조건을 확인해 주세요.</p>
    </section>
  );
}
