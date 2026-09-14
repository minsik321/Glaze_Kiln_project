"""05-1절 · 원료의 세 역할 분리 — 원료 산화물 분석표.

기획서 05-1절은 원료 세 역할을 나눈다.

    현탁제        벤토나이트 소량 — 고정, 탐색 변수 아님
    알루미나 공급원  카올린 — 고정 배경 비율(10~15%) 위에서 3원료 삼각
    탐색 확장     카올린 비율 — 목표 미달 시에만 추가 차원

이 모듈은 그 원료들의 **산화물 조성**을 담는다. 계산(:mod:`kiln.chem.umf`)이
쓸 원자재이지, 배합 로직은 여기 없다.

**LOI(강열감량)와 산화물 wt%의 관계.** ``Material.oxides`` 는 *원료 그대로*
(로 계량하는 raw 상태) 기준 중량%다. 예컨대 석회석(생석회석, CaCO₃)을
100g 계량해 구우면 CaO 56g만 남고 44g은 CO₂로 날아간다 — 그래서
``oxides={"CaO": 56.0}, loi=44.0`` 이지 ``CaO: 100.0`` 이 아니다.
``unity_formula_from_materials`` 가 ``oxides`` 딕셔너리만 몰(mol) 계산에
쓰고 ``loi`` 는 아예 읽지 않으므로, **소성 중 날아가는 질량은 자동으로
UMF 계산에서 빠진다**(과제 지시: "LOI must be excluded from the oxide
totals — calculate on the calcined/fired basis"). 별도의 정규화나 보정을
추가할 필요가 없다 — oxides+loi=100 이 되도록 값을 넣어두면 그것으로 끝이다.

**출처.** 아래 조성은 각 원료를 지배하는 이론광물의 화학양론식에서 그대로
유도한 값이다(문헌 추정 초기값 — 실제 광산 로트는 편차가 있다. 7-5절
"원료 로트: 산지·로트 편차"가 이 차이를 다룬다):

- 장석(포타쉬 장석): 정장석(orthoclase) K₂O·Al₂O₃·6SiO₂, 분자량 556.64
  → K₂O 16.9% · Al₂O₃ 18.4% · SiO₂ 64.7% (LOI 0)
- 카올린: 카올리나이트 Al₂O₃·2SiO₂·2H₂O, 분자량 258.16
  → Al₂O₃ 39.5% · SiO₂ 46.5% · LOI(결정수) 14.0%
- 석회석(생석회석/whiting): 방해석 CaCO₃, 분자량 100.09
  → CaO 56.0% · LOI(CO₂) 44.0%
- 규석: 순수 SiO₂ 100%, LOI 0
- 벤토나이트: 순수광물이 아니라 몬모릴로나이트 주성분의 점토 혼합물이라
  화학양론식이 없다. 표준 참고문헌(와이오밍 벤토나이트 평균 분석치)의
  근사값을 쓴다.

이 값들로 unity_formula를 돌리면 05-1·05-2절에 적힌 수치(장석 단독
SiO₂:Al₂O₃≈5.97, 카올린 0/10/20/30% 배경에서의 비 15.19/10.26/7.63/6.00 등)가
문헌 추정치 수준의 오차(≤0.01) 안에서 재현된다 — 검증은
``tests/chem/test_umf.py`` 와 ``CLAUDE.md`` 의 수치 표를 참조.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

__all__ = ["Material", "MATERIALS", "material"]


@dataclass(frozen=True, slots=True)
class Material:
    """원료 하나의 산화물 분석표.

    ``oxides`` 는 산화물 기호 → **원료 원상태(raw) 기준** 중량%다(소성 후
    비율이 아니다). ``loi`` 는 강열감량(소성 중 날아가는 비율, %)이다.
    ``sum(oxides.values()) + loi`` 는 100에 가까워야 한다 — 원료 전체
    질량은 산화물로 남는 부분과 날아가는 부분(LOI)으로 나뉠 뿐이다.
    """

    name: str
    oxides: dict[str, float]
    loi: float = 0.0

    def __post_init__(self) -> None:
        if not self.oxides:
            raise ValueError(f"원료 {self.name!r}에 산화물 조성이 없다")
        for oxide, pct in self.oxides.items():
            if pct < 0:
                raise ValueError(f"{self.name!r}의 {oxide} 비율이 음수다: {pct}")
        if self.loi < 0:
            raise ValueError(f"{self.name!r}의 LOI가 음수다: {self.loi}")
        total = sum(self.oxides.values()) + self.loi
        if not math.isclose(total, 100.0, abs_tol=1.0):
            raise ValueError(
                f"원료 {self.name!r}의 산화물 합+LOI가 {total:.2f}%다. "
                "100%에 가까워야 한다(원상태 질량 = 산화물 + LOI)"
            )


#: 규석 — 순수 실리카. 알루미나 공급 없음(05-1절 근거①의 전제).
_SILICA = Material(name="규석", oxides={"SiO2": 100.0}, loi=0.0)

#: 장석(포타쉬 장석) — 정장석 이론조성. 3원료 세트에서 **유일한 알루미나
#: 공급원**(05-1절 근거①) 이자 유일한 K₂O 공급원.
_FELDSPAR = Material(
    name="장석",
    oxides={"K2O": 16.9, "Al2O3": 18.4, "SiO2": 64.7},
    loi=0.0,
)

#: 석회석(생석회석/whiting) — 방해석 이론조성. CaO 공급원이자 유일한 융제
#: 확장축(05-2절 "석회석 축").
_WHITING = Material(name="석회석", oxides={"CaO": 56.0}, loi=44.0)

#: 카올린 — 카올리나이트 이론조성. 배경 비율로 고정하는 보조 알루미나
#: 공급원(05-1절)이자 슬립 현탁 보조(근거②).
_KAOLIN = Material(
    name="카올린",
    oxides={"Al2O3": 39.5, "SiO2": 46.5},
    loi=14.0,
)

#: 벤토나이트 — 현탁제, 탐색 변수 아님(05-1절). 소량 고정 사용이 전제이므로
#: UMF 기여는 무시할 수준이지만, 계산에서 배제하지 않고 그대로 반영한다.
#: 조성은 와이오밍(Na형) 벤토나이트의 표준 근사 분석치.
_BENTONITE = Material(
    name="벤토나이트",
    oxides={
        "SiO2": 60.9,
        "Al2O3": 19.6,
        "Fe2O3": 3.9,
        "MgO": 3.2,
        "CaO": 0.7,
        "Na2O": 1.9,
        "K2O": 0.5,
    },
    loi=9.3,
)

#: 원료 DB. 05-1절이 요구하는 최소 세트: 규석·장석·석회석·카올린·벤토나이트.
MATERIALS: dict[str, Material] = {
    m.name: m for m in (_SILICA, _FELDSPAR, _WHITING, _KAOLIN, _BENTONITE)
}


def material(name: str) -> Material:
    """이름으로 원료를 찾는다. 없으면 등록된 이름 목록과 함께 KeyError.

    :mod:`kiln.chem.umf` 가 배합비(``{원료명: %}``)를 산화물로 바꿀 때
    쓰는 유일한 조회 경로다.
    """
    try:
        return MATERIALS[name]
    except KeyError:
        raise KeyError(
            f"{name!r}는 원료 DB에 없다(05-1절). 등록된 원료: {sorted(MATERIALS)}"
        ) from None
