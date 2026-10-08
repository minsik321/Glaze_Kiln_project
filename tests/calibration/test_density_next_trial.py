"""kiln.calibration.density.suggest_next_trial — 평가 1건에서 다음 시도 제안 1건.

계약:
- 결함 확인이 끝나지 않았거나 전체 평가가 없으면 제안하지 않는다(None).
- 어긋난 항목 중 우선순위(결함 > 광택 > 투명도 > 질감 > 색상) 하나만, 변수 하나만 바꾼다.
- "차이가 있어요"는 전체 폭, "목표에 가까워요"인데 일부만 어긋나면 절반 폭이다.
- 두께 제안은 위험 판정 안전 범위 안으로 제한하고, 모든 제안은 추정이다.
"""

from __future__ import annotations

from kiln.calibration.density import DensityCoefficientTable, suggest_next_trial


def _table(**overrides) -> DensityCoefficientTable:
    base = dict(recipe_id="coastal-satin")
    base.update(overrides)
    return DensityCoefficientTable(**base)


def _suggest(**overrides):
    base = dict(overall="different", defects_reviewed=True, mean_thickness_mm=1.0)
    base.update(overrides)
    return suggest_next_trial(_table(), **base)


def test_incomplete_evaluation_gives_no_suggestion() -> None:
    assert _suggest(defects_reviewed=False) is None
    assert _suggest(overall=None) is None


def test_single_different_is_enough_to_get_a_trial() -> None:
    s = _suggest(gloss_comparison="less")
    assert s is not None
    assert (s.variable, s.trigger, s.magnitude, s.hold_delta_min) == ("hold", "gloss", "full", 10)
    assert s.estimated is True


def test_close_with_minor_deviation_uses_half_step() -> None:
    s = _suggest(overall="close", gloss_comparison="less")
    assert s is not None and s.magnitude == "half" and s.hold_delta_min == 5


def test_everything_matching_suggests_nothing_to_change() -> None:
    s = _suggest(overall="close", gloss_comparison="match", transparency_comparison="match", color="close")
    assert s is not None and s.variable == "none"
    different = _suggest(gloss_comparison="match", transparency_comparison="match", texture_comparison="match", color="close")
    assert different is not None and different.variable == "none" and "조정 없음" in different.message


def test_defect_has_priority_over_gloss_and_changes_only_thickness() -> None:
    s = _suggest(defects=("running",), gloss_comparison="more", transparency_comparison="less")
    assert s is not None and (s.trigger, s.variable) == ("defect", "thickness")
    assert s.change_pct == -10.0 and s.thickness_mm == 0.9


def test_gloss_priority_over_transparency_texture_color() -> None:
    s = _suggest(gloss_comparison="more", transparency_comparison="less", texture_comparison="more", color="lighter")
    assert s is not None and (s.trigger, s.hold_delta_min) == ("gloss", -10)


def test_transparency_direction_moves_thickness_both_ways() -> None:
    opaque = _suggest(transparency_comparison="much_less")
    clear = _suggest(transparency_comparison="more")
    assert opaque is not None and opaque.change_pct == -10.0
    assert clear is not None and clear.change_pct == 10.0


def test_rough_texture_extends_hold_but_smooth_is_not_a_reason() -> None:
    rough = _suggest(texture_comparison="more")
    smooth = _suggest(texture_comparison="less")
    assert rough is not None and (rough.trigger, rough.hold_delta_min) == ("texture", 10)
    assert smooth is not None and smooth.variable == "none"


def test_color_lighter_darker_and_different() -> None:
    assert _suggest(color="lighter").change_pct == 10.0  # type: ignore[union-attr]
    assert _suggest(color="darker").change_pct == -10.0  # type: ignore[union-attr]
    other = _suggest(color="different")
    assert other is not None and other.variable == "none" and other.trigger == "color"


def test_thickness_suggestion_is_clamped_to_safe_range() -> None:
    low = suggest_next_trial(_table(), overall="different", defects_reviewed=True, defects=("running",),
                             mean_thickness_mm=0.82, safe_thickness_mm=(0.8, 1.3))
    high = suggest_next_trial(_table(), overall="different", defects_reviewed=True, color="lighter",
                              mean_thickness_mm=1.28, safe_thickness_mm=(0.8, 1.3))
    assert low is not None and low.thickness_mm == 0.8
    assert high is not None and high.thickness_mm == 1.3


def test_base_thickness_prefers_the_recipes_next_trial_center() -> None:
    table = _table(next_trial_thickness_mm=(0.9, 1.1))
    s = suggest_next_trial(table, overall="different", defects_reviewed=True, color="lighter", mean_thickness_mm=1.25)
    assert s is not None and s.thickness_mm == 1.1  # 중심 1.0 → +10%


def test_without_any_thickness_basis_only_the_percentage_is_given() -> None:
    s = suggest_next_trial(_table(), overall="different", defects_reviewed=True, color="lighter")
    assert s is not None and s.change_pct == 10.0 and s.thickness_mm is None


def test_unknown_defect_labels_are_ignored_not_trusted() -> None:
    s = _suggest(defects=("???",), gloss_comparison="less")
    assert s is not None and s.trigger == "gloss"


def test_messages_are_one_short_line() -> None:
    assert _suggest(gloss_comparison="less").message == "광택 덜함 → 유지시간 +10분 (추정)"  # type: ignore[union-attr]
    assert _suggest(overall="close", gloss_comparison="more").message == "광택 강함 → 유지시간 −5분 (추정)"  # type: ignore[union-attr]
    assert _suggest(transparency_comparison="less").message == "너무 불투명 → 두께 −10% · 약 0.90mm (추정)"  # type: ignore[union-attr]
    assert _suggest(defects=("running",)).message == "흘러내림 → 두께 −10% · 약 0.90mm (추정)"  # type: ignore[union-attr]
    assert _suggest(color="different").message == "다른 색 → 조정 없음 (기록만 남김)"  # type: ignore[union-attr]
    assert _suggest(overall="close").message == "목표와 일치 → 현재 조건 유지"  # type: ignore[union-attr]
