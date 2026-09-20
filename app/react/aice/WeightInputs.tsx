import type { ArealDensityResult } from "./arealDensity";

const METHODS = ["담금", "부기", "분무", "붓칠"] as const;

export function WeightInputs({
  beforeG,
  afterG,
  method,
  dipSeconds,
  onBeforeChange,
  onAfterChange,
  onMethodChange,
  onDipSecondsChange,
  result,
  dryingComplete = false,
  onDryingChange,
}: {
  beforeG: string;
  afterG: string;
  method: string;
  dipSeconds: string;
  onBeforeChange: (value: string) => void;
  onAfterChange: (value: string) => void;
  onMethodChange: (value: string) => void;
  onDipSecondsChange: (value: string) => void;
  result: ArealDensityResult | null;
  dryingComplete?: boolean;
  onDryingChange?: (value: boolean) => void;
}) {
  return (
    <section className="weight-inputs" aria-labelledby="weight-inputs-title">
      <h3 id="weight-inputs-title">시유 전/후 무게</h3>
      <div className="weight-inputs-fields">
        <label htmlFor="weight-before">시유 전(g)<input id="weight-before" type="number" min="0" step="0.1" value={beforeG} onChange={(event) => onBeforeChange(event.target.value)} /></label>
        <label htmlFor="weight-after">시유 후(g)<input id="weight-after" type="number" min="0" step="0.1" value={afterG} onChange={(event) => onAfterChange(event.target.value)} /></label>
        <label htmlFor="glazing-method">시유 방법
          <select id="glazing-method" value={method} onChange={(event) => onMethodChange(event.target.value)}>
            {METHODS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        {method === "담금" && (
          <label htmlFor="dip-seconds">담금시간(초)<input id="dip-seconds" type="number" min="0" step="0.5" value={dipSeconds} onChange={(event) => onDipSecondsChange(event.target.value)} /></label>
        )}
      </div>
      <label><input type="checkbox" checked={dryingComplete} onChange={(event) => onDryingChange?.(event.target.checked)} /> 시유 후 완전히 건조된 상태에서 무게를 측정했습니다</label>
      {result ? (
        <p className="weight-inputs-result"><strong>{result.gramsPerM2.toFixed(0)} g/m²</strong> (유약 무게 {result.glazeWeightG.toFixed(1)} g ÷ 대표 형상 면적 {result.areaM2.toFixed(3)} m²)</p>
      ) : (
        <p className="weight-inputs-hint">{method === "담금" ? "두 무게와 담금시간을 모두 입력하면 두께가 계산됩니다." : "두 무게를 모두 입력하면 g/m²을 계산해 보여줍니다."}</p>
      )}
    </section>
  );
}
