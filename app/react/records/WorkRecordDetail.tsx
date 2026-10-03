import type { AiceRun } from "../aice/contract";
import { importedWorkMemo, type WorkRecordOrigin } from "./workRecords";

type Props = {
  run: AiceRun;
  origin: WorkRecordOrigin;
};

export function WorkRecordDetail({ run, origin }: Props) {
  const peak = Math.max(...run.curves.baseline.points.map((point) => point.temperature_c));
  const totalMinutes = Math.max(...run.curves.baseline.points.map((point) => point.minute));
  const method = ({ dipping: "담금", pouring: "부기", brushing: "붓칠", spraying: "분무" } as const)[run.application.method];
  const source = run.sources.find((item) => item.reference === "aice-feed-post-import");
  const memo = importedWorkMemo(run);
  const photo = run.recipe.photo.data_url ?? source?.conversion;
  const resultPhoto = run.result.photo?.data_url;
  const workDate = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(run.created_at));
  const overallLabel = ({ close: "목표에 가까워요", different: "목표와 차이가 있어요" } as Record<string, string>)[run.result.match ?? ""] ?? "기록 없음";
  const colorLabel = ({ close: "목표와 가까움", lighter: "목표보다 밝음", darker: "목표보다 어두움", different: "다른 색" } as Record<string, string>)[run.result.color ?? ""] ?? "기록 없음";
  const relativeLabel = ({ much_less: "매우 낮음", less: "낮음", match: "목표와 일치함", more: "높음", much_more: "매우 높음" } as Record<string, string>);
  const textureLabel = ({ much_more: "아주 거침", more: "비교적 거침", match: "목표와 일치함", less: "비교적 매끈함", much_less: "아주 매끈함" } as Record<string, string>);
  const defectLabels = ({ pinholes: "핀홀", crawling: "기어감", crazing: "잔금", running: "흘러내림" } as Record<string, string>);

  return (
    <section className="work-record-entry" aria-labelledby="work-record-entry-title">
      <div className={`work-record-entry-hero${photo ? "" : " without-photo"}`}>
        {photo && <img src={photo} alt={run.recipe.photo.alt} />}
        <div>
          <span className={`work-record-entry-origin ${origin}`}>{origin === "imported" ? "다른 사람의 작업에서 가져옴" : "내 완료 기록"}</span>
          <h3 id="work-record-entry-title">{run.recipe.name}</h3>
          <p>{run.title}</p>
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
        {memo && <blockquote>{memo}</blockquote>}
      </section>

      <section className="work-record-entry-card" aria-labelledby="record-result-title">
        <div className="work-record-entry-heading"><span>RESULT</span><h4 id="record-result-title">결과 관찰 기록</h4></div>
        {resultPhoto && <img className="work-record-result-photo" src={resultPhoto} alt="작업 결과 관찰" />}
        <dl className="work-record-facts">
          <div><dt>전체 인상</dt><dd>{overallLabel}</dd></div>
          <div><dt>색상</dt><dd>{colorLabel}</dd></div>
          <div><dt>광택</dt><dd>{relativeLabel[run.result.gloss_comparison ?? ""] ?? run.result.gloss ?? "기록 없음"}</dd></div>
          <div><dt>질감</dt><dd>{textureLabel[run.result.texture_comparison ?? ""] ?? run.result.texture ?? "기록 없음"}</dd></div>
          <div><dt>투명도</dt><dd>{relativeLabel[run.result.transparency_comparison ?? ""] ?? run.result.transparency ?? "기록 없음"}</dd></div>
          <div><dt>보이는 결함</dt><dd>{run.result.defects.length ? run.result.defects.map((defect) => `${defectLabels[defect] ?? defect} ${run.result.defect_severities?.[defect] ?? 1}단계`).join(" · ") : "선택한 결함 없음"}</dd></div>
        </dl>
      </section>

      <p className="work-record-entry-guide">이 기록의 레시피와 소성 계획을 기준으로 새 작업을 시작합니다. 다음 단계에서 기물과 실제 작업 조건을 확인해 주세요.</p>
    </section>
  );
}
