"""4-3절 · Stull 참조 분류 테스트.

세 규칙을 확인한다 — ① 항상 판정이 아닌 참조로서 disclaimer를 싣는다,
② 판정은 (SiO2, Al2O3) 2차원으로 하며 비 하나로는 갈리지 않는 사례가
실제로 갈린다, ③ 이산 프리셋(cone6/cone11)만 허용하고 둘은 서로 다른
결과를 낼 수 있는 독립된 표다.
"""

from __future__ import annotations

import pytest

from kiln.chem.stull import StullZone, classify
from kiln.chem.umf import UMF, unity_formula_from_materials


def test_provenance_note_always_carries_literature_disclaimer() -> None:
    """4-3절: provenance_note는 반드시 문헌 추정임을 명시해야 한다."""
    umf = unity_formula_from_materials({"규석": 40.0, "장석": 40.0, "석회석": 20.0})
    reading = classify(umf)
    assert "문헌 추정" in reading.provenance_note
    assert "참조" in reading.provenance_note or "판정" in reading.provenance_note


def test_bright_zone_for_classic_gloss_recipe() -> None:
    umf = unity_formula_from_materials({"규석": 40.0, "장석": 40.0, "석회석": 20.0})
    reading = classify(umf, cone="cone11")
    assert reading.zone is StullZone.BRIGHT
    assert reading.sio2 == pytest.approx(umf.sio2)
    assert reading.al2o3 == pytest.approx(umf.al2o3)
    assert reading.cone == "콘 11"


def test_low_silica_region_is_flagged_ambiguous_not_asserted() -> None:
    """05-2절 석회석 40% 지점(SiO2≈1.81)처럼 SiO2가 아주 낮으면, classify는
    UNDERFIRED나 MATTE 어느 쪽도 단정하지 않고 전용 구분불가 영역을 낸다."""
    umf = unity_formula_from_materials({"규석": 30.0, "장석": 30.0, "석회석": 40.0})
    reading = classify(umf, cone="cone11")
    assert reading.zone is StullZone.LOW_SILICA_AMBIGUOUS
    assert "미용융" in reading.provenance_note
    assert "매트" in reading.provenance_note
    assert "냉각" in reading.provenance_note  # 갈라주는 것은 콘·유지시간·냉각


def test_underfired_zone_for_excess_silica() -> None:
    """장석 단독(SiO2 UMF≈6.0)처럼 융제 대비 SiO2가 과다하면 미용융 방향."""
    umf = unity_formula_from_materials({"장석": 100.0})
    reading = classify(umf, cone="cone11")
    assert reading.zone is StullZone.UNDERFIRED


def test_only_discrete_cone_presets_allowed() -> None:
    umf = unity_formula_from_materials({"규석": 40.0, "장석": 40.0, "석회석": 20.0})
    with pytest.raises(ValueError):
        classify(umf, cone="cone9")  # type: ignore[arg-type]


def test_cone_presets_are_independent_tables_not_a_continuous_shift() -> None:
    """같은 UMF라도 콘6/콘11 표가 달라 결과가 달라질 수 있다 — 두 표가
    독립적인 문헌값이라는 뜻이고, 연속 함수로 이동시킨 값이 아니다."""
    umf = UMF(
        fluxes={"CaO": 1.0},
        stabilizers={"Al2O3": 0.3},
        glass_formers={"SiO2": 3.5},
    )
    cone11_reading = classify(umf, cone="cone11")
    cone6_reading = classify(umf, cone="cone6")
    assert cone11_reading.zone is StullZone.BRIGHT
    assert cone6_reading.zone is StullZone.SEMI_MATTE
    assert cone11_reading.zone is not cone6_reading.zone
    assert cone11_reading.cone == "콘 11"
    assert cone6_reading.cone == "콘 6"


def test_classify_never_uses_ratio_directly_two_points_same_ratio_can_differ() -> None:
    """05-2절 근거: 비가 같아도(둘 다 15.19) SiO2 절대값이 다르면 영역이
    달라질 수 있다 — 비 1차원 판정이었다면 항상 같은 영역이 나왔을 것이다."""
    high_sio2 = unity_formula_from_materials(
        {"규석": 45.0, "장석": 45.0, "석회석": 10.0}
    )  # SiO2≈6.83, ratio≈15.19
    low_sio2 = unity_formula_from_materials(
        {"규석": 30.0, "장석": 30.0, "석회석": 40.0}
    )  # SiO2≈1.81, ratio≈15.19 (같은 비)
    assert high_sio2.ratio == pytest.approx(low_sio2.ratio, abs=0.05)

    reading_high = classify(high_sio2, cone="cone11")
    reading_low = classify(low_sio2, cone="cone11")
    assert reading_high.zone is not reading_low.zone
