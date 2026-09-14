"""kiln.firing.cooling — 자연냉각률 상한과 서냉 비용 (9-6절).

9-6절 표로 회귀를 건다 (30L 가마, C=58 kJ/K, 1220℃ 유지전력 2.5kW로 UA 역산):

    자연냉각률(제어 상한)  1220℃ 155 / 1000℃ 127 / 800℃ 101 / 600℃ 75  [℃/h]

    결정 성장 구간 1100→900℃ 서냉 비용
       126 ℃/h   1.6h   자연냉각, 추가전력 0
        80 ℃/h   2.5h   평균  751W    +1.9 kWh
        50 ℃/h   4.0h   평균 1234W    +4.9 kWh
        30 ℃/h   6.7h   평균 1556W   +10.4 kWh
"""

from __future__ import annotations

import pytest

from kiln.domain.models import KilnProfile
from kiln.firing.cooling import (
    QUARTZ_INVERSION_C,
    CoolingSegment,
    natural_cooling_hours,
    plan_cooling,
)

#: 9-6절 예제 가마. UA는 "1220℃ 유지전력 2.5kW"에서 선형 역산한 값 그대로다.
KILN_30L = KilnProfile(
    profile_id="30L",
    name="30L 전기가마 (9-6절 예제)",
    heat_capacity=58_000.0,
    ua=2500.0 / (1220.0 - 20.0),
    max_power=6000.0,
)


# ─── 9-6절 회귀: 자연냉각률 표 ──────────────────────────────────────────────


@pytest.mark.parametrize(
    ("temp_c", "expected_c_per_h"),
    [(1220.0, 155.0), (1000.0, 127.0), (800.0, 101.0), (600.0, 75.0)],
)
def test_9_6_natural_cooling_rate_table(temp_c, expected_c_per_h):
    """9-6절 자연냉각률 표를 UA·C에서 그대로 재현한다."""
    assert KILN_30L.natural_cooling_rate(temp_c) == pytest.approx(
        expected_c_per_h, abs=0.5
    )


def test_9_6_crystal_growth_window_natural_duration_is_1_6_hours():
    """1100→900℃ 자연냉각은 1.6시간, 평균 126℃/h (9-6절 첫 행)."""
    hours = natural_cooling_hours(KILN_30L, 1100.0, 900.0)
    assert hours == pytest.approx(1.6, abs=0.05)
    assert 200.0 / hours == pytest.approx(126.0, abs=1.0)


def test_natural_cooling_hours_rejects_a_non_cooling_range():
    with pytest.raises(ValueError):
        natural_cooling_hours(KILN_30L, 900.0, 1100.0)
    with pytest.raises(ValueError):
        natural_cooling_hours(KILN_30L, 900.0, 900.0)


def test_natural_cooling_hours_rejects_reaching_ambient():
    """주위 온도에서 자연냉각률이 0이 되므로 유한 시간에 도달하지 못한다."""
    with pytest.raises(ValueError):
        natural_cooling_hours(KILN_30L, 200.0, 20.0)


# ─── 9-6절 회귀: 서냉 비용 표 ───────────────────────────────────────────────


@pytest.mark.parametrize(
    ("rate", "hours", "avg_w", "kwh"),
    [
        (80.0, 2.5, 751.0, 1.9),
        (50.0, 4.0, 1234.0, 4.9),
        (30.0, 6.7, 1556.0, 10.4),
    ],
)
def test_9_6_slow_cooling_cost_table(rate, hours, avg_w, kwh):
    """9-6절 서냉 비용 표: 시간 · 평균 전력 · 추가 전력량."""
    seg = CoolingSegment(1100.0, 900.0, rate, "결정 성장")
    plan = plan_cooling(KILN_30L, [seg])
    assert plan.feasible is True
    assert seg.hours == pytest.approx(hours, abs=0.05)
    assert plan.extra_kwh == pytest.approx(kwh, abs=0.06)
    assert plan.extra_kwh * 1000.0 / seg.hours == pytest.approx(avg_w, abs=5.0)


def test_9_6_natural_rate_costs_nothing_extra():
    """126℃/h는 자연냉각이므로 추가 전력 0, 추가 시간 0 (9-6절 첫 행)."""
    plan = plan_cooling(KILN_30L, [CoolingSegment(1100.0, 900.0, 126.0, "자연냉각")])
    assert plan.feasible is True
    assert plan.extra_kwh == pytest.approx(0.0, abs=0.05)
    assert plan.extra_hours == pytest.approx(0.0, abs=0.05)


def test_slower_cooling_costs_strictly_more():
    """서냉을 고를수록 시간과 전력량이 함께 오른다 — 되돌림 비용의 단조성."""
    costs = [
        plan_cooling(KILN_30L, [CoolingSegment(1100.0, 900.0, r, "결정 성장")])
        for r in (100.0, 80.0, 50.0, 30.0)
    ]
    assert all(p.feasible for p in costs)
    hours = [p.extra_hours for p in costs]
    kwh = [p.extra_kwh for p in costs]
    assert hours == sorted(hours)
    assert kwh == sorted(kwh)


# ─── 자연냉각률 상한 초과는 거부한다 ────────────────────────────────────────


def test_faster_than_natural_cooling_is_rejected():
    """9-6절: 전기가마는 서냉만 제어 가능하다. 급냉은 제어 대상이 아니다."""
    plan = plan_cooling(KILN_30L, [CoolingSegment(1100.0, 900.0, 310.0, "급냉 시도")])
    assert plan.feasible is False
    assert len(plan.rejections) == 1
    assert "자연냉각률 상한" in plan.rejections[0]


def test_rate_just_above_the_natural_mean_is_rejected():
    """상한은 실제로 구간 평균 자연냉각률(≈126.3℃/h)에 붙어 있다."""
    ok = plan_cooling(KILN_30L, [CoolingSegment(1100.0, 900.0, 126.0, "자연")])
    over = plan_cooling(KILN_30L, [CoolingSegment(1100.0, 900.0, 130.0, "초과")])
    assert ok.feasible is True
    assert over.feasible is False


def test_rejection_does_not_charge_for_the_refused_segment():
    """거부된 세그먼트는 비용에 들어가지 않는다 — 실행되지 않을 계획이다."""
    plan = plan_cooling(KILN_30L, [CoolingSegment(1100.0, 900.0, 310.0, "급냉")])
    assert plan.extra_hours == 0.0
    assert plan.extra_kwh == 0.0


def test_cooling_beyond_the_kilns_maximum_power_is_rejected():
    """물리 상한 아래여도 이 가마의 출력으로 못 하면 거부한다."""
    weak = KilnProfile(
        profile_id="weak", name="출력이 모자란 가마",
        heat_capacity=58_000.0, ua=2500.0 / 1200.0, max_power=500.0,
    )
    plan = plan_cooling(weak, [CoolingSegment(1100.0, 900.0, 30.0, "결정 성장")])
    assert plan.feasible is False
    assert "최대" in plan.rejections[0]


# ─── 573℃ 석영 전이 (9-6절) ────────────────────────────────────────────────


def test_a_segment_crossing_573c_is_rejected():
    """9-6절: 석영 전이 구간은 결정 성장 구간과 목적이 달라 별도 세그먼트다."""
    plan = plan_cooling(KILN_30L, [CoolingSegment(700.0, 400.0, 50.0, "한 덩어리")])
    assert plan.feasible is False
    assert "573" in plan.rejections[0]
    assert "석영" in plan.rejections[0]


def test_splitting_at_573c_is_accepted():
    plan = plan_cooling(
        KILN_30L,
        [
            CoolingSegment(700.0, QUARTZ_INVERSION_C, 60.0, "전이 진입 전"),
            CoolingSegment(QUARTZ_INVERSION_C, 400.0, 40.0, "석영 전이 통과"),
        ],
    )
    assert plan.feasible is True
    assert plan.rejections == ()


def test_a_full_two_stage_cooling_plan_is_accepted():
    """결정 성장 구간 + 석영 전이 구간 — 9-6절이 요구한 2구간 구조."""
    plan = plan_cooling(
        KILN_30L,
        [
            CoolingSegment(1100.0, 900.0, 50.0, "결정 성장"),
            CoolingSegment(900.0, QUARTZ_INVERSION_C, 80.0, "통과 구간"),
            CoolingSegment(QUARTZ_INVERSION_C, 300.0, 40.0, "석영 전이"),
        ],
    )
    assert plan.feasible is True
    assert plan.extra_hours > 0
    assert plan.extra_kwh > 0
    assert plan.total_hours > plan.extra_hours


# ─── 도메인 가드 ────────────────────────────────────────────────────────────


def test_empty_plan_is_not_silently_accepted():
    """빈 계획을 '문제 없음'으로 통과시키면 냉각 미지정 회차가 조용히 승인된다."""
    plan = plan_cooling(KILN_30L, [])
    assert plan.feasible is False
    assert plan.rejections
    assert plan.extra_hours == 0.0


def test_a_rising_segment_is_rejected():
    plan = plan_cooling(KILN_30L, [CoolingSegment(900.0, 1100.0, 50.0, "역방향")])
    assert plan.feasible is False
    assert "냉각 구간이 아니다" in plan.rejections[0]


def test_a_zero_or_negative_rate_is_rejected():
    for rate in (0.0, -20.0):
        plan = plan_cooling(KILN_30L, [CoolingSegment(1100.0, 900.0, rate, "0율")])
        assert plan.feasible is False
        assert "양수" in plan.rejections[0]


def test_every_bad_segment_is_reported_not_just_the_first():
    plan = plan_cooling(
        KILN_30L,
        [
            CoolingSegment(1100.0, 900.0, 310.0, "급냉"),
            CoolingSegment(900.0, 1000.0, 50.0, "역방향"),
            CoolingSegment(700.0, 400.0, 40.0, "573 가로지름"),
        ],
    )
    assert plan.feasible is False
    assert len(plan.rejections) == 3


# ─── 출처 문구 (00절 공통 규칙 1) ──────────────────────────────────────────


def test_provenance_notes_carry_the_linear_approximation_caveat():
    plan = plan_cooling(KILN_30L, [CoolingSegment(1100.0, 900.0, 50.0, "결정 성장")])
    joined = " ".join(plan.provenance_notes)
    assert "과소평가" in joined
    assert "상대 비교" in joined


def test_provenance_notes_state_that_cooling_is_not_converted_to_heat_work():
    """9-4절·부록 E: 냉각을 H에 합산하지 않는다는 사실이 결과에 실려 나간다."""
    plan = plan_cooling(KILN_30L, [CoolingSegment(1100.0, 900.0, 50.0, "결정 성장")])
    joined = " ".join(plan.provenance_notes)
    assert "H로 환산하지 않는다" in joined


def test_cooling_module_does_not_import_heat_work():
    """구조로 못 박는다 — 냉각 모듈은 열일 모듈을 쓰지 않는다 (9-4절)."""
    import kiln.firing.cooling as cooling

    assert not hasattr(cooling, "heat_work")
    assert not hasattr(cooling, "equivalent_hold_seconds")
