import type { ReactNode } from "react";

export function AppShell({ children, navigation }: { children: ReactNode; navigation: ReactNode }) {
  return <div className="app-stage"><div className="app-shell">{children}{navigation}</div></div>;
}

export type NavigationItem<T extends string> = {
  id: T;
  label: string;
  icon: ReactNode;
};

export function BottomNavigation<T extends string>({
  current,
  items,
  onChange,
}: {
  current: T;
  items: readonly NavigationItem<T>[];
  onChange: (view: T) => void;
}) {
  return (
    <nav className="bottom-nav" aria-label="주요 메뉴">
      {items.map((item) => (
        <button key={item.id} type="button" aria-current={current === item.id ? "page" : undefined} onClick={() => onChange(item.id)}>
          {item.icon}<span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function ProgressHeader({ current, total, labels }: { current: number; total: number; labels: readonly string[] }) {
  return (
    <nav className="prototype-progress" aria-label="가상 실험 진행 단계">
      <span>{current} / {total}</span>
      <ol>
        {labels.map((label, index) => (
          <li key={label} aria-current={index + 1 === current ? "step" : undefined} data-complete={index + 1 < current || undefined}>
            <span className="visually-hidden">{label}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return <section className="aice-card">{title && <h3>{title}</h3>}{children}</section>;
}

export function ChoiceChip({ selected, children, onClick }: { selected: boolean; children: ReactNode; onClick: () => void }) {
  return <button type="button" className="choice-chip" aria-pressed={selected} onClick={onClick}>{children}</button>;
}

export type StatusTone = "neutral" | "info" | "warning" | "danger" | "unavailable" | "complete";

export function StatusBadge({ tone = "neutral", children }: { tone?: StatusTone; children: ReactNode }) {
  return <span className={`status-badge ${tone}`}><span className="status-symbol" aria-hidden="true" />{children}</span>;
}

export function ExplanationPanel({ reason, assumption, next }: { reason: string; assumption: string; next: string }) {
  return (
    <section className="prototype-guidance" aria-label="추천 안내">
      <p><strong>왜 이 후보인지</strong><span>{reason}</span></p>
      <p><strong>무엇이 가정인지</strong><span>{assumption}</span></p>
      <p><strong>다음 행동</strong><span>{next}</span></p>
    </section>
  );
}

export function DetailDrawer({ summary = "상세 보기", children }: { summary?: string; children: ReactNode }) {
  return <details className="detail-drawer"><summary>{summary}</summary><div>{children}</div></details>;
}

export function Alert({ tone = "warning", title, children }: { tone?: "warning" | "danger" | "unavailable"; title: string; children: ReactNode }) {
  return <section className={`aice-alert ${tone}`} role={tone === "danger" ? "alert" : "status"}><strong>{title}</strong><span>{children}</span></section>;
}

export type AsyncStateKind = "empty" | "loading" | "error" | "unavailable" | "complete";

const asyncStateCopy: Record<AsyncStateKind, { title: string; detail: string; tone: StatusTone }> = {
  empty: { title: "아직 기록이 없어요", detail: "새 샘플 실험을 시작하면 여기에 표시됩니다.", tone: "neutral" },
  loading: { title: "계산 엔진을 준비하고 있어요", detail: "선택 화면은 계속 사용할 수 있습니다.", tone: "info" },
  error: { title: "불러오지 못했어요", detail: "선택은 보존되었습니다. 다시 시도할 수 있습니다.", tone: "danger" },
  unavailable: { title: "판정 불가", detail: "근거가 부족해 안전 또는 정상으로 판단할 수 없습니다.", tone: "unavailable" },
  complete: { title: "가상 실행을 기록했어요", detail: "합성 결과이며 실제 소성 결과가 아닙니다.", tone: "complete" },
};

export function AsyncState({ kind }: { kind: AsyncStateKind }) {
  const copy = asyncStateCopy[kind];
  return <div className={`async-state ${kind}`} role={kind === "error" ? "alert" : "status"} aria-live="polite"><StatusBadge tone={copy.tone}>{copy.title}</StatusBadge><p>{copy.detail}</p></div>;
}

export function StateGallery() {
  return <div className="state-gallery" aria-label="화면 상태 예시">{(["empty", "loading", "error", "unavailable", "complete"] as const).map((kind) => <AsyncState key={kind} kind={kind} />)}</div>;
}

