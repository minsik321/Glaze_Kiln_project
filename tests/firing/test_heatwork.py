"""kiln.firing.heatwork — 센서 기준 열일 H_s와 등가 유지시간 Δt_eq (9-3·9-5절).

기획서에 수치가 적힌 것은 그 수치로 회귀를 건다:

- 9-5절 H 누적 비율 표 (6h 0.00% / 8h 0.01% / 10h 1.26% / 11h 10.75%)
- 9-5절 "H의 90%가 마지막 1.29시간에 누적"
- 9-5절 3시간 시점 H_목표가 상대오차 분모로 쓸 수 없을 만큼 작다
- 부록 E 급냉/서냉 H 동일 예시 (310℃/h+49분 = 77.5℃/h+15분)
"""

from __future__ import annotations

import math

import pytest

from kiln import constants
from kiln.firing.heatwork import (
    R_GAS,
    assume_E,
    equivalent_hold_seconds,
    heat_work,
    heat_work_curve,
)

#: 9-5절 누적 비율 표(0.00 / 0.01 / 1.26 / 10.75%)를 정확히 재현하는 값이다.
#: 부록 C가 E의 값을 금지하므로 **테스트가 세우는 가정**이지 주장이 아니다.
#: 이 값을 고른 근거가 곧 아래 test_9_5_heat_work_accumulation_table 이다.
E_ASSUMED = 300_000.0


def _ramp_curve(
    *,
    start_c: float = 20.0,
    rate_c_per_h: float = 100.0,
    peak_c: float = 1220.0,
    hold_h: float = 0.25,
    sample_s: float = 30.0,
) -> tuple[tuple[float, float], ...]:
    """9-5절 예제 소성 곡선: 20℃에서 100℃/h로 1220℃까지, 15분 유지 (총 12.25h)."""
    ramp_s = (peak_c - start_c) / rate_c_per_h * 3600.0
    pts: list[tuple[float, float]] = []
    t = 0.0
    while t < ramp_s:
        pts.append((t, start_c + rate_c_per_h * t / 3600.0))
        t += sample_s
    pts.append((ramp_s, peak_c))
    pts.append((ramp_s + hold_h * 3600.0, peak_c))
    return tuple(pts)


def _rate(temp_c: float, E: float = E_ASSUMED) -> float:
    return math.exp(-E / (R_GAS * (temp_c + 273.15)))


# ─── 부록 C: E는 미정이며 가정을 거쳐야만 쓸 수 있다 ────────────────────────


def test_E_stays_undetermined_in_the_registry():
    """부록 C: E는 '값 기재 금지'다. 대장을 건드리지 않았음을 지킨다."""
    coeff = constants.get("E")
    assert coeff.is_determined is False
    with pytest.raises(constants.UndeterminedCoefficientError):
        _ = coeff.value


def test_assume_E_carries_the_assumption_in_its_note():
    """가정값은 '가정이었다는 사실'을 문구로 함께 나른다 (00절 공통 규칙 1)."""
    assumed = assume_E(E_ASSUMED, "9-5절 회귀 테스트")
    assert assumed.value == E_ASSUMED
    assert "미정" in assumed.note
    assert "9-5절 회귀 테스트" in assumed.note
    # 대장 자체는 그대로 미정이어야 한다 — assume은 사본을 만든다.
    assert constants.get("E").is_determined is False


def test_assume_E_flags_values_outside_the_appendix_c_range():
    """부록 C 추정 범위(200~400 kJ/mol) 밖이면 문구에 그 사실이 붙는다."""
    assert "범위" in assume_E(50_000.0, "민감도 스윕 하한").note
    assert "범위" in assume_E(900_000.0, "민감도 스윕 상한").note


def test_assume_E_rejects_nonpositive():
    with pytest.raises(ValueError):
        assume_E(0.0, "0은 값이 아니다")


# ─── heat_work — 정의와 도메인 가드 ─────────────────────────────────────────


def test_isothermal_heat_work_matches_closed_form():
    """등온 구간의 H는 exp(−E/RT)·(지속시간) 그대로다."""
    seconds = 900.0
    got = heat_work(((0.0, 1220.0), (seconds, 1220.0)), E_ASSUMED)
    assert got == pytest.approx(_rate(1220.0) * seconds, rel=1e-12)


def test_heat_work_is_additive_over_a_split_curve():
    curve = _ramp_curve()
    mid = len(curve) // 2
    whole = heat_work(curve, E_ASSUMED)
    parts = heat_work(curve[: mid + 1], E_ASSUMED) + heat_work(curve[mid:], E_ASSUMED)
    assert whole == pytest.approx(parts, rel=1e-12)


def test_coarse_sampling_agrees_with_fine_sampling():
    """지수의 볼록성 때문에 성긴 사다리꼴은 크게 틀린다 — 자동 세분이 이를 막는다."""
    coarse = heat_work(_ramp_curve(sample_s=1800.0), E_ASSUMED)
    fine = heat_work(_ramp_curve(sample_s=5.0), E_ASSUMED)
    assert coarse == pytest.approx(fine, rel=1e-4)


def test_empty_and_single_point_curves_give_zero():
    """빈 곡선·1점 곡선은 적분할 구간이 없다."""
    assert heat_work((), E_ASSUMED) == 0.0
    assert heat_work(((0.0, 1220.0),), E_ASSUMED) == 0.0
    assert heat_work_curve((), E_ASSUMED) == ()


def test_time_going_backwards_raises():
    with pytest.raises(ValueError):
        heat_work(((0.0, 500.0), (100.0, 600.0), (50.0, 700.0)), E_ASSUMED)


def test_temperature_below_absolute_zero_raises():
    with pytest.raises(ValueError):
        heat_work(((0.0, -300.0), (10.0, 500.0)), E_ASSUMED)


def test_nonpositive_activation_energy_raises():
    with pytest.raises(ValueError):
        heat_work(((0.0, 1220.0), (10.0, 1220.0)), 0.0)


def test_heat_work_curve_last_point_equals_heat_work():
    curve = _ramp_curve()
    assert heat_work_curve(curve, E_ASSUMED)[-1][1] == pytest.approx(
        heat_work(curve, E_ASSUMED), rel=1e-12
    )


# ─── 9-5절 회귀: H 누적 비율 표 ─────────────────────────────────────────────


def test_9_5_heat_work_accumulation_table():
    """9-5절 표 그대로: 6h 0.00% · 8h 0.01% · 10h 1.26% · 11h 10.75%.

    ``100℃/h · 1220℃ · 유지 15분 (총 12.25h)`` — 20℃에서 출발해야 12.25h가
    맞는다. 이 네 숫자가 E=300 kJ/mol을 지목한다.
    """
    curve = _ramp_curve(sample_s=10.0)
    cumulative = heat_work_curve(curve, E_ASSUMED)
    total = cumulative[-1][1]

    def pct_at(hours: float) -> float:
        target_s = hours * 3600.0
        value = 0.0
        for t, h in cumulative:
            if t <= target_s + 1e-9:
                value = h
        return 100.0 * value / total

    # 기획서 표의 유효자리(0.01%p)까지 일치해야 한다.
    assert pct_at(6.0) == pytest.approx(0.00, abs=0.01)
    assert pct_at(8.0) == pytest.approx(0.01, abs=0.01)
    assert pct_at(10.0) == pytest.approx(1.26, abs=0.01)
    assert pct_at(11.0) == pytest.approx(10.75, abs=0.01)


def test_9_5_ninety_percent_accumulates_in_the_last_1_29_hours():
    """9-5절: "H의 90%가 마지막 1.29시간에 누적"."""
    curve = _ramp_curve(sample_s=10.0)
    cumulative = heat_work_curve(curve, E_ASSUMED)
    total = cumulative[-1][1]
    end_s = cumulative[-1][0]

    crossing_s = end_s
    for t, h in cumulative:
        if h >= 0.10 * total:
            crossing_s = t
            break
    assert (end_s - crossing_s) / 3600.0 == pytest.approx(1.29, abs=0.02)


def test_9_5_three_hour_target_cannot_be_a_relative_error_denominator():
    """부록 E #3: 3시간 시점의 H_목표는 상대오차의 분모로 쓸 수 없다.

    기획서가 든 값은 ``5.6e-14`` 이고, E=300 kJ/mol에서는 ``1.3e-24`` 로 더
    작다. 어느 쪽이든 **주장은 크기 그 자체**다 — 전체의 1e-10 미만이라
    ``e_H = (H목표−H실제)/H목표`` 는 소성 앞 구간에서 0으로 나눈다.
    부록 C 추정 범위(200~400 kJ/mol) 전체에서 성립해야 한다.
    """
    curve = _ramp_curve(sample_s=10.0)
    for E in (200_000.0, 300_000.0, 400_000.0):
        cumulative = heat_work_curve(curve, E)
        total = cumulative[-1][1]
        at_3h = next(h for t, h in cumulative if t >= 3 * 3600.0 - 1e-9)
        assert at_3h < 1e-13
        assert at_3h / total < 1e-10


# ─── 9-5절 회귀: Δt_eq ──────────────────────────────────────────────────────


def test_delta_t_eq_is_the_deficit_divided_by_the_peak_rate():
    deficit = 3.0e-9
    got = equivalent_hold_seconds(deficit, 1220.0, E_ASSUMED)
    assert got == pytest.approx(deficit / _rate(1220.0), rel=1e-12)
    # 되돌리면 부족분 그대로다 — 이것이 '초 단위'라는 말의 뜻이다.
    assert got * _rate(1220.0) == pytest.approx(deficit, rel=1e-12)


def test_delta_t_eq_recovers_a_removed_hold_exactly():
    """유지 7분을 덜어낸 부족분은 Δt_eq = 420초로 되돌아온다 (9-5절 화면 문구)."""
    full = heat_work(((0.0, 1220.0), (900.0, 1220.0)), E_ASSUMED)
    short = heat_work(((0.0, 1220.0), (480.0, 1220.0)), E_ASSUMED)
    assert equivalent_hold_seconds(full - short, 1220.0, E_ASSUMED) == pytest.approx(
        420.0, rel=1e-9
    )


def test_delta_t_eq_is_zero_when_there_is_no_deficit():
    """목표를 이미 채웠으면 음수 연장시간을 내지 않는다."""
    assert equivalent_hold_seconds(0.0, 1220.0, E_ASSUMED) == 0.0
    assert equivalent_hold_seconds(-1e-9, 1220.0, E_ASSUMED) == 0.0


def test_delta_t_eq_guards():
    with pytest.raises(ValueError):
        equivalent_hold_seconds(1e-9, 1220.0, -1.0)
    with pytest.raises(ValueError):
        equivalent_hold_seconds(1e-9, -300.0, E_ASSUMED)


def test_delta_t_eq_denominator_never_vanishes_early_in_the_firing():
    """e_H와 달리 Δt_eq의 분모는 소성 시점과 무관한 상수다.

    3시간 시점(320℃)에서 e_H의 분모는 1e-24 수준이지만 Δt_eq의 분모는
    최고온 기준 exp(−E/R·T_peak)로 고정이라 나눗셈이 성립한다.
    """
    curve = _ramp_curve(sample_s=10.0)
    total = heat_work(curve, E_ASSUMED)
    at_3h = next(h for t, h in heat_work_curve(curve, E_ASSUMED) if t >= 10800.0 - 1e-9)
    dt_eq = equivalent_hold_seconds(total - at_3h, 1220.0, E_ASSUMED)
    assert math.isfinite(dt_eq)
    # 목표 전체를 최고온에서 채운다면 몇 시간 규모다 — 화면에 낼 수 있는 수다.
    assert 0.0 < dt_eq < 24 * 3600.0


# ─── 부록 E 회귀: H는 급냉과 서냉을 구분하지 못한다 ─────────────────────────


def _cooling_curve(
    rate_c_per_h: float, from_c: float = 1220.0, to_c: float = 20.0
) -> tuple[tuple[float, float], ...]:
    span_s = (from_c - to_c) / rate_c_per_h * 3600.0
    n = 4000
    return tuple(
        (span_s * i / n, from_c - (from_c - to_c) * i / n) for i in range(n + 1)
    )


def _hold_then_cool(hold_s: float, rate_c_per_h: float) -> float:
    hold = heat_work(((0.0, 1220.0), (hold_s, 1220.0)), E_ASSUMED)
    cool = heat_work(_cooling_curve(rate_c_per_h), E_ASSUMED)
    return hold + cool


def test_appendix_e_fast_and_slow_cooling_give_the_same_heat_work():
    """부록 E: 급냉(310℃/h)+유지 49분과 서냉(77.5℃/h)+유지 15분의 H가 같다.

    *질감은 정반대인데* H가 같다는 것이 "냉각을 H에 합산하면 안 되는" 이유다
    (9-4·10-3절). E가 미정이라 두 값이 **정확히** 같아지는 E는 하나로 정해지지
    않지만, 부록 C 범위 안(여기서는 300 kJ/mol)에서 이미 2% 안쪽으로 붙는다.
    """
    fast = _hold_then_cool(49 * 60.0, 310.0)
    slow = _hold_then_cool(15 * 60.0, 77.5)
    assert fast == pytest.approx(slow, rel=0.02)


def test_appendix_e_equalising_fast_hold_is_about_49_minutes():
    """두 H를 정확히 같게 만드는 급냉 쪽 유지시간이 기획서의 49분 부근이다."""
    slow = _hold_then_cool(15 * 60.0, 77.5)
    fast_cool_only = heat_work(_cooling_curve(310.0), E_ASSUMED)
    equalising_hold_s = (slow - fast_cool_only) / _rate(1220.0)
    assert equalising_hold_s / 60.0 == pytest.approx(49.0, abs=1.5)


def test_the_two_schedules_are_utterly_different_in_time_and_temperature():
    """같은 H인데 냉각 곡선은 4배 차이다 — H가 버리는 정보의 크기."""
    fast_hours = (1220.0 - 20.0) / 310.0
    slow_hours = (1220.0 - 20.0) / 77.5
    assert slow_hours / fast_hours == pytest.approx(4.0, rel=0.01)
