"""05-1 · 05-2절 · UMF 계산 회귀 테스트.

기획서에 박힌 수치를 그대로 앵커로 쓴다(공통 규칙 5). 허용 오차는 실제
계산으로 확인한 최대 편차(≤0.0045)에 여유를 둔 **절대오차 0.01**이다 —
문헌 조성치(정장석·카올리나이트·방해석의 이론 화학양론식)에서 나온 결과이지
목표 수치에 맞춰 거꾸로 조정한 값이 아니다(scratch 계산: 최대 편차는
kaolin30 Al2O3에서 0.00446).
"""

from __future__ import annotations

import math

import pytest

from kiln.chem.umf import UMF, unity_formula, unity_formula_from_materials
from kiln.domain.models import GlazeRecipe

TOL = 0.01  # 절대오차 (기획서 수치 대비). 실측 최대편차 0.0045의 2배 이상 여유.


def test_feldspar_alone_matches_plan_anchor() -> None:
    """05-1절: 장석 단독 SiO2:Al2O3 ≈ 5.97, Al2O3 UMF 최대 ≈ 1.01."""
    umf = unity_formula_from_materials({"장석": 100.0})
    assert umf.ratio == pytest.approx(5.97, abs=TOL)
    assert umf.al2o3 == pytest.approx(1.01, abs=TOL)


def test_fluxes_always_sum_to_unity() -> None:
    """UMF 정의: 융제 몰수 합은 정규화 기준이므로 항상 1.0이어야 한다."""
    umf = unity_formula_from_materials({"규석": 40.0, "장석": 40.0, "석회석": 20.0})
    assert sum(umf.fluxes.values()) == pytest.approx(1.0, abs=1e-9)


@pytest.mark.parametrize(
    "silica_pct,feldspar_pct,whiting_pct,target_sio2,target_al2o3",
    [
        # 05-2절 1차 탐색(±2%p 격자) 후보 A~D
        (40, 40, 20, 4.04, 0.27),
        (42, 38, 20, 4.14, 0.26),
        (40, 38, 22, 3.73, 0.24),
        (38, 42, 20, 3.94, 0.28),
    ],
)
def test_first_grid_candidates_match_plan_anchors(
    silica_pct: float,
    feldspar_pct: float,
    whiting_pct: float,
    target_sio2: float,
    target_al2o3: float,
) -> None:
    umf = unity_formula_from_materials(
        {"규석": silica_pct, "장석": feldspar_pct, "석회석": whiting_pct}
    )
    assert umf.sio2 == pytest.approx(target_sio2, abs=TOL)
    assert umf.al2o3 == pytest.approx(target_al2o3, abs=TOL)


@pytest.mark.parametrize(
    "whiting_pct,target_sio2",
    [(10, 6.83), (20, 4.04), (30, 2.65), (40, 1.81)],
)
def test_limestone_sweep_matches_plan_anchors(
    whiting_pct: float, target_sio2: float
) -> None:
    """05-2절: 석회석만 10%p씩 벌린 격자. 규석:장석은 남는 비율을 1:1로 채운다."""
    remainder = 100.0 - whiting_pct
    half = remainder / 2.0
    umf = unity_formula_from_materials(
        {"규석": half, "장석": half, "석회석": whiting_pct}
    )
    assert umf.sio2 == pytest.approx(target_sio2, abs=TOL)


def test_limestone_sweep_ratio_is_constant_while_sio2_collapses() -> None:
    """05-2절 근거: 비(ratio)는 전 구간 불변인데 SiO2 절대값은 6배 가까이
    떨어진다 — Stull 판정에 비 하나만 쓰면 안 되는 이유(4-3절)의 정량 증거.
    """
    ratios = []
    sio2s = []
    for whiting_pct in (10, 20, 30, 40):
        remainder = 100.0 - whiting_pct
        half = remainder / 2.0
        umf = unity_formula_from_materials(
            {"규석": half, "장석": half, "석회석": whiting_pct}
        )
        ratios.append(umf.ratio)
        sio2s.append(umf.sio2)

    for r in ratios[1:]:
        assert r == pytest.approx(ratios[0], abs=TOL)
    assert sio2s[0] / sio2s[-1] > 3.0  # 6.83 / 1.81 ≈ 3.77


@pytest.mark.parametrize(
    "kaolin_pct,target_al2o3,target_ratio",
    [
        (0, 0.27, 15.19),
        (10, 0.42, 10.26),
        (20, 0.62, 7.63),
        (30, 0.88, 6.00),
    ],
)
def test_kaolin_background_sweep_matches_plan_table(
    kaolin_pct: float, target_al2o3: float, target_ratio: float
) -> None:
    """05-1절 카올린 배경 비율 표.

    카올린을 배경 비율로 얹고, 규석/장석/석회석이 남는 비율을 40:40:20
    비율 그대로 채운다고 해석한다(과제 지시 해석 그대로) — 이 해석으로
    표의 네 행이 전부 절대오차 0.01 안에서 재현된다(실측 최대편차 0.0045).
    """
    remainder = 100.0 - kaolin_pct
    umf = unity_formula_from_materials(
        {
            "규석": remainder * 0.4,
            "장석": remainder * 0.4,
            "석회석": remainder * 0.2,
            "카올린": kaolin_pct,
        }
    )
    assert umf.al2o3 == pytest.approx(target_al2o3, abs=TOL)
    assert umf.ratio == pytest.approx(target_ratio, abs=TOL)


def test_kaolin_30_percent_barely_reaches_feldspar_alone_alumina_level() -> None:
    """05-1절: "카올린 30%는 확장 변수가 아니라 배합의 주성분이다" —
    카올린 30%에서의 비(≈6.00)가 장석 단독 비(≈5.97)에 겨우 도달한다."""
    umf_kaolin30 = unity_formula_from_materials(
        {"규석": 28.0, "장석": 28.0, "석회석": 14.0, "카올린": 30.0}
    )
    umf_feldspar_alone = unity_formula_from_materials({"장석": 100.0})
    assert umf_kaolin30.ratio == pytest.approx(umf_feldspar_alone.ratio, abs=0.1)


def test_unity_formula_from_recipe_matches_materials_path() -> None:
    """unity_formula(recipe)는 recipe.materials를
    unity_formula_from_materials에 그대로 위임한다."""
    materials = {"규석": 40.0, "장석": 40.0, "석회석": 20.0}
    recipe = GlazeRecipe(recipe_id="r1", name="테스트 유약", materials=materials)
    from_recipe = unity_formula(recipe)
    from_dict = unity_formula_from_materials(materials)
    assert from_recipe == from_dict


def test_no_flux_raises_value_error() -> None:
    """규석 단독처럼 융제가 전혀 없으면 Unity 정규화 분모가 0이라 정의 불가."""
    with pytest.raises(ValueError):
        unity_formula_from_materials({"규석": 100.0})


def test_unknown_material_name_propagates_key_error() -> None:
    with pytest.raises(KeyError):
        unity_formula_from_materials({"존재하지않는원료": 100.0})


def test_umf_sio2_al2o3_properties_read_correct_groups() -> None:
    umf = UMF(
        fluxes={"CaO": 0.6, "K2O": 0.4},
        stabilizers={"Al2O3": 0.3},
        glass_formers={"SiO2": 3.5},
    )
    assert umf.sio2 == 3.5
    assert umf.al2o3 == 0.3
    assert umf.ratio == pytest.approx(3.5 / 0.3)


def test_umf_ratio_is_infinite_without_al2o3() -> None:
    umf = UMF(fluxes={"CaO": 1.0}, stabilizers={}, glass_formers={"SiO2": 2.0})
    assert math.isinf(umf.ratio)
