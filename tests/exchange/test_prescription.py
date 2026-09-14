"""kiln.exchange — 10-3절 처방 발행·변환.

기획서에 수치가 적힌 것은 그 수치로 회귀를 건다: 10-3절 E 민감도 표
(1220℃ 15분과 같은 H를 내는 저온 유지시간, E=200/300/400 kJ/mol),
9-4절 급냉/서냉 H 동일 예시.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from kiln.domain.models import FiringRun, KilnProfile
from kiln.exchange import Prescription, equivalent_hold_at, issue, transform
from kiln.firing.cooling import CoolingSegment
from kiln.firing.heatwork import assume_E, heat_work

_NOW = datetime(2026, 9, 10, 9, 0, 0)

#: 9-6절 예제 가마. UA는 "1220℃ 유지전력 2.5kW에서 선형 역산".
_REFERENCE_UA = 2500.0 / 1200.0


def _kiln(
    *,
    name: str = "30L 전기가마",
    heat_capacity: float = 58_000.0,
    ua: float = _REFERENCE_UA,
    max_power: float = 6_000.0,
) -> KilnProfile:
    return KilnProfile(
        profile_id="p1",
        name=name,
        heat_capacity=heat_capacity,
        ua=ua,
        max_power=max_power,
    )


def _E(value: float = 300_000.0):
    return assume_E(value, "10-3절 민감도 검토용 가정")


def _run(curve, *, measured=True) -> FiringRun:
    points = tuple(curve)
    return FiringRun(
        run_id="r1",
        kiln_profile_id="p1",
        started_at=_NOW,
        schedule=() if measured else points,
        measured=points if measured else (),
    )


def _ramp_hold_cool(peak_c: float = 1220.0, hold_s: float = 900.0):
    """승온 12시간 → 최고온 유지 → 냉각. 냉각까지 포함한 전체 실측 곡선."""
    ramp_s = 12 * 3600.0
    return [
        (0.0, 20.0),
        (ramp_s, peak_c),
        (ramp_s + hold_s, peak_c),
        (ramp_s + hold_s + 3600.0, 900.0),
        (ramp_s + hold_s + 7200.0, 500.0),
    ]


# ─── 10-3절 E 민감도 표 ──────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("E_kj", "to_c", "expected_min"),
    [
        (200, 1200.0, 18.7),
        (200, 1180.0, 23.4),
        (200, 1150.0, 33.1),
        (300, 1200.0, 20.8),
        (300, 1180.0, 29.2),
        (300, 1150.0, 49.2),
        (400, 1200.0, 23.2),
        (400, 1180.0, 36.4),
        (400, 1150.0, 73.2),
    ],
)
def test_plan_e_sensitivity_table(E_kj, to_c, expected_min):
    """10-3절 표: 1220℃ 15분 유지와 같은 H를 내는 저온 유지시간.

    9개 칸을 소수 첫째 자리까지 그대로 재현한다.
    """
    seconds = equivalent_hold_at(
        15 * 60.0, from_c=1220.0, to_c=to_c, E=E_kj * 1000.0
    )
    assert seconds / 60.0 == pytest.approx(expected_min, abs=0.05)


def test_e_uncertainty_grows_with_temperature_gap():
    """10-3절: "온도차가 작으면 E를 몰라도 되고, 벌어질수록 오차가 그대로 나온다"."""

    def spread(to_c: float) -> float:
        lo = equivalent_hold_at(900.0, from_c=1220.0, to_c=to_c, E=200_000.0)
        hi = equivalent_hold_at(900.0, from_c=1220.0, to_c=to_c, E=400_000.0)
        return hi / lo

    assert spread(1200.0) < spread(1180.0) < spread(1150.0)
    # 20℃ 차이에서는 E를 2배 틀려도 24% 차, 70℃ 차이에서는 2.2배 차다.
    assert spread(1200.0) == pytest.approx(1.24, abs=0.02)
    assert spread(1150.0) == pytest.approx(2.21, abs=0.02)


def test_same_temperature_is_identity():
    assert equivalent_hold_at(900.0, from_c=1220.0, to_c=1220.0, E=300_000.0) == (
        pytest.approx(900.0, rel=1e-12)
    )


def test_lower_temperature_always_needs_longer_hold():
    for E in (200_000.0, 300_000.0, 400_000.0):
        assert equivalent_hold_at(900.0, from_c=1220.0, to_c=1150.0, E=E) > 900.0


@pytest.mark.parametrize(
    ("kwargs", "exc"),
    [
        ({"E": 0.0}, ValueError),
        ({"E": -1.0}, ValueError),
        ({"to_c": -300.0}, ValueError),
    ],
)
def test_equivalent_hold_domain_guards(kwargs, exc):
    base = {"from_c": 1220.0, "to_c": 1150.0, "E": 300_000.0}
    base.update(kwargs)
    with pytest.raises(exc):
        equivalent_hold_at(900.0, **base)


def test_negative_hold_is_rejected():
    with pytest.raises(ValueError):
        equivalent_hold_at(-1.0, from_c=1220.0, to_c=1150.0, E=300_000.0)


# ─── 발행 (10-3절) ───────────────────────────────────────────────────────────


def test_issue_excludes_cooling_from_heat_work():
    """9-4·10-3절: 냉각은 H에 합산하지 않는다. 자르는 지점은 최고온을 떠나는 순간."""
    E = _E()
    run = _run(_ramp_hold_cool())
    p = issue(run, E=E.value, peak_c=1220.0, cooling=[])

    ramp_and_hold = _ramp_hold_cool()[:3]
    assert p.heat_work_target == pytest.approx(
        heat_work(ramp_and_hold, E.value), rel=1e-12
    )
    # 냉각까지 넣은 H보다 작아야 한다 — 잘렸다는 뜻이다.
    assert p.heat_work_target < heat_work(_ramp_hold_cool(), E.value)


def test_fast_and_slow_cooling_are_not_distinguished_by_heat_work():
    """9-4절이 냉각을 분리한 이유. 급냉과 서냉이 H로는 구분되지 않는다.

    같은 승온·유지를 공유하고 냉각만 다른 두 회차는 **같은 처방 H**를 낸다 —
    그래서 냉각은 H가 아니라 온도–시간 곡선으로 따로 실어야 한다.
    """
    E = _E()
    ramp_s, hold_s = 12 * 3600.0, 900.0
    head = [(0.0, 20.0), (ramp_s, 1220.0), (ramp_s + hold_s, 1220.0)]
    fast = _run(head + [(ramp_s + hold_s + 1800.0, 500.0)])
    slow = _run(head + [(ramp_s + hold_s + 18000.0, 500.0)])

    h_fast = issue(fast, E=E.value, peak_c=1220.0, cooling=[]).heat_work_target
    h_slow = issue(slow, E=E.value, peak_c=1220.0, cooling=[]).heat_work_target
    assert h_fast == pytest.approx(h_slow, rel=1e-12)


def test_issue_carries_the_cooling_curve_verbatim():
    segments = (
        CoolingSegment(1100.0, 900.0, 50.0, "결정 성장"),
        CoolingSegment(700.0, 573.0, 40.0, "석영 전이 진입 전"),
        CoolingSegment(573.0, 400.0, 30.0, "석영 전이 통과"),
    )
    p = issue(_run(_ramp_hold_cool()), E=_E().value, peak_c=1220.0, cooling=segments)
    assert p.cooling == segments


def test_issue_records_the_assumed_E():
    """부록 C: E는 미정이다. 어떤 가정 위에서 계산했는지가 처방의 일부다."""
    p = issue(_run(_ramp_hold_cool()), E=300_000.0, peak_c=1220.0, cooling=[])
    assert p.E_assumed == 300_000.0
    assert any("E=3e+05" in n or "E=300000" in n for n in p.provenance_notes)
    assert any("냉각은 H에 합산하지 않았다" in n for n in p.provenance_notes)


def test_issue_prefers_measured_over_schedule():
    """10-3절 대비축은 **설정 스케줄이 아니라 달성 열이력**이다."""
    measured = issue(
        _run(_ramp_hold_cool(), measured=True), E=300_000.0, peak_c=1220.0, cooling=[]
    )
    assert any("달성 열이력" in n for n in measured.provenance_notes)


def test_issue_downgrades_when_only_the_schedule_exists():
    scheduled = issue(
        _run(_ramp_hold_cool(), measured=False), E=300_000.0, peak_c=1220.0, cooling=[]
    )
    assert any("신뢰도를 하향" in n for n in scheduled.provenance_notes)


def test_issue_flags_a_peak_that_was_never_reached():
    """선언된 최고온에 닿지 않은 회차를 조용히 통과시키지 않는다."""
    p = issue(_run(_ramp_hold_cool(peak_c=1180.0)), E=300_000.0, peak_c=1220.0, cooling=[])
    assert any("도달한 적이 없다" in n for n in p.provenance_notes)


def test_issue_rejects_non_positive_E():
    with pytest.raises(ValueError):
        issue(_run(_ramp_hold_cool()), E=0.0, peak_c=1220.0, cooling=[])


def test_issue_reports_an_empty_curve_instead_of_inventing_one():
    p = issue(_run([]), E=300_000.0, peak_c=1220.0, cooling=[])
    assert p.heat_work_target == 0.0
    assert any("비어 있다" in n for n in p.provenance_notes)


# ─── 변환 — 비대칭 (10-3절) ──────────────────────────────────────────────────


def _prescription(**kw) -> Prescription:
    base = dict(
        heat_work_target=heat_work(
            [(0.0, 20.0), (12 * 3600.0, 1220.0), (12 * 3600.0 + 900.0, 1220.0)],
            300_000.0,
        ),
        peak_c=1220.0,
        cooling=(
            # 9-6절: 573℃ 석영 전이는 결정 성장 구간과 목적이 다르므로
            # 반드시 별도 세그먼트다. 가로지르면 plan_cooling이 거부한다.
            CoolingSegment(1100.0, 900.0, 50.0, "결정 성장"),
            CoolingSegment(700.0, 573.0, 40.0, "석영 전이 진입 전"),
            CoolingSegment(573.0, 400.0, 30.0, "석영 전이 통과"),
        ),
        E_assumed=300_000.0,
        provenance_notes=(),
    )
    base.update(kw)
    return Prescription(**base)


def test_transform_to_the_same_kiln_reproduces_the_heat_work():
    """같은 가마로 옮기면 스케줄이 나오고, 그 스케줄의 H가 목표와 일치한다."""
    p = _prescription()
    result = transform(p, _kiln())

    assert result.feasible is True
    assert result.schedule is not None

    # 냉각을 뺀 승온·유지 부분만 다시 적분하면 목표 H로 돌아온다.
    ramp_and_hold = result.schedule[:3]
    assert heat_work(ramp_and_hold, p.E_assumed) == pytest.approx(
        p.heat_work_target, rel=1e-6
    )


def test_transform_is_asymmetric_when_the_target_cools_more_slowly():
    """10-3절 마지막 행: 대상 가마의 자연냉각률이 느리면 **재현 불가**다.

    서냉은 이식 가능하고 급냉은 아닐 수 있다 — 전기가마는 서냉만 제어
    가능하므로(9-6절) 요청 냉각률이 그 가마의 자연냉각률을 넘으면 방법이 없다.
    """
    p = _prescription()
    # 열용량이 크고 단열이 좋은 가마 = 천천히 식는다.
    sluggish = _kiln(name="대형 가마", heat_capacity=400_000.0, ua=1.0, max_power=12_000.0)

    result = transform(p, sluggish)
    assert result.feasible is False
    assert result.schedule is None
    assert any("비대칭" in r for r in result.reasons)


def test_transform_rejects_a_kiln_that_cannot_reach_the_peak():
    """최대 출력이 최고온의 벽체 손실을 못 이기면 도달 자체가 불가능하다."""
    weak = _kiln(name="소형 가마", max_power=1_500.0)
    result = transform(_prescription(), weak)

    assert result.feasible is False
    assert any("도달하지 못한다" in r for r in result.reasons)


def test_infeasible_transform_never_returns_a_partial_schedule():
    """부분적으로 되는 스케줄을 내지 않는다 — 그건 다른 처방이다."""
    for target in (
        _kiln(name="약한 가마", max_power=1_500.0),
        _kiln(name="느린 가마", heat_capacity=400_000.0, ua=1.0, max_power=12_000.0),
    ):
        result = transform(_prescription(), target)
        assert result.feasible is False
        assert result.schedule is None
        assert result.reasons


def test_transform_schedule_is_monotone_in_time():
    result = transform(_prescription(), _kiln())
    times = [t for t, _ in result.schedule]
    assert all(a < b for a, b in zip(times, times[1:]))


def test_transform_appends_cooling_as_temperature_time_not_heat_work():
    """9-4·10-3절: 냉각은 온도–시간 그대로 이어 붙인다."""
    p = _prescription()
    result = transform(p, _kiln())
    tail = [temp for _, temp in result.schedule[3:]]
    assert tail == [s.to_c for s in p.cooling]


def test_transform_always_states_the_assumed_E():
    """E 가정이 변환 결과까지 따라간다 (00절)."""
    result = transform(_prescription(), _kiln())
    assert any("E=" in r for r in result.reasons)


def test_transform_states_that_the_ramp_is_a_physical_ceiling():
    """근거 없는 기본 승온율을 두지 않았다는 사실이 결과에 실린다."""
    result = transform(_prescription(), _kiln())
    assert any("물리 상한" in r for r in result.reasons)


def test_hold_absorbs_a_slower_ramp():
    """9-5절: H의 90%가 마지막 구간에 쌓이므로 승온율 차이는 유지시간이 흡수한다.

    승온이 느린 가마일수록 승온 중 H가 더 쌓여 유지시간이 짧아진다 —
    합쳐진 H는 같다.
    """
    p = _prescription()
    fast = transform(p, _kiln(max_power=12_000.0))
    slow = transform(p, _kiln(max_power=6_000.0))

    fast_hold = fast.schedule[2][0] - fast.schedule[1][0]
    slow_hold = slow.schedule[2][0] - slow.schedule[1][0]
    assert slow_hold < fast_hold

    for result in (fast, slow):
        assert heat_work(result.schedule[:3], p.E_assumed) == pytest.approx(
            p.heat_work_target, rel=1e-6
        )


def test_a_kiln_too_slow_to_ramp_cannot_reproduce_the_prescription():
    """비대칭의 다른 쪽 얼굴 — **승온이 느려서** 재현하지 못하는 경우.

    9-6절 기준 가마(30L·3kW)는 1220℃ 부근에서 최대 승온율이 31℃/h다.
    100℃/h로 승온한 회차의 처방을 이 가마에 옮기면, **가장 빠른 승온을
    써도** 승온 도중에 목표 H를 넘어선다 — 더 느리게 가면 H는 더 쌓이므로
    어떤 승온율로도 재현할 수 없다. 냉각이 아니라 승온 쪽에서 변환이
    막히는 경우이고, 결과는 같다: 부분 스케줄을 내지 않는다.
    """
    result = transform(_prescription(), _kiln(name="30L 3kW", max_power=3_000.0))

    assert result.feasible is False
    assert result.schedule is None
    assert any("승온만으로 목표 열일을 넘는다" in r for r in result.reasons)
