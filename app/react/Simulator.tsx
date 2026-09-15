import { memo, useEffect, useRef } from "react";
import { useSimulator } from "./simulator/useSimulator";
import { Panels } from "./simulator/Panels";
import { Html, StateCell } from "./simulator/ui";
import * as view from "./simulator/presentation.js";

export type SimulatorSnapshot = Record<string, unknown>;
export type SimulatorProps = {
  onSnapshotReady?: (getSnapshot: () => Promise<SimulatorSnapshot>) => void;
};

const tabs = [
  ["target", "① 목표"],
  ["search", "② 레시피"],
  ["glazing", "③ 시유"],
  ["risk", "④ 점검"],
  ["firing", "⑤ 소성"],
  ["record", "⑥ 결과"],
] as const;

export const Simulator = memo(function Simulator({
  onSnapshotReady,
}: SimulatorProps) {
  const model = useSimulator();
  const snapshotRef = useRef(model.exportSnapshot);
  snapshotRef.current = model.exportSnapshot;

  useEffect(() => {
    if (!onSnapshotReady) return;
    onSnapshotReady(() => snapshotRef.current());
  }, [onSnapshotReady]);

  if (!model.ready) {
    return (
      <div
        id="boot"
        className={model.bootError ? "failed" : undefined}
        role="status"
        aria-live="polite"
      >
        <h1>유약 실험 기록장</h1>
        <p className="subtle">
          처음 한 번만 준비하는 데 시간이 걸려요. 잠시만 기다려주세요.
        </p>
        <div id="boot-bar" aria-label="계산 엔진 준비 진행률">
          <div id="boot-fill" style={{ width: `${model.progress.percent}%` }} />
        </div>
        <div id="boot-step">
          {model.bootError ? "준비하지 못했어요." : model.progress.message}
        </div>
        <div id="boot-fail" hidden={!model.bootError}>
          {model.bootError}
        </div>
        <pre id="boot-log">
          {model.bootError ? "페이지를 새로고침해 다시 시도해주세요." : ""}
        </pre>
      </div>
    );
  }

  const S = model.session;
  return (
    <>
      <header className="top" id="top">
        <div className="top-row">
          <h1>유약 실험 기록장</h1>
          <span className="spacer" />
          <button
            className="act ghost small"
            id="btn-registry"
            type="button"
            onClick={model.actions["btn-registry"]}
          >
            계수 정보
          </button>
        </div>
        <nav className="tabs" role="tablist" id="tabs" aria-label="실험 단계">
          {tabs.map(([name, label]) => (
            <button
              key={name}
              id={`tab-${name}`}
              role="tab"
              type="button"
              data-tab={name}
              aria-selected={model.tab === name}
              aria-controls={`panel-${name}`}
              tabIndex={model.tab === name ? 0 : -1}
              onClick={() => model.setTab(name)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main id="main" aria-busy={model.busy}>
        <div className="statebar" id="statebar" aria-label="현재 실험 상태">
          <StateCell label="목표" value={S.targetLabel} blank="미지정" />
          <StateCell label="유약" value={S.recipeName} />
          <StateCell
            label="기물"
            value={S.wareId ? S.wareName : ""}
            blank="미등록"
          />
          <StateCell label="시유 기록" value={S.recordId} />
          <StateCell label="회차" value={S.runId} />
          <StateCell
            label="온도 가정값"
            value={S.E === null ? "" : `${S.E} kJ/mol`}
            blank="미입력"
            na
          />
        </div>
        <Panels model={model} />
      </main>
      <aside
        id="registry-panel"
        hidden={!model.registryOpen}
        aria-label="계수 정보"
        aria-modal="true"
        role="dialog"
      >
        <div className="hd">
          <h2>계수 정보</h2>
          <span className="spacer" style={{ flex: 1 }} />
          <button
            className="act ghost small"
            id="btn-registry-close"
            type="button"
            onClick={model.actions["btn-registry-close"]}
          >
            닫기
          </button>
        </div>
        <div className="bd">
          <p className="lede">
            이 도구는 시뮬레이터예요. 실제 유약 결과를 보장하거나 조성만으로
            결과를 맞히지 않습니다. 아래 값은 참고용이고, 아직 정해지지 않은
            값은 “미정”으로 표시돼요.
          </p>
          <Html id="registry-body" html={view.renderRegistry(S)} />
        </div>
      </aside>
    </>
  );
});
