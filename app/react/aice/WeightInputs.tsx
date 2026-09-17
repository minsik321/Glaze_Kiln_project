import type { ArealDensityResult } from "./arealDensity";

export function WeightInputs({
  beforeG,
  afterG,
  onBeforeChange,
  onAfterChange,
  result,
}: {
  beforeG: string;
  afterG: string;
  onBeforeChange: (value: string) => void;
  onAfterChange: (value: string) => void;
  result: ArealDensityResult | null;
}) {
  return (
    <section className="weight-inputs" aria-labelledby="weight-inputs-title">
      <h3 id="weight-inputs-title">시유 전/후 무게</h3>
      <div className="weight-inputs-fields">
        <label htmlFor="weight-before">시유 전(g)<input id="weight-before" type="number" min="0" step="0.1" value={beforeG} onChange={(event) => onBeforeChange(event.target.value)} /></label>
        <label htmlFor="weight-after">시유 후(g)<input id="weight-after" type="number" min="0" step="0.1" value={afterG} onChange={(event) => onAfterChange(event.target.value)} /></label>
      </div>
      {result ? (
        <p className="weight-inputs-result"><strong>{result.gramsPerM2.toFixed(0)} g/m²</strong> (유약 무게 {result.glazeWeightG.toFixed(1)} g ÷ 대표 형상 면적 {result.areaM2.toFixed(3)} m²) — mm 환산은 건조밀도 입력이 없어 판정 불가입니다.</p>
      ) : (
        <p className="weight-inputs-hint">두 무게를 모두 입력하면 g/m²을 우선 계산해 보여줍니다.</p>
      )}
    </section>
  );
}
