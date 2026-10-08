// AICE 작업 기록에 저장되는 스냅샷의 형태. 원래 레거시 Simulator 컴포넌트
// (app/react/Simulator.tsx, 2026-09 제거)가 정의하던 타입인데, AicePrototype과
// RecordsPanel이 그 타입만 계속 재사용하고 있어 여기로 옮겼다. 형태 자체는
// 바뀌지 않았다.
export type SimulatorSnapshot = Record<string, unknown>;
export type SimulatorProps = {
  onSnapshotReady?: (getSnapshot: () => Promise<SimulatorSnapshot>) => void;
};
