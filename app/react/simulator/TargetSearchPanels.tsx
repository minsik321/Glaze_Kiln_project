import type { SimulatorModel } from "./useSimulator";
import { Action, Card, Field, Html, Output, Panel, SelectField } from "./ui";
import * as view from "./presentation.js";

const axisOptions = (items: any[] = []) =>
  items.map((item) => (
    <option key={item.level} value={item.level}>
      {item.label}
    </option>
  ));

export function TargetPanel({ model }: { model: SimulatorModel }) {
  const P = model.session.presets;
  const colorants: any[] = model.session.colorants;
  const typical = model.colorant?.typical_pct;
  return (
    <Panel model={model} name="target">
      <div className="screen-intro">
        <span className="eyebrow">STEP 01</span>
        <h2>어떤 유약을 만들까요?</h2>
        <p>원하는 마감과 색을 고르면 실험 조건을 준비해드려요.</p>
      </div>
      <Card>
        <div className="card-kicker">마감 옵션</div>
        <div className="grid">
          <SelectField model={model} id="t-gloss" label="광택도">
            {axisOptions(P.gloss)}
          </SelectField>
          <SelectField model={model} id="t-transp" label="투명도">
            {axisOptions(P.transparency)}
          </SelectField>
        </div>
      </Card>
      <Card>
        <div className="card-kicker">참고 색상 <span>선택사항</span></div>
        <div className="color-picker-layout">
          <div
            id="t-color-swatch"
            className="color-swatch"
            aria-label="참고 색상"
            style={{ background: model.session.colorHex }}
          >
            <span>색상 미리보기</span>
          </div>
          <div className="color-selects">
        <div className="grid">
          <SelectField model={model} id="t-color-a" label="산화물 A">
            {colorants.map((c) => (
              <option key={c.symbol} value={c.symbol}>
                {c.name}
              </option>
            ))}
          </SelectField>
          <SelectField model={model} id="t-color-b" label="산화물 B (선택)">
            <option value="">없음</option>
            {colorants.map((c) => (
              <option key={c.symbol} value={c.symbol}>
                {c.name}
              </option>
            ))}
          </SelectField>
        </div>
          </div>
        </div>
        <div className="grid">
          <Field
            model={model}
            id="t-color-blend"
            label="사잇값"
            type="range"
            min="0"
            max="100"
          />
          <Field
            model={model}
            id="t-color-sat"
            label="채도"
            type="range"
            min="-50"
            max="50"
          />
          <Field
            model={model}
            id="t-color-bri"
            label="명도"
            type="range"
            min="-50"
            max="50"
          />
        </div>
        <div className="grid">
          <Field
            model={model}
            id="t-color-amount"
            label={
              <>
                첨가량 직접 입력 (wt%){" "}
                <span id="t-color-amount-val" className="mono subtle">
                  {typical
                    ? `(통상 ${view.fmt(typical[0], 1)}–${view.fmt(typical[1], 1)}%)`
                    : ""}
                </span>
              </>
            }
            type="range"
            min="0"
            max={String(typical?.[1] ?? 10)}
            step="0.1"
          />
          <Field
            model={model}
            id="t-color-batch"
            label="이번 배치 건조 재료 (g)"
            min="1"
            step="10"
          />
        </div>
        <details className="source-detail">
          <summary>색상 값의 출처와 계산 기준</summary>
          <Output model={model} id="t-color-out" />
        </details>
      </Card>
      <details className="source-detail target-detail">
        <summary>저장된 목표와 계산 기준</summary>
        <Output model={model} id="target-out" />
      </details>
      <div className="screen-action">
        <Action model={model} id="btn-set-target">목표 저장</Action>
        <button className="act next" type="button" onClick={() => model.setTab("search")}>다음: 레시피 제작 <span aria-hidden="true">→</span></button>
      </div>
    </Panel>
  );
}

function Candidates({ model }: { model: SimulatorModel }) {
  const search = model.session.search;
  const candidates: any[] = model.session.candidates;
  if (!candidates.length) return <Output model={model} id="search-out" />;
  return (
    <div id="search-out">
      {search ? (
        <div className="msg">
          탐색 간격 <b>{view.fmt(search.grid_step, 1)}%</b> · 쌓인 실험{" "}
          <b>{search.observation_count}건</b> · 내 데이터 반영 비율{" "}
          <b>{view.fmt(search.personal_weight, 3)}</b>
          <br />
          <span className="subtle">실험이 쌓일수록 추천이 더 정교해져요.</span>
        </div>
      ) : null}
      {candidates.map((candidate, index) => (
        <div className="card" key={index}>
          <div className="row" style={{ marginTop: 0 }}>
            <b>후보 {index + 1}</b>
            <span className="badge">
              {candidate.expected_distance === null
                ? "예상 거리 없음 (데이터 부족)"
                : `예상 거리 ${view.fmt(candidate.expected_distance, 3)}`}
            </span>
          </div>
          <Html
            id={`candidate-materials-${index}`}
            html={view.materialsTable(candidate.materials)}
          />
          <Html
            id={`candidate-notes-${index}`}
            html={view.provBlock(
              "참고 자료",
              String(candidate.umf_note).split(" | "),
            )}
          />
          <div className="row">
            <button
              className="act ghost small"
              type="button"
              data-inspect={index}
              disabled={model.busy}
              onClick={() => model.inspect(index)}
            >
              자세히 보기
            </button>
            <button
              className="act small"
              type="button"
              data-adopt={index}
              disabled={model.busy}
              onClick={() => model.adopt(index)}
            >
              이 후보 선택하기
            </button>
          </div>
          <Html
            id={`inspect-${index}`}
            html={model.outputs[`inspect-${index}`]}
          />
          <div
            data-inspect-out={index}
            dangerouslySetInnerHTML={{
              __html: model.outputs[`inspect-${index}`] || "",
            }}
          />
        </div>
      ))}
    </div>
  );
}

function Recipes({ model }: { model: SimulatorModel }) {
  const entries = Object.entries(model.session.recipes || {}) as [
    string,
    any,
  ][];
  return (
    <div id="recipe-list" className="scroll-x">
      <table>
        <thead>
          <tr>
            <th>레시피</th>
            <th>조성</th>
            <th>
              <span className="visually-hidden">선택</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([id, recipe]) => (
            <tr key={id}>
              <td>
                <b>{recipe.name}</b>
                <br />
                <span className="mono subtle">{id}</span>
              </td>
              <td>
                {Object.entries(recipe.materials)
                  .map(([name, amount]) => `${name} ${view.fmt(amount, 1)}`)
                  .join(" · ")}
              </td>
              <td>
                <button
                  className="act ghost small"
                  type="button"
                  data-pick={id}
                  disabled={id === model.session.recipeId || model.busy}
                  onClick={() => model.pickRecipe(id)}
                >
                  {id === model.session.recipeId ? "현재 유약" : "선택"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SearchPanel({ model }: { model: SimulatorModel }) {
  return (
    <Panel model={model} name="search">
      <Card>
        <h2>레시피 후보 만들기</h2>
        <p className="lede">목표에 맞는 배합을 몇 가지 만들어드려요.</p>
        <div className="grid">
          <Field
            model={model}
            id="s-n"
            label="후보 개수"
            min="1"
            max="12"
            step="1"
          />
          <Field
            model={model}
            id="s-step"
            label="탐색 간격 (%)"
            min="1"
            max="25"
            step="1"
          />
          <SelectField model={model} id="s-cone" label="소성 콘">
            <option value="cone6">콘 6</option>
            <option value="cone11">콘 11</option>
          </SelectField>
        </div>
        <div className="row">
          <Action model={model} id="btn-propose">
            후보 만들기
          </Action>
        </div>
        <Candidates model={model} />
      </Card>
      <Card>
        <h3>등록된 레시피</h3>
        <p className="lede">선택한 레시피가 이후 모든 단계에서 사용됩니다.</p>
        <Recipes model={model} />
      </Card>
    </Panel>
  );
}
