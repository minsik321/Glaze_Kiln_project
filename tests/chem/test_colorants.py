"""4-4-a절 · 착색 산화물 참고 색상표 회귀 테스트.

이 표는 **예측이 아니라 열람**이다(00절 예외 범위). 여기서 지키는 것은
색이 "맞는가"가 아니라 (a) 최소 6종 세트가 등록돼 있는가, (b) 문헌 참고값
캐비어트가 모든 항목에 실려 있는가, (c) 보간·채도·명도 계산이 조성이나
소성 조건을 전혀 읽지 않는가다.
"""

from __future__ import annotations

import pytest

from kiln.chem.colorants import COLORANTS, ColorantOxide, colorant, dose_grams, mix


def test_minimum_colorant_set_registered() -> None:
    """4-4-a절이 요구하는 6종: 철·동·크롬·코발트·니켈·망간."""
    required = {"Fe2O3", "CoO", "CuO", "Cr2O3", "MnO2", "NiO"}
    assert required <= set(COLORANTS)


def test_every_colorant_carries_the_literature_caveat() -> None:
    """캐비어트가 빠지면 참고표가 예측으로 읽힌다(4-4-a절)."""
    for c in COLORANTS.values():
        assert "문헌 참고값" in c.note
        assert "예측이 아니라" in c.note


def test_colorant_lookup_returns_registered_entry() -> None:
    assert colorant("Fe2O3") is COLORANTS["Fe2O3"]


def test_chromium_notes_the_concentration_dependent_pink_without_a_separate_value() -> None:
    """크롬은 극소량+주석 조건에서 핑크로 달라진다 — 주석으로만 남기고
    별도 색상값·농도별 표는 만들지 않는다(4-4-a절, DECISIONS.md)."""
    cr = colorant("Cr2O3")
    assert "핑크" in cr.note or "pink" in cr.note.lower()
    assert cr.hex == "#4f7a3a"  # 통상 첨가량 기준값 그대로, 두 번째 값이 생기지 않았다


def test_colorant_lookup_unknown_symbol_raises_key_error() -> None:
    with pytest.raises(KeyError):
        colorant("존재하지않는산화물")


def test_colorant_oxide_rejects_malformed_hex() -> None:
    with pytest.raises(ValueError):
        ColorantOxide(
            "X", "테스트", "not-a-color", "문헌 참고값. 예측이 아니라 열람이다.",
            typical_pct=(1.0, 5.0),
        )


def test_colorant_oxide_rejects_missing_caveat() -> None:
    with pytest.raises(ValueError):
        ColorantOxide("X", "테스트", "#123456", "캐비어트 없음", typical_pct=(1.0, 5.0))


def test_colorant_oxide_rejects_backwards_typical_pct_range() -> None:
    with pytest.raises(ValueError):
        ColorantOxide(
            "X", "테스트", "#123456", "문헌 참고값. 예측이 아니라 열람이다.",
            typical_pct=(5.0, 1.0),
        )


def test_every_colorant_has_a_positive_typical_pct_range() -> None:
    for c in COLORANTS.values():
        lo, hi = c.typical_pct
        assert 0.0 <= lo < hi


# ─── 보간·채도·명도는 예측이 아니라 표시값 계산이다 ──────────────────────────


def test_mix_with_blend_t_zero_returns_first_oxide_color() -> None:
    result = mix("Fe2O3", "CoO", blend_t=0.0)
    assert result.hex == COLORANTS["Fe2O3"].hex


def test_mix_with_blend_t_one_returns_second_oxide_color() -> None:
    result = mix("Fe2O3", "CoO", blend_t=1.0)
    assert result.hex == COLORANTS["CoO"].hex


def test_mix_blend_is_between_the_two_reference_colors() -> None:
    """사잇값은 RGB 선형 보간이지 새로운 배합 모델이 아니다."""
    lo = mix("Fe2O3", "CoO", blend_t=0.0).rgb
    hi = mix("Fe2O3", "CoO", blend_t=1.0).rgb
    mid = mix("Fe2O3", "CoO", blend_t=0.5).rgb
    for lo_c, hi_c, mid_c in zip(lo, hi, mid):
        assert min(lo_c, hi_c) - 1e-9 <= mid_c <= max(lo_c, hi_c) + 1e-9


def test_mix_clamps_blend_t_outside_unit_range() -> None:
    over = mix("Fe2O3", "CoO", blend_t=5.0)
    under = mix("Fe2O3", "CoO", blend_t=-5.0)
    assert over.hex == COLORANTS["CoO"].hex
    assert under.hex == COLORANTS["Fe2O3"].hex


def test_mix_without_second_oxide_returns_first_oxide_color_unchanged() -> None:
    result = mix("Fe2O3")
    assert result.hex == COLORANTS["Fe2O3"].hex


def test_mix_saturation_and_brightness_deltas_change_the_color() -> None:
    base = mix("Fe2O3")
    desaturated = mix("Fe2O3", saturation_delta=-1.0)
    darker = mix("Fe2O3", brightness_delta=-1.0)
    assert desaturated.hex != base.hex
    assert darker.hex != base.hex


def test_mix_clamps_saturation_and_brightness_to_valid_range() -> None:
    # 극단값을 넣어도 HSV S·V가 [0, 1] 밖으로 나가지 않아야 한다(예외 없이 계산됨).
    result = mix("Fe2O3", saturation_delta=99.0, brightness_delta=-99.0)
    assert result.hex  # 깨지지 않고 계산됨


def test_mix_always_carries_the_literature_caveat_in_notes() -> None:
    result = mix("Fe2O3", "CoO", blend_t=0.3)
    assert any("문헌 참고값" in n for n in result.notes)
    assert any("사잇값" in n for n in result.notes)


def test_mix_unknown_oxide_raises_key_error() -> None:
    with pytest.raises(KeyError):
        mix("존재하지않는산화물")


# ─── 첨가량(wt%) 슬라이더 — 중성 바탕색↔참고색 보간이지 발색 곡선이 아니다 ────


def test_amount_pct_zero_returns_the_neutral_base_not_the_oxide_color() -> None:
    """첨가량 0%는 무착색 상태를 표시용으로 근사한 것 — 산화물 색이 아니다."""
    result = mix("Fe2O3", amount_pct=0.0)
    assert result.hex != COLORANTS["Fe2O3"].hex


def test_amount_pct_at_typical_upper_bound_returns_the_full_reference_color() -> None:
    hi = COLORANTS["Fe2O3"].typical_pct[1]
    result = mix("Fe2O3", amount_pct=hi)
    assert result.hex == COLORANTS["Fe2O3"].hex


def test_amount_pct_above_typical_range_is_clamped_not_extrapolated() -> None:
    hi = COLORANTS["Fe2O3"].typical_pct[1]
    at_max = mix("Fe2O3", amount_pct=hi).hex
    way_over = mix("Fe2O3", amount_pct=hi * 100).hex
    assert way_over == at_max


def test_amount_pct_none_skips_tinting_and_matches_pre_existing_behaviour() -> None:
    """amount_pct 를 안 주면(기본값) 기존 동작(문헌 참고색 그대로)과 같아야 한다."""
    assert mix("Fe2O3").hex == mix("Fe2O3", amount_pct=None).hex == COLORANTS["Fe2O3"].hex


def test_amount_pct_between_zero_and_full_is_between_base_and_reference() -> None:
    lo = mix("Fe2O3", amount_pct=0.0).rgb
    hi = mix("Fe2O3", amount_pct=COLORANTS["Fe2O3"].typical_pct[1]).rgb
    mid = mix("Fe2O3", amount_pct=COLORANTS["Fe2O3"].typical_pct[1] / 2).rgb
    for lo_c, hi_c, mid_c in zip(lo, hi, mid):
        assert min(lo_c, hi_c) - 1e-9 <= mid_c <= max(lo_c, hi_c) + 1e-9


def test_amount_pct_note_flags_it_as_a_display_intensity_not_a_dose_curve() -> None:
    result = mix("Fe2O3", amount_pct=3.0)
    assert any("발색 곡선이 아니다" in n for n in result.notes)


# ─── 첨가량 역산 — 화면 색을 중성 바탕색↔참고색 직선에 정사영한다 ────────────


def test_implied_amount_pct_matches_amount_input_when_hue_only() -> None:
    """채도·명도를 안 건드리면(델타 0) 역산값이 입력값과 정확히 같아야 한다."""
    hi = COLORANTS["Fe2O3"].typical_pct[1]
    for amt in (0.0, hi / 2, hi):
        result = mix("Fe2O3", amount_pct=amt)
        assert result.implied_amount_pct == pytest.approx(amt)
        assert result.match_quality == pytest.approx(1.0)


def test_implied_amount_pct_defaults_to_typical_upper_bound_without_amount_input() -> None:
    hi = COLORANTS["Fe2O3"].typical_pct[1]
    result = mix("Fe2O3")
    assert result.implied_amount_pct == pytest.approx(hi)
    assert result.match_quality == pytest.approx(1.0)


def test_match_quality_stays_within_unit_range_under_extreme_hsv() -> None:
    result = mix("Fe2O3", amount_pct=3.0, saturation_delta=0.95, brightness_delta=-0.95)
    assert 0.0 <= result.match_quality <= 1.0


def test_implied_amount_pct_is_never_negative_even_with_darkening() -> None:
    result = mix("Fe2O3", amount_pct=0.0, brightness_delta=-1.0)
    assert result.implied_amount_pct >= 0.0


def test_implied_amount_pct_is_capped_under_extreme_hsv_push() -> None:
    hi = COLORANTS["CoO"].typical_pct[1]
    result = mix("CoO", amount_pct=hi, saturation_delta=1.0, brightness_delta=1.0)
    assert result.implied_amount_pct <= hi * 5.0 + 1e-6


def test_low_match_quality_is_flagged_in_notes_consistently() -> None:
    """플래그 문구가 뜨는지는 실제 match_quality 값과 항상 일치해야 한다."""
    result = mix("Fe2O3", amount_pct=3.0, saturation_delta=1.0, brightness_delta=1.0)
    flagged = any("그대로 나오지 않는다" in n for n in result.notes)
    assert flagged == (result.match_quality < 0.7)


def test_high_match_quality_when_only_hue_and_amount_are_used() -> None:
    result = mix("Fe2O3", "CoO", blend_t=0.4, amount_pct=3.0)
    assert not any("그대로 나오지 않는다" in n for n in result.notes)
    assert result.match_quality == pytest.approx(1.0)


# ─── 그램 수는 산수다 ─────────────────────────────────────────────────────────


def test_dose_grams_is_percent_of_dry_batch_weight() -> None:
    assert dose_grams(2.0, 500.0) == pytest.approx(10.0)
    assert dose_grams(0.0, 500.0) == 0.0


def test_dose_grams_rejects_negative_inputs() -> None:
    with pytest.raises(ValueError):
        dose_grams(-1.0, 500.0)
    with pytest.raises(ValueError):
        dose_grams(2.0, -500.0)
