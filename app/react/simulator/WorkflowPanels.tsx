import type { SimulatorModel, Row } from "./useSimulator";
import {
  Action,
  Card,
  CheckField,
  EControl,
  Field,
  Html,
  Output,
  Panel,
  SelectField,
} from "./ui";

const setRow = (
  rows: Row[],
  setRows: (rows: Row[]) => void,
  index: number,
  key: string,
  value: string,
) => {
  const next = rows.map((row, position) =>
    position === index
      ? {
          ...row,
          [key]:
            key === "purpose" || value === ""
              ? value
              : Number.parseFloat(value),
        }
      : row,
  );
  setRows(next);
};

export function GlazingPanel({ model }: { model: SimulatorModel }) {
  const P = model.session.presets;
  const steps = [
    [
      "1 · 비중 점검",
      model.session.densityStatus,
      !model.session.densityStatus,
    ],
    [
      "2 · 담금시간",
      model.session.dipSeconds ? `${model.session.dipSeconds}초` : "",
      !!model.session.densityStatus && !model.session.dipSeconds,
    ],
    [
      "3 · 시유 · 두께 산출",
      model.session.recordId,
      !!model.session.dipSeconds && !model.session.recordId,
    ],
  ];
  return (
    <Panel model={model} name="glazing">
      <div className="steps" id="glazing-steps">
        {steps.map(([label, value, on]) => (
          <span key={String(label)} className={`chip${on ? " on" : ""}`}>
            {label}
            {value ? (
              <>
                {" "}
                <b>{String(value)}</b>
              </>
            ) : null}
          </span>
        ))}
      </div>
      <Card>
        <h2>비중 확인</h2>
        <div className="grid">
          <Field model={model} id="d-rho" label="비중" step="0.01" />
          <Field
            model={model}
            id="d-min"
            label="저은 후 지난 시간 (분)"
            step="1"
          />
          <Field model={model} id="d-lo" label="권장 최소" step="0.01" />
          <Field model={model} id="d-hi" label="권장 최대" step="0.01" />
        </div>
        <div className="row">
          <Action model={model} id="btn-density">
            비중 확인하기
          </Action>
        </div>
        <p className="subtle">
          비중은 시간이 지나면 달라져요. 잰 직후 값을 넣어주세요.
        </p>
        <Output model={model} id="density-out" />
      </Card>
      <Card>
        <h3>담금 시간 계산</h3>
        <div className="grid">
          <Field
            model={model}
            id="dt-target"
            label="목표 평균 두께 (mm)"
            step="0.05"
          />
          <Field model={model} id="dt-rho" label="비중" step="0.01" />
          <Field
            model={model}
            id="dt-flow"
            label="흘러내림 여유 두께 (mm)"
            step="0.05"
          />
        </div>
        <div className="row">
          <Action model={model} id="btn-dip">
            담금 시간 계산하기
          </Action>
        </div>
        <Output model={model} id="dip-out" />
      </Card>
      <Card>
        <h3>기물 등록 · 시유</h3>
        <p className="subtle">저울에 두 번 올리고 형태만 고르면 됩니다.</p>
        <div className="groups">
          <div className="fieldgroup">
            <div className="gl">기물</div>
            <SelectField model={model} id="w-shape" label="형태">
              {Object.entries(P.shapes).map(([id, shape]: [string, any]) => (
                <option key={id} value={id}>
                  {shape.name}
                </option>
              ))}
            </SelectField>
            <Field model={model} id="w-clay" label="소지" type="text" />
            <Field
              model={model}
              id="w-bisque"
              label="초벌 온도 (℃)"
              step="10"
            />
            <div className="row">
              <Action model={model} id="btn-ware" ghost small>
                기물 등록
              </Action>
            </div>
            <Output model={model} id="ware-out" />
          </div>
          <div className="fieldgroup">
            <div className="gl">저울 측정</div>
            <Field
              model={model}
              id="g-before"
              label="시유 전 무게 (g)"
              step="1"
            />
            <Field
              model={model}
              id="g-after"
              label="건조 후 무게 (g)"
              step="1"
            />
            <Field
              model={model}
              id="g-wax"
              label="발수 처리 면적 (m²)"
              step="0.001"
            />
          </div>
          <div className="fieldgroup">
            <div className="gl">시유 조건</div>
            <SelectField model={model} id="g-method" label="시유 방법">
              {P.methods.map((method: any) => (
                <option key={method.value} value={method.value}>
                  {method.value}
                  {method.has_distribution
                    ? " (부위별 두께 계산 가능)"
                    : " (평균만 계산)"}
                </option>
              ))}
            </SelectField>
            <div id="g-dip-field" hidden={!model.dipping}>
              <Field
                model={model}
                id="g-dip"
                label="담금 시간 (초)"
                step="0.1"
              />
            </div>
            <Field model={model} id="g-rho" label="비중" step="0.01" />
          </div>
        </div>
        <div className="row">
          <Action model={model} id="btn-glaze">
            시유 기록하기
          </Action>
          <CheckField model={model} id="g-reglaze">
            재시유 <span className="subtle">(참고용)</span>
          </CheckField>
          <CheckField model={model} id="g-dry">
            건조 완료
          </CheckField>
        </div>
        <Output model={model} id="glaze-out" />
      </Card>
    </Panel>
  );
}

export function RiskPanel({ model }: { model: SimulatorModel }) {
  return (
    <Panel model={model} name="risk">
      <Card>
        <h2>소성 전 위험 확인</h2>
        <p className="subtle">가마에 넣기 전, 마지막으로 확인하세요.</p>
        <div className="row">
          <Action model={model} id="btn-risk">
            위험 확인하기
          </Action>
        </div>
        <Output model={model} id="risk-out" />
      </Card>
    </Panel>
  );
}

function KilnOptions({ model }: { model: SimulatorModel }) {
  return (
    <>
      {Object.entries(model.session.presets.kilns).map(
        ([id, kiln]: [string, any]) => (
          <option key={id} value={id}>
            {kiln.name}
          </option>
        ),
      )}
    </>
  );
}

function SegmentRows({ model }: { model: SimulatorModel }) {
  return (
    <div id="seg-rows">
      {model.segments.map((row, index) => (
        <div className="seg-row" key={index}>
          {(
            [
              ["from_c", "시작 ℃", "10"],
              ["to_c", "종료 ℃", "10"],
              ["rate_c_per_h", "냉각률 ℃/h", "5"],
            ] as const
          ).map(([key, label, step]) => (
            <label className="f" key={key}>
              {label}
              <input
                type="number"
                data-seg={index}
                data-k={key}
                value={row[key]}
                step={step}
                onChange={(e) =>
                  setRow(
                    model.segments,
                    model.setSegments,
                    index,
                    key,
                    e.target.value,
                  )
                }
              />
            </label>
          ))}
          <label className="f">
            목적
            <input
              type="text"
              data-seg={index}
              data-k="purpose"
              value={row.purpose}
              onChange={(e) =>
                setRow(
                  model.segments,
                  model.setSegments,
                  index,
                  "purpose",
                  e.target.value,
                )
              }
            />
          </label>
          <button
            className="act ghost small"
            type="button"
            data-seg-del={index}
            onClick={() =>
              model.setSegments(model.segments.filter((_, i) => i !== index))
            }
          >
            삭제
          </button>
        </div>
      ))}
    </div>
  );
}

export function FiringPanel({ model }: { model: SimulatorModel }) {
  const locked = model.session.E === null;
  return (
    <Panel model={model} name="firing">
      <Card>
        <h2>적재 확인</h2>
        <div className="grid">
          <SelectField model={model} id="k-kiln" label="가마">
            <KilnOptions model={model} />
          </SelectField>
          <Field
            model={model}
            id="l-shelf"
            label="선반 면적 (m²)"
            step="0.01"
          />
          <Field model={model} id="l-kg" label="등록 총중량 (kg)" step="0.1" />
          <Field
            model={model}
            id="l-obs"
            label="측정된 소비 전력 (W)"
            step="10"
          />
        </div>
        <div className="row">
          <Action model={model} id="btn-loading">
            적재 확인하기
          </Action>
        </div>
        <Output model={model} id="loading-out" />
      </Card>
      <Card>
        <h3>냉각 계획</h3>
        <p className="subtle">
          전기가마는 천천히 식히는 것만 조절할 수 있어요.
        </p>
        <SegmentRows model={model} />
        <div className="row">
          <Action model={model} id="btn-seg-add" ghost small>
            구간 추가
          </Action>
          <Action model={model} id="btn-cooling">
            냉각 계획 확인하기
          </Action>
        </div>
        <Output model={model} id="cooling-out" />
      </Card>
      <Card>
        <h3>소성 시뮬레이션</h3>
        <EControl model={model} id="e-control-sim" />
        <div className="grid">
          <Field model={model} id="f-peak" label="최고온도 (℃)" step="10" />
          <Field model={model} id="f-ramp" label="승온율 (℃/h)" step="5" />
          <Field model={model} id="f-hold" label="유지 시간 (분)" step="5" />
          <Field model={model} id="f-seed" label="오차 시드(seed)" step="1" />
          <Field model={model} id="f-volt" label="전압 오차 (%)" step="1" />
          <Field model={model} id="f-age" label="열선 노후도 (%)" step="1" />
          <Field
            model={model}
            id="f-noise"
            label="온도 센서 오차 (℃)"
            step="0.5"
          />
        </div>
        <div className="row">
          <Action
            model={model}
            id="btn-simulate"
            disabled={locked}
            title={locked ? "먼저 가정값을 입력해주세요" : undefined}
          >
            시뮬레이션 실행
          </Action>
          <Action model={model} id="btn-record-run" ghost>
            이 결과 저장하기
          </Action>
        </div>
        <Output model={model} id="sim-out" />
      </Card>
    </Panel>
  );
}

function TileRows({ model }: { model: SimulatorModel }) {
  const specs = [
    ["dip_seconds", "담금 시간(초)", "0.5"],
    ["area_m2", "면적 m²", "0.001"],
    ["glaze_weight_g", "유약 g", "0.1"],
    ["caliper_mm", "캘리퍼 mm (없으면 빈칸)", "0.05"],
  ] as const;
  return (
    <div id="tile-rows">
      {model.tiles.map((row, index) => (
        <div className="tile-row" key={index}>
          {specs.map(([key, label, step]) => (
            <label className="f" key={key}>
              {label}
              <input
                type="number"
                data-tile={index}
                data-k={key}
                value={row[key]}
                step={step}
                placeholder={key === "caliper_mm" ? "없음" : undefined}
                onChange={(e) =>
                  setRow(
                    model.tiles,
                    model.setTiles,
                    index,
                    key,
                    e.target.value,
                  )
                }
              />
            </label>
          ))}
          <button
            className="act ghost small"
            type="button"
            data-tile-del={index}
            onClick={() =>
              model.setTiles(model.tiles.filter((_, i) => i !== index))
            }
          >
            삭제
          </button>
        </div>
      ))}
    </div>
  );
}

export function RecordPanel({ model }: { model: SimulatorModel }) {
  const P = model.session.presets;
  const locked = model.session.E === null;
  return (
    <Panel model={model} name="record">
      <Card>
        <h2>결과 입력</h2>
        <p className="lede">
          완성된 결과를 입력하면 다음 실험에 자동으로 반영됩니다.
        </p>
        <div className="grid">
          <SelectField model={model} id="r-gloss" label="광택도(실제)">
            {P.gloss.map((item: any) => (
              <option key={item.level} value={item.level}>
                {item.label}
              </option>
            ))}
          </SelectField>
          <SelectField model={model} id="r-transp" label="투명도(실제)">
            {P.transparency.map((item: any) => (
              <option key={item.level} value={item.level}>
                {item.label}
              </option>
            ))}
          </SelectField>
          <SelectField model={model} id="r-grade" label="등급">
            {P.grades.map((grade: string) => (
              <option key={grade} value={grade}>
                {grade}
              </option>
            ))}
          </SelectField>
          <Field
            model={model}
            id="r-frac-t"
            label="파단면 두께 (mm · 있을 때만)"
            step="0.05"
            placeholder="실측 없음"
          />
          <Field
            model={model}
            id="r-frac-z"
            label="파단면 위치 z (mm)"
            step="1"
            placeholder="실측 없음"
          />
          <Field
            model={model}
            id="r-color"
            label="색상 메모(선택)"
            type="text"
            placeholder="예: 청회"
          />
        </div>
        <div id="r-failures" className="row">
          <span className="subtle">실패 이유 (등급이 “실패”일 때 선택):</span>
          {P.failures.map((failure: string) => (
            <label className="badge" key={failure}>
              <input
                type="checkbox"
                value={failure}
                checked={model.session.failures.includes(failure)}
                onChange={(e) =>
                  model.patch({
                    failures: e.target.checked
                      ? [...model.session.failures, failure]
                      : model.session.failures.filter(
                          (item: string) => item !== failure,
                        ),
                  })
                }
              />{" "}
              {failure}
            </label>
          ))}
        </div>
        <div className="row">
          <Action model={model} id="btn-result">
            결과 저장하기
          </Action>
        </div>
        <Output model={model} id="result-out" />
      </Card>
      <Card>
        <h3>두께 계산 보정</h3>
        <p className="subtle">
          캘리퍼로 직접 잰 두께가 있어야 정확도를 계산할 수 있어요.
        </p>
        <TileRows model={model} />
        <div className="row">
          <div style={{ maxWidth: 140 }}>
            <Field model={model} id="cal-rho" label="비중" step="0.01" />
          </div>
          <Action model={model} id="btn-tile-add" ghost small>
            타일 추가
          </Action>
          <Action model={model} id="btn-tiles">
            보정 계산하기
          </Action>
        </div>
        <Output
          model={model}
          id="tiles-out"
          append={
            model.session.tileResult ? (
              <div className="row">
                <Action model={model} id="btn-apply-cal">
                  이 레시피에 반영하기
                </Action>
              </div>
            ) : null
          }
        />
      </Card>
      <Card>
        <h3>계산 계수 보기</h3>
        <div className="row">
          <Action model={model} id="btn-coef" ghost>
            보기
          </Action>
        </div>
        <Output model={model} id="coef-out" />
      </Card>
      <Card>
        <h3>처방 만들기</h3>
        <EControl model={model} id="e-control-rx" />
        <div className="grid">
          <Field
            model={model}
            id="rx-peak"
            label="처방 최고온도 (℃)"
            step="10"
          />
          <SelectField model={model} id="rx-kiln" label="적용할 가마">
            <KilnOptions model={model} />
          </SelectField>
        </div>
        <div className="row">
          <Action
            model={model}
            id="btn-issue"
            disabled={locked}
            title={locked ? "먼저 가정값을 입력해주세요" : undefined}
          >
            처방 만들기
          </Action>
          <Action model={model} id="btn-transform" ghost>
            다른 가마용으로 바꾸기
          </Action>
        </div>
        <Output model={model} id="rx-out" />
      </Card>
      <Card>
        <h3>전체 기록 내보내기</h3>
        <div className="row">
          <Action model={model} id="btn-export" ghost>
            내보내기
          </Action>
        </div>
        <Output model={model} id="export-out" />
      </Card>
    </Panel>
  );
}
