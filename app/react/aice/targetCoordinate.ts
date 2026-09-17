// 대응: src/kiln/domain/enums.py(Gloss·Transparency 순서형 축)
// · src/kiln/search/objective.py(objective 목적함수, 5-4절).
//
// 4-1절: 광택도·투명도는 독립된 두 순서형 축이다. 거리는 두 좌표의
// 축별 레벨 차이의 가중합 — d = w_gloss·|Δgloss| + w_transparency·|Δtransparency|.
// 이 파일은 그 식을 그대로 옮긴다. `aiMvp.ts`가 예전에 쓰던
// `100 - index*18` 임의 산식을 대체하는 실제 계산이 이 파일이다.

export type GlossLevel = "dry" | "matte" | "satin" | "semi_gloss" | "gloss";
export type TransparencyLevel = "opaque" | "semi_opaque" | "translucent" | "transparent";

export const GLOSS_LEVEL: Record<GlossLevel, number> = {
  dry: 0,
  matte: 1,
  satin: 2,
  semi_gloss: 3,
  gloss: 4,
};

export const TRANSPARENCY_LEVEL: Record<TransparencyLevel, number> = {
  opaque: 0,
  semi_opaque: 1,
  translucent: 2,
  transparent: 3,
};

export type TargetCoordinate = { gloss: GlossLevel; transparency: TransparencyLevel };

export function coordinateDistance(
  target: TargetCoordinate,
  result: TargetCoordinate,
  wGloss = 1,
  wTransparency = 1,
): number {
  return (
    wGloss * Math.abs(GLOSS_LEVEL[target.gloss] - GLOSS_LEVEL[result.gloss]) +
    wTransparency * Math.abs(TRANSPARENCY_LEVEL[target.transparency] - TRANSPARENCY_LEVEL[result.transparency])
  );
}
