import { useCallback, useState, type ReactNode } from "react";
import { AuthPanel } from "./auth/AuthPanel";
import { RecordsPanel } from "./records/RecordsPanel";
import type { SimulatorSnapshot } from "./Simulator";
import { AicePrototype } from "./aice/AicePrototype";
import { AppShell, BottomNavigation } from "./aice/ui";
import type { AiceRun } from "./aice/contract";

type SnapshotGetter = () => Promise<SimulatorSnapshot>;
type AppView = "work" | "records" | "account";

function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

export function App() {
  const [getSnapshot, setGetSnapshot] = useState<SnapshotGetter>();
  const [view, setView] = useState<AppView>("work");
  const [restoredRun, setRestoredRun] = useState<AiceRun>();
  const connectSnapshot = useCallback((getter: SnapshotGetter) => {
    setGetSnapshot(() => getter);
  }, []);

  const navigation = [
    { id: "work", label: "유약 작업", icon: <NavIcon><path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11Z" /></NavIcon> },
    { id: "records", label: "작업 기록", icon: <NavIcon><path d="M4 5h16v14H4zM8 9h8M8 13h8M8 17h5" /></NavIcon> },
    { id: "account", label: "내 계정", icon: <NavIcon><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></NavIcon> },
  ] as const;

  return (
    <AppShell navigation={<BottomNavigation current={view} items={navigation} onChange={setView} />}>
        <section className="app-view" hidden={view !== "work"}>
          <AicePrototype onSnapshotReady={connectSnapshot} restoredRun={restoredRun} />
        </section>
        <section className="app-view app-utility-view" hidden={view !== "records"}>
          <div className="utility-header">
            <span className="eyebrow">AICE KILN</span>
            <h1>작업 기록</h1>
            <p>지난 실험과 소성 결과를 모아봅니다.</p>
          </div>
          <RecordsPanel getSnapshot={getSnapshot} onRestore={(run) => { setRestoredRun(run); setView("work"); }} />
        </section>
        <section className="app-view app-utility-view" hidden={view !== "account"}>
          <div className="utility-header">
            <span className="eyebrow">AICE KILN</span>
            <h1>내 계정</h1>
            <p>로그인과 프로필을 관리합니다.</p>
          </div>
          <AuthPanel />
        </section>
    </AppShell>
  );
}
