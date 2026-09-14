"""05-1절 · 원료 산화물 분석표 회귀 테스트."""

from __future__ import annotations

import math

import pytest

from kiln.chem.materials import MATERIALS, Material, material


def test_minimum_material_set_registered() -> None:
    """05-1절이 요구하는 최소 원료 세트: 규석·장석·석회석·카올린·벤토나이트."""
    required = {"규석", "장석", "석회석", "카올린", "벤토나이트"}
    assert required <= set(MATERIALS)


def test_material_lookup_returns_registered_entry() -> None:
    assert material("규석") is MATERIALS["규석"]
    assert material("장석").oxides["Al2O3"] == pytest.approx(18.4)


def test_material_lookup_unknown_name_raises_key_error() -> None:
    with pytest.raises(KeyError):
        material("존재하지않는원료")


def test_all_registered_materials_balance_oxides_and_loi() -> None:
    """원료 원상태 질량 = 산화물 몰비 계산에 쓰는 부분 + LOI(강열감량).

    합이 100%에서 크게 벗어나면 조성표 자체가 잘못 옮겨진 것이다.
    """
    for mat in MATERIALS.values():
        total = sum(mat.oxides.values()) + mat.loi
        assert math.isclose(total, 100.0, abs_tol=1.0), mat.name


def test_silica_is_pure_sio2() -> None:
    silica = material("규석")
    assert silica.oxides == {"SiO2": 100.0}
    assert silica.loi == 0.0


def test_whiting_and_kaolin_carry_loi_separately_from_oxides() -> None:
    """석회석·카올린은 LOI가 커서, oxides만으로는 100%가 안 된다 —
    UMF 계산이 LOI를 산화물 몰수에서 자동으로 제외하는 전제(05-1절)."""
    whiting = material("석회석")
    assert sum(whiting.oxides.values()) < 100.0
    assert whiting.loi > 0.0

    kaolin = material("카올린")
    assert sum(kaolin.oxides.values()) < 100.0
    assert kaolin.loi > 0.0


def test_material_rejects_negative_oxide_percentage() -> None:
    with pytest.raises(ValueError):
        Material(name="불량원료", oxides={"SiO2": -1.0})


def test_material_rejects_unbalanced_oxide_loi_total() -> None:
    with pytest.raises(ValueError):
        Material(name="불량원료", oxides={"SiO2": 50.0}, loi=0.0)
