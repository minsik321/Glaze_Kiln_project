import { useCallback, useState } from "react";
import { AuthPanel } from "./auth/AuthPanel";
import { RecordsPanel } from "./records/RecordsPanel";
import { Simulator, type SimulatorSnapshot } from "./Simulator";

type SnapshotGetter = () => Promise<SimulatorSnapshot>;

export function App() {
  const [getSnapshot, setGetSnapshot] = useState<SnapshotGetter>();
  const connectSnapshot = useCallback((getter: SnapshotGetter) => {
    setGetSnapshot(() => getter);
  }, []);

  return (
    <>
      <AuthPanel />
      <RecordsPanel getSnapshot={getSnapshot} />
      <Simulator onSnapshotReady={connectSnapshot} />
    </>
  );
}
