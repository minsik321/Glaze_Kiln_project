"""04절(4-3 Stull) · 05-1절 · UMF(Unity Molecular Formula) 계산.

표준 유약화학 절차를 그대로 구현한다 — 지어낸 정규화가 아니다.

    1. 원료마다 산화물 중량%를 배합비(%)로 가중해 **질량**으로 바꾼다.
    2. 각 산화물 질량을 몰질량으로 나눠 **몰수**로 바꾼다.
    3. 배합 전체에서 산화물별 몰수를 합산한다.
    4. 산화물을 세 그룹으로 나눈다 — 융제(RO/R₂O), 안정제(R₂O₃), 유리형성제(RO₂).
    5. **융제 몰수 합으로 세 그룹 전부를 나눈다.** 그 결과 융제 그룹의 합이
       정확히 1.0이 되고(Unity), 안정제·유리형성제는 "융제 1몰당" 단위로
       표현된다 — 이것이 UMF의 정의다.

:mod:`kiln.chem.materials` 의 ``Material.oxides`` 는 이미 원료 원상태 기준
중량%이고 LOI가 별도 필드로 빠져 있으므로, 여기서 ``oxides`` 딕셔너리만
읽으면 **강열감량은 자동으로 몰 계산에서 제외된다**(소성 후/calcined 기준).
"""

from __future__ import annotations

from dataclasses import dataclass

from kiln.chem.materials import material
from kiln.domain.models import GlazeRecipe

__all__ = ["UMF", "unity_formula", "unity_formula_from_materials"]


#: 산화물 → 몰질량 [g/mol]. 과제 지시 수치를 그대로 쓴다(문헌 표준값).
#: PbO·ZrO2는 지시에 몰질량이 없었으나 분류표(융제/유리형성제)에는 있어
#: 참고용으로 채워 둔다 — 현재 :mod:`kiln.chem.materials` 원료 DB에는
#: 등장하지 않는다.
MOLAR_MASS: dict[str, float] = {
    "SiO2": 60.08,
    "Al2O3": 101.96,
    "CaO": 56.08,
    "K2O": 94.20,
    "Na2O": 61.98,
    "MgO": 40.30,
    "Fe2O3": 159.69,
    "TiO2": 79.87,
    "B2O3": 69.62,
    "Li2O": 29.88,
    "BaO": 153.33,
    "SrO": 103.62,
    "ZnO": 81.38,
    "P2O5": 141.94,
    "PbO": 223.20,
    "ZrO2": 123.22,
}

#: 융제 — RO/R2O. 이 합으로 전체를 정규화한다(Unity의 정의).
FLUX_OXIDES: frozenset[str] = frozenset(
    {"CaO", "MgO", "K2O", "Na2O", "Li2O", "BaO", "SrO", "ZnO", "PbO"}
)

#: 안정제 — R2O3.
STABILIZER_OXIDES: frozenset[str] = frozenset({"Al2O3", "B2O3", "Fe2O3"})

#: 유리형성제 — RO2 계열. P2O5는 엄밀히는 R2O5지만 유약화학 관행상
#: 네트워크 형성제로 함께 취급한다.
GLASS_FORMER_OXIDES: frozenset[str] = frozenset({"SiO2", "TiO2", "ZrO2", "P2O5"})


@dataclass(frozen=True, slots=True)
class UMF:
    """Unity Molecular Formula — 산화물 몰비 좌표.

    ``fluxes`` 의 합은 항상 1.0(부동소수 오차 내)이다. ``stabilizers``·
    ``glass_formers`` 는 "융제 1몰당" 단위로, 그 자체의 합에는 의미가 없다
    (산화물 성격이 서로 달라 더할 이유가 없다) — Stull 좌표로 쓰는 것은
    그중 SiO₂·Al₂O₃ 두 값이다(4-3절).
    """

    fluxes: dict[str, float]
    stabilizers: dict[str, float]
    glass_formers: dict[str, float]

    @property
    def sio2(self) -> float:
        """유리형성제 중 SiO₂ UMF 값. Stull 좌표의 y축(4-3절)."""
        return self.glass_formers.get("SiO2", 0.0)

    @property
    def al2o3(self) -> float:
        """안정제 중 Al₂O₃ UMF 값. Stull 좌표의 x축(4-3절)."""
        return self.stabilizers.get("Al2O3", 0.0)

    @property
    def ratio(self) -> float:
        """SiO₂ : Al₂O₃ 비.

        05-1절 수치(장석 단독 ≈5.97 등)는 이 비를 인용하지만, 4-3절 규칙은
        **판정에 이 비 하나만 쓰지 말라**는 것이다 — 05-2절 석회석 스윕처럼
        비가 같아도 절대 SiO₂량이 6배까지 벌어질 수 있어, 비 하나로는
        구분되지 않는 배합이 실제로는 다르게 녹는다. 그래서 :mod:`kiln.chem.stull`
        의 ``classify`` 는 이 값이 아니라 ``(sio2, al2o3)`` 2차원 좌표로 판정한다.
        Al₂O₃가 0이면(예: 규석 단독) 비가 정의되지 않으므로 ``math.inf`` 를 낸다.
        """
        al2o3 = self.al2o3
        if al2o3 <= 0.0:
            return float("inf")
        return self.sio2 / al2o3


def unity_formula_from_materials(materials: dict[str, float]) -> UMF:
    """배합비(원료명 → 중량%)로부터 UMF를 계산한다 (05-1절).

    절차는 모듈 docstring의 5단계 그대로다. ``materials`` 의 합이 100이어야
    한다는 제약은 여기서 걸지 않는다 — :class:`~kiln.domain.models.GlazeRecipe`
    가 이미 그 불변식을 갖고 있고(:func:`unity_formula`), 이 함수는 원료
    딕셔너리만으로도(레시피 객체 없이) 탐색 후보 평가에 쓰일 수 있어야
    하기 때문이다(:mod:`kiln.search` 가 이 경로를 쓴다).

    융제 몰수 합이 0이면(예: 규석 단독처럼 융제가 전혀 없는 배합) Unity
    정규화의 분모가 0이 되어 정의 불가이므로 ``ValueError`` 를 낸다.
    """
    moles: dict[str, float] = {}
    for name, pct in materials.items():
        mat = material(name)
        for oxide, wt_pct in mat.oxides.items():
            if oxide not in MOLAR_MASS:
                raise ValueError(
                    f"산화물 {oxide!r}(원료 {name!r})의 몰질량이 등록되어 있지 않다"
                )
            mass = pct * wt_pct / 100.0
            moles[oxide] = moles.get(oxide, 0.0) + mass / MOLAR_MASS[oxide]

    flux_total = sum(v for oxide, v in moles.items() if oxide in FLUX_OXIDES)
    if flux_total <= 0.0:
        raise ValueError(
            "이 배합에는 융제 산화물이 없다. UMF는 융제 몰수 합으로 정규화하므로"
            "(Unity) 융제가 0이면 정의되지 않는다"
        )

    def _normalized(group: frozenset[str]) -> dict[str, float]:
        return {
            oxide: v / flux_total for oxide, v in moles.items() if oxide in group
        }

    return UMF(
        fluxes=_normalized(FLUX_OXIDES),
        stabilizers=_normalized(STABILIZER_OXIDES),
        glass_formers=_normalized(GLASS_FORMER_OXIDES),
    )


def unity_formula(recipe: GlazeRecipe) -> UMF:
    """레시피(:class:`~kiln.domain.models.GlazeRecipe`)의 UMF (05-1절).

    ``recipe.materials`` 를 그대로 :func:`unity_formula_from_materials` 에
    넘긴다. UMF·Stull 좌표를 ``GlazeRecipe`` 에 저장하지 않는 이유(원료 DB가
    갱신되면 저장된 좌표가 조용히 낡는다)는 domain 모듈 docstring 참조.
    """
    return unity_formula_from_materials(recipe.materials)
