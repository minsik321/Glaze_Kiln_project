"""kiln.risk.findings — 8-1 ~ 8-3절 위험 판정.

기획서에 수치가 적힌 것은 그 수치로 회귀를 건다: 8-4절 화면 예시
(안전 범위 0.8–1.3mm, 굽에서 12mm 지점 1.72mm → 흘러내림 「높음」).
"""

from __future__ import annotations

import pytest

from kiln.domain.enums import (
    FailureType,
    GlazingMethod,
    RiskLevel,
    RiskType,
)
from kiln.domain.models import GlazeRecipe
from kiln.risk.findings import DEFAULT_SAFE_RANGE_MM, evaluate_findings
from kiln.thickness.profile import ThicknessPoint, ThicknessProfile

# 8-4절 화면 예시의 안전 범위
SAFE = (0.8, 1.3)


def _profile(
    totals: list[tuple[float, float]],
    *,
    mean_mm: float,
    has_distribution: bool = True,
) -> ThicknessProfile:
    """(z, 총두께) 목록으로 ThicknessProfile을 만든다.

    07절 총량 제약을 다시 계산하지 않고 두께 값을 직접 주입한다 — 여기서
    검증하려는 것은 08절 판정 로직이지 07절 산출이 아니다.
    """
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


def _by_risk(findings, risk: RiskType):
    return next(f for f in findings if f.risk is risk)


# ─── 8-4절 화면 예시 회귀 ────────────────────────────────────────────────────


def test_plan_example_running_is_high():
    """8-4절 화면: 안전 범위 0.8–1.3mm에서 국소 최대 1.72mm → 흘러내림 「높음」.

    등급 경계(초과비 0.25 / 0.5)는 이 예시 하나에 맞춰 잡은 값이다.
    (1.72 − 1.3) / (1.3 − 0.8) = 0.84 > 0.5 이므로 HIGH.
    """
    profile = _profile([(0.0, 1.00), (12.0, 1.72), (60.0, 1.05)], mean_mm=1.25)
    running = _by_risk(
        evaluate_findings(profile, method=GlazingMethod.DIPPING, safe_range_mm=SAFE),
        RiskType.RUNNING,
    )
    assert running.level is RiskLevel.HIGH
    assert running.available is True


def test_plan_example_detail_names_the_location():
    """8-4절 화면 문구: "굽에서 12mm 지점 두께 1.72mm"."""
    profile = _profile([(0.0, 1.00), (12.0, 1.72), (60.0, 1.05)], mean_mm=1.25)
    running = _by_risk(
        evaluate_findings(profile, method=GlazingMethod.DIPPING, safe_range_mm=SAFE),
        RiskType.RUNNING,
    )
    assert running.detail == "굽에서 12mm 지점 두께 1.72mm"


def test_annotation_carries_literature_provenance():
    """6-4·8-4절: 안전 범위 수치에는 출처를 병기한다."""
    profile = _profile([(0.0, 1.0), (12.0, 1.72)], mean_mm=1.25)
    findings = evaluate_findings(
        profile, method=GlazingMethod.DIPPING, safe_range_mm=DEFAULT_SAFE_RANGE_MM
    )
    for f in findings:
        assert "0.8–1.3mm" in f.annotation
        assert "문헌 추정 초기값 · 캘리브레이션 전" in f.annotation


def test_narrowed_range_is_still_marked_dashed():
    """10-2절: 안전 두께 범위는 좁혀져도 **점선**이다. 실선은 k1·ρ_dry뿐이다."""
    profile = _profile([(0.0, 1.0), (12.0, 1.1)], mean_mm=1.05)
    findings = evaluate_findings(
        profile, method=GlazingMethod.DIPPING, safe_range_mm=(0.9, 1.2)
    )
    assert "점선" in findings[0].annotation


# ─── 8-2절 · 시유 방법별 가용 판정 ───────────────────────────────────────────


@pytest.mark.parametrize(
    "method", [GlazingMethod.POURING, GlazingMethod.SPRAYING, GlazingMethod.BRUSHING]
)
def test_non_dipping_cannot_judge_distribution_risks(method):
    """8-2절: 담금이 아니면 흘러내림·응력 균열은 「판정 불가」다."""
    profile = _profile([(0.0, 1.05), (60.0, 1.05)], mean_mm=1.05, has_distribution=False)
    findings = evaluate_findings(profile, method=method, safe_range_mm=SAFE)

    for risk in (RiskType.RUNNING, RiskType.CRAZING):
        f = _by_risk(findings, risk)
        assert f.available is False
        assert f.level is RiskLevel.UNAVAILABLE
        # 「없음」으로 내리면 거짓 안심이 된다.
        assert f.level is not RiskLevel.NONE
        assert "위험이 없다는 뜻이 아니다" in f.detail


@pytest.mark.parametrize(
    "method", [GlazingMethod.POURING, GlazingMethod.SPRAYING, GlazingMethod.BRUSHING]
)
def test_non_dipping_still_judges_mean_based_risks(method):
    """8-2절 표: 부기·분무·붓칠도 미용융·기포·결정 과다는 평균 기반으로 판정한다."""
    profile = _profile([(0.0, 1.05), (60.0, 1.05)], mean_mm=1.05, has_distribution=False)
    findings = evaluate_findings(profile, method=method, safe_range_mm=SAFE)

    for risk in (RiskType.UNDERFIRED, RiskType.BLISTER, RiskType.EXCESS_CRYSTAL):
        assert _by_risk(findings, risk).available is True


def test_degenerate_dipping_profile_is_also_unavailable():
    """담금이어도 분포가 퇴화했으면(7-5절) 분포 기반 판정은 서지 않는다."""
    profile = _profile([(0.0, 1.05), (60.0, 1.05)], mean_mm=1.05, has_distribution=False)
    findings = evaluate_findings(
        profile, method=GlazingMethod.DIPPING, safe_range_mm=SAFE
    )
    assert _by_risk(findings, RiskType.RUNNING).level is RiskLevel.UNAVAILABLE


# ─── 8-1절 · 나머지 위험 유형 ────────────────────────────────────────────────


def test_findings_follow_plan_table_order():
    """반환 순서는 8-1절 표 순서다."""
    profile = _profile([(0.0, 1.0), (12.0, 1.2)], mean_mm=1.1)
    findings = evaluate_findings(
        profile, method=GlazingMethod.DIPPING, safe_range_mm=SAFE
    )
    assert [f.risk for f in findings] == [
        RiskType.RUNNING,
        RiskType.UNDERFIRED,
        RiskType.BLISTER,
        RiskType.CRAZING,
        RiskType.EXCESS_CRYSTAL,
    ]


def test_thin_glaze_raises_underfired():
    """8-1절: 최소 두께 미달 → 미용융. 하한 0.8에서 0.55면 초과비 0.5 → 보통."""
    profile = _profile([(0.0, 0.55), (60.0, 0.90)], mean_mm=0.72)
    findings = evaluate_findings(
        profile, method=GlazingMethod.DIPPING, safe_range_mm=SAFE
    )
    assert _by_risk(findings, RiskType.UNDERFIRED).level is RiskLevel.MEDIUM
    # 얇은 쪽에서는 흘러내림이 오르지 않는다.
    assert _by_risk(findings, RiskType.RUNNING).level is RiskLevel.NONE


def test_within_range_is_none_everywhere():
    """안전창 안이고 편차도 작으면 5종 모두 「없음」."""
    profile = _profile([(0.0, 1.00), (30.0, 1.10), (60.0, 1.05)], mean_mm=1.05)
    findings = evaluate_findings(
        profile, method=GlazingMethod.DIPPING, safe_range_mm=SAFE
    )
    assert all(f.level is RiskLevel.NONE for f in findings)


def test_crazing_tracks_spread_not_absolute_thickness():
    """8-1절: 응력 균열의 근거는 편차다. 평균이 안전창 안이어도 편차가 크면 오른다."""
    # 안전창 폭 0.5, 허용 편차 0.25. 편차 0.55 → (0.55−0.25)/0.5 = 0.6 → 높음
    wide = _profile([(0.0, 1.30), (60.0, 0.75)], mean_mm=1.05)
    assert (
        _by_risk(
            evaluate_findings(
                wide, method=GlazingMethod.DIPPING, safe_range_mm=SAFE
            ),
            RiskType.CRAZING,
        ).level
        is RiskLevel.HIGH
    )

    # 같은 평균, 편차 0.10 → 허용 편차 이하 → 없음
    narrow = _profile([(0.0, 1.10), (60.0, 1.00)], mean_mm=1.05)
    assert (
        _by_risk(
            evaluate_findings(
                narrow, method=GlazingMethod.DIPPING, safe_range_mm=SAFE
            ),
            RiskType.CRAZING,
        ).level
        is RiskLevel.NONE
    )


def test_excess_crystal_says_cooling_is_not_decided_yet():
    """8-1절 판정 근거는 "두께 과다 + 서냉 과다"인데 냉각 스케줄은 09절 소관이다."""
    profile = _profile([(0.0, 1.60), (60.0, 1.60)], mean_mm=1.60)
    crystal = _by_risk(
        evaluate_findings(profile, method=GlazingMethod.DIPPING, safe_range_mm=SAFE),
        RiskType.EXCESS_CRYSTAL,
    )
    assert crystal.level.is_actionable
    assert "서냉" in crystal.detail and "09절" in crystal.detail


# ─── 8-3절 · 두께만으로 갈리지 않는 분기 ─────────────────────────────────────


def test_thick_shows_both_blister_and_running():
    """8-3절: 두꺼우면 기포 위험과 흘러내림 위험을 **둘 다** 표시한다."""
    profile = _profile([(0.0, 1.70), (60.0, 1.60)], mean_mm=1.65)
    findings = evaluate_findings(
        profile, method=GlazingMethod.DIPPING, safe_range_mm=SAFE
    )
    assert _by_risk(findings, RiskType.RUNNING).level.is_actionable
    assert _by_risk(findings, RiskType.BLISTER).level.is_actionable


def test_failure_hint_raises_only_the_hinted_risk():
    """8-3절: 유약 유형이 지정되면 그쪽을 상향한다. 반대쪽을 내리지는 않는다."""
    profile = _profile([(0.0, 1.45), (60.0, 1.42)], mean_mm=1.43)
    plain = evaluate_findings(
        profile, method=GlazingMethod.DIPPING, safe_range_mm=SAFE
    )
    hinted = evaluate_findings(
        profile,
        method=GlazingMethod.DIPPING,
        safe_range_mm=SAFE,
        recipe=GlazeRecipe(
            recipe_id="r1",
            name="기포형 유약",
            materials={"규석": 30.0, "장석": 50.0, "카올린": 20.0},
            failure_mode_hint=FailureType.BLISTER,
        ),
    )

    before = _by_risk(plain, RiskType.BLISTER).level
    after = _by_risk(hinted, RiskType.BLISTER).level
    assert after.level == before.level + 1
    assert "8-3절" in _by_risk(hinted, RiskType.BLISTER).detail

    # 반대쪽(흘러내림)은 그대로 남는다 — 지우지 않는다.
    assert _by_risk(hinted, RiskType.RUNNING).level is _by_risk(
        plain, RiskType.RUNNING
    ).level


def test_hint_does_not_invent_risk_where_there_is_none():
    """「없음」인 위험을 유형 지정만으로 올리지 않는다."""
    profile = _profile([(0.0, 1.05), (60.0, 1.00)], mean_mm=1.02)
    findings = evaluate_findings(
        profile,
        method=GlazingMethod.DIPPING,
        safe_range_mm=SAFE,
        recipe=GlazeRecipe(
            recipe_id="r1",
            name="흘러내림형 유약",
            materials={"규석": 30.0, "장석": 50.0, "카올린": 20.0},
            failure_mode_hint=FailureType.RUNNING,
        ),
    )
    assert _by_risk(findings, RiskType.RUNNING).level is RiskLevel.NONE


def test_hint_does_not_touch_unavailable_findings():
    """8-2절 「판정 불가」는 유형 지정으로도 등급이 되지 않는다."""
    profile = _profile([(0.0, 1.60), (60.0, 1.60)], mean_mm=1.60, has_distribution=False)
    findings = evaluate_findings(
        profile,
        method=GlazingMethod.SPRAYING,
        safe_range_mm=SAFE,
        recipe=GlazeRecipe(
            recipe_id="r1",
            name="흘러내림형 유약",
            materials={"규석": 30.0, "장석": 50.0, "카올린": 20.0},
            failure_mode_hint=FailureType.RUNNING,
        ),
    )
    assert _by_risk(findings, RiskType.RUNNING).level is RiskLevel.UNAVAILABLE


# ─── 도메인 가드 ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("bad", [(1.3, 0.8), (0.0, 1.3), (-0.5, 1.0), (1.0, 1.0)])
def test_invalid_safe_range_raises(bad):
    profile = _profile([(0.0, 1.0)], mean_mm=1.0)
    with pytest.raises(ValueError):
        evaluate_findings(profile, method=GlazingMethod.DIPPING, safe_range_mm=bad)


def test_bands_scale_with_range_width():
    """등급 경계는 절대 mm가 아니라 안전창 폭에 비례한다 (10-2절 대비).

    창이 좁아지면 같은 초과량이 더 높은 등급으로 올라와야 한다 — 그러지
    않으면 유약별 안전창을 좁히는 일이 판정에 반영되지 않는다.
    """
    profile = _profile([(0.0, 1.40), (60.0, 1.35)], mean_mm=1.38)
    wide = _by_risk(
        evaluate_findings(profile, method=GlazingMethod.DIPPING, safe_range_mm=(0.8, 1.3)),
        RiskType.RUNNING,
    ).level
    narrow = _by_risk(
        evaluate_findings(profile, method=GlazingMethod.DIPPING, safe_range_mm=(1.2, 1.3)),
        RiskType.RUNNING,
    ).level
    assert narrow.level > wide.level
