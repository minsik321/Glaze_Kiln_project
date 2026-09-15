import type { SimulatorModel } from "./useSimulator";
import { TargetPanel, SearchPanel } from "./TargetSearchPanels";
import {
  GlazingPanel,
  RiskPanel,
  FiringPanel,
  RecordPanel,
} from "./WorkflowPanels";

export function Panels({ model }: { model: SimulatorModel }) {
  return (
    <>
      <TargetPanel model={model} />
      <SearchPanel model={model} />
      <GlazingPanel model={model} />
      <RiskPanel model={model} />
      <FiringPanel model={model} />
      <RecordPanel model={model} />
    </>
  );
}
