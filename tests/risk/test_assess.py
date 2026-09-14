"""kiln.risk — 8-4절 되돌림 선택지와 판정 요약.

v5가 여기서 틀렸던 것을 회귀로 막는다: 재시유에 ``✓ 안전`` 확정 기호,
그리고 「판정 불가」가 요약에서 「없음」으로 접히는 것.
"""

from __future__ import annotations

from kiln.domain.enums import GlazingMethod, RiskLevel, RiskType
from kiln.risk import assess, reversal_options
from kiln.thickness.profile import ThicknessPoint, ThicknessProfile

SAFE = (0.8, 1.3)


def _profile(
    totals: list[tuple[float, float]],
    *,
    mean_mm: float,
    has_distribution: bool = True,
) -> ThicknessProfile:
    points = tuple(
        ThicknessPoint(z=z, radius=30.0, t_abs=t, t_flow=0.0) for z, t in totals
    )
    return ThicknessProfile(
        points=points,
        area_m2=0.060,
        mean_mm=mean_mm,
        glaze_weight_g=96.0,
        rho_dry=1.5,
        has_distribution=has_distribution,
        within_model_scope=True,
        provenance_notes=(),
    )


def _risky() -> ThicknessProfile:
    """8-4절 화면 예시 상태 — 굽에서 12mm 지점 1.72mm."""
    return _profile([(0.0, 1.00), (12.0, 1.72), (60.0, 1.05)], mean_mm=1.25)


def _clean() -> ThicknessProfile:
    return _profile([(0.0, 1.00), (30.0, 1.10), (60.0, 1.05)], mean_mm=1.05)


# ─── 8-4절 · 선택지 목록 ─────────────────────────────────────────────────────


def test_plan_table_options_are_all_present():
    """8-4절 표의 5개 선택지가 그 순서로 나온다."""
    assert [o.name for o in reversal_options()] == [
        "재시유",
        "부분 보정",
        "적재 조정",
        "스케줄 보정",
        "그대로 진행",
    ]


def test_no_option_carries_a_certainty_marker():
    """8-4절: **어떤 선택지에도 확정 기호를 붙이지 않는다** (v5가 재시유에 붙였다)."""
    for option in reversal_options():
        assert "✓" not in option.name
        assert "✓" not in option.effect
        assert "안전함" not in option.effect


def test_every_option_states_its_cost():
    """8-4절: 되돌림 비용을 **반드시** 병기한다. 빈 문자열로 두지 않는다."""
    for option in reversal_options():
        assert option.cost.strip()


def test_reglaze_downgrades_confidence():
    """7-5절: 재시유는 재습윤으로 흡수율이 변해 모델 적용 범위를 벗어난다."""
    reglaze = next(o for o in reversal_options() if o.name == "재시유")
    assert reglaze.confidence_downgrade is True
    assert "신뢰도 하향" in reglaze.effect

    # 나머지는 신뢰도를 내리지 않는다.
    others = [o for o in reversal_options() if o.name != "재시유"]
    assert all(o.confidence_downgrade is False for o in others)


def test_schedule_adjustment_is_marked_uncertain():
    """8-4절: 스케줄 보정에는 "효과 불확실"이 붙는다 (8-3절 미분기 때문)."""
    schedule = next(o for o in reversal_options() if o.name == "스케줄 보정")
    assert "효과 불확실" in schedule.effect


def test_partial_correction_dropped_without_distribution():
    """부위를 짚을 수 없으면 "국소 위험 완화"를 선택지로 내밀지 않는다 (8-2절 태도)."""
    names = [o.name for o in reversal_options(has_distribution=False)]
    assert "부분 보정" not in names
    assert "재시유" in names and "그대로 진행" in names


# ─── 08절 진입점 ─────────────────────────────────────────────────────────────


def test_assess_offers_options_when_risk_is_actionable():
    result = assess(_risky(), method=GlazingMethod.DIPPING, safe_range_mm=SAFE)
    assert result.worst is RiskLevel.HIGH
    assert [o.name for o in result.options] == [
        "재시유",
        "부분 보정",
        "적재 조정",
        "스케줄 보정",
        "그대로 진행",
    ]
    # 편차 1.00–1.72mm(0.72mm)는 안전창 폭 0.5mm의 허용 편차를 넘으므로
    # 응력 균열도 함께 오른다 — 8-3절대로 갈리지 않는 위험을 숨기지 않는다.
    assert [f.risk for f in result.actionable] == [RiskType.RUNNING, RiskType.CRAZING]


def test_assess_offers_nothing_when_all_clear():
    """고를 것이 없으면 빈 튜플. 판정이 다 섰고 전부 「없음」인 경우다."""
    result = assess(_clean(), method=GlazingMethod.DIPPING, safe_range_mm=SAFE)
    assert result.worst is RiskLevel.NONE
    assert result.options == ()
    assert result.unavailable == ()


def test_worst_does_not_collapse_unavailable_into_none():
    """8-2절 핵심 회귀: 흘러내림 「판정 불가」 + 나머지 「없음」이 「없음」으로 접히면
    거짓 안심이다. 요약은 「판정 불가」여야 한다."""
    profile = _profile([(0.0, 1.05), (60.0, 1.05)], mean_mm=1.05, has_distribution=False)
    result = assess(profile, method=GlazingMethod.SPRAYING, safe_range_mm=SAFE)

    assert result.worst is RiskLevel.UNAVAILABLE
    assert result.worst is not RiskLevel.NONE
    assert [f.risk for f in result.unavailable] == [RiskType.RUNNING, RiskType.CRAZING]


def test_worst_prefers_a_real_risk_over_unavailable():
    """판정된 위험이 있으면 그쪽이 요약이다 — 「판정 불가」는 「낮음」보다 낮다."""
    profile = _profile([(0.0, 1.70), (60.0, 1.70)], mean_mm=1.70, has_distribution=False)
    result = assess(profile, method=GlazingMethod.BRUSHING, safe_range_mm=SAFE)
    assert result.worst is RiskLevel.HIGH


def test_unavailable_still_gets_options():
    """판정해주지 못하면서 되돌릴 기회까지 닫으면 회색 처리의 의미가 없다."""
    profile = _profile([(0.0, 1.05), (60.0, 1.05)], mean_mm=1.05, has_distribution=False)
    result = assess(profile, method=GlazingMethod.POURING, safe_range_mm=SAFE)
    assert result.options
    assert "부분 보정" not in [o.name for o in result.options]


def test_findings_are_complete_regardless_of_method():
    """어떤 시유 방법이든 8-1절 5종이 모두 보고된다 — 빠지는 게 아니라 회색이 된다."""
    for method in GlazingMethod:
        profile = _profile(
            [(0.0, 1.05), (60.0, 1.05)],
            mean_mm=1.05,
            has_distribution=method.has_distribution_model,
        )
        result = assess(profile, method=method, safe_range_mm=SAFE)
        assert len(result.findings) == len(RiskType)
