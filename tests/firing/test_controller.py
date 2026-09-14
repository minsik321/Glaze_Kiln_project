"""kiln.firing.controller — 구간별 제어와 외측 루프 모드 전환 (9-2·9-4·9-5절).

확인하는 주장 넷:

1. 구간별로 외측 루프가 다르다 — 승온 감시 / 유지 능동 / **냉각 없음**.
2. 모드 전환이 상대오차 ``e_H`` 가 아니라 절대 문턱(목표의 1%)이고,
   능동 모드의 출력이 **초 단위 Δt_eq** 다 (9-5절, 부록 E #3).
3. 냉각 구간의 열이력은 H에 합산되지 않는다 (9-4절, 부록 E).
4. 센서 이상이면 알림 후 **일시 정지**하고 사람이 개입할 때까지 자동 진행이
   없다 (9-2절).
"""

from __future__ import annotations

import math

import pytest

from kiln import constants
from kiln.domain.models import KilnProfile
from kiln.firing.controller import (
    WATCHING_FRACTION,
    OuterMode,
    Phase,
    SegmentedController,
)
from kiln.firing.heatwork import R_GAS, heat_work
from kiln.firing.simulator import Disturbance, KilnSimulator

E_ASSUMED = 300_000.0

KILN_30L = KilnProfile(
    profile_id="30L",
    name="30L 전기가마",
    heat_capacity=58_000.0,
    ua=2500.0 / (1220.0 - 20.0),
    max_power=6000.0,
)

#: 9-5절 예제 스케줄: 20℃ → 100℃/h → 1220℃ → 15분 유지 → 냉각.
SCHEDULE = (
    (0.0, 20.0),
    (12 * 3600.0, 1220.0),
    (12.25 * 3600.0, 1220.0),
    (20 * 3600.0, 200.0),
)


def _controller(**kwargs) -> SegmentedController:
    return SegmentedController(KILN_30L, SCHEDULE, E=E_ASSUMED, **kwargs)


def _peak_rate() -> float:
    return math.exp(-E_ASSUMED / (R_GAS * (1220.0 + 273.15)))


# ─── 생성 가드 ──────────────────────────────────────────────────────────────


def test_schedule_needs_at_least_two_points():
    with pytest.raises(ValueError):
        SegmentedController(KILN_30L, ((0.0, 20.0),), E=E_ASSUMED)


def test_schedule_times_must_increase():
    with pytest.raises(ValueError):
        SegmentedController(
            KILN_30L, ((0.0, 20.0), (100.0, 500.0), (50.0, 900.0)), E=E_ASSUMED
        )


def test_nonpositive_activation_energy_is_refused():
    with pytest.raises(ValueError):
        SegmentedController(KILN_30L, SCHEDULE, E=0.0)


def test_nonpositive_control_period_is_refused():
    with pytest.raises(ValueError):
        _controller().decide(0.0, 20.0, 0.0)


# ─── 부록 C: E가 가정값이라는 사실이 결과에 실려 나간다 ─────────────────────


def test_every_decision_carries_the_assumption_about_E():
    """00절 공통 규칙 1 — 조용한 기본값 금지."""
    decision = _controller().decide(0.0, 20.0, 20.0)
    assert "미정" in decision.message
    assert "E=3e+05" in decision.message


def test_the_outer_loop_never_needs_the_undetermined_gain_Kh():
    """9-5절의 출력을 Δt_eq로 둔 덕에 부록 C 미정 계수 Kh가 필요 없다.

    이득을 곱한 보정량을 냈다면 Kh(미정)의 값을 가정해야 했을 것이다.
    """
    assert constants.get("Kh").is_determined is False
    controller = _controller()
    controller.decide(0.0, 20.0, 20.0)  # Kh 없이 동작한다


# ─── 9-4절: 목표 H는 승온·유지에서만 나온다 ────────────────────────────────


def test_default_target_heat_work_excludes_the_cooling_leg():
    """9-4절·부록 E: 냉각을 H에 합산하지 않는다."""
    controller = _controller()
    ramp_and_hold = SCHEDULE[:3]
    assert controller.target_heat_work == pytest.approx(
        heat_work(ramp_and_hold, E_ASSUMED), rel=1e-12
    )
    assert controller.target_heat_work < heat_work(SCHEDULE, E_ASSUMED)


def test_an_explicit_target_overrides_the_schedule():
    controller = _controller(target_heat_work=1.5e-7)
    assert controller.target_heat_work == 1.5e-7


# ─── 9-4절: 구간 판정 ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("t_hours", "phase"),
    [(1.0, Phase.RAMP), (6.0, Phase.RAMP), (12.1, Phase.HOLD), (15.0, Phase.COOL)],
)
def test_phase_follows_the_schedule_slope(t_hours, phase):
    controller = _controller()
    assert controller.decide(t_hours * 3600.0, 500.0, 20.0).phase is phase


# ─── 9-5절: 감시 / 능동 모드 전환 ───────────────────────────────────────────


def test_early_in_the_firing_the_outer_loop_only_watches():
    """3시간 시점(320℃)에서는 누적 H가 목표의 1% 근처에도 못 간다."""
    controller = _controller()
    controller.decide(3 * 3600.0 - 20.0, 320.0, 20.0)
    decision = controller.decide(3 * 3600.0, 320.0, 20.0)
    assert decision.outer_mode is OuterMode.WATCHING
    assert decision.hold_extension_s == 0.0
    assert controller.heat_work_accumulated < WATCHING_FRACTION * controller.target_heat_work
    assert "감시 모드" in decision.message


def test_the_watching_mode_message_names_the_division_by_zero_it_avoids():
    decision = _controller().decide(3 * 3600.0, 320.0, 20.0)
    assert "0으로 나눈다" in decision.message


def test_active_mode_reports_delta_t_eq_in_seconds():
    """9-5절: 능동 모드의 출력은 초 단위 Δt_eq이고 화면에는 '분 부족'으로 뜬다."""
    controller = _controller(target_heat_work=2.0e-7)
    controller.heat_work_accumulated = 1.0e-7  # 목표의 50% — 능동 모드
    controller._prev_t, controller._prev_sensor_c = 12.1 * 3600.0, 1220.0
    decision = controller.decide(12.1 * 3600.0 + 20.0, 1220.0, 20.0)
    assert decision.outer_mode is OuterMode.ACTIVE
    assert decision.hold_extension_s > 0
    assert "분 부족" in decision.message


def test_delta_t_eq_equals_the_deficit_over_the_peak_rate():
    controller = _controller(target_heat_work=2.0e-7)
    controller.heat_work_accumulated = 1.2e-7
    controller._prev_t, controller._prev_sensor_c = 12.1 * 3600.0, 1220.0
    decision = controller.decide(12.1 * 3600.0 + 20.0, 1220.0, 20.0)
    deficit = controller.target_heat_work - controller.heat_work_accumulated
    assert decision.hold_extension_s == pytest.approx(deficit / _peak_rate(), rel=1e-9)


def test_the_mode_boundary_sits_exactly_at_one_percent():
    just_under = _controller(target_heat_work=1.0e-7)
    just_under.heat_work_accumulated = 0.9 * WATCHING_FRACTION * 1.0e-7
    just_under._prev_t, just_under._prev_sensor_c = 12.1 * 3600.0, 1220.0
    assert (
        just_under.decide(12.1 * 3600.0, 1220.0, 20.0).outer_mode is OuterMode.WATCHING
    )

    just_over = _controller(target_heat_work=1.0e-7)
    just_over.heat_work_accumulated = 1.1 * WATCHING_FRACTION * 1.0e-7
    just_over._prev_t, just_over._prev_sensor_c = 12.1 * 3600.0, 1220.0
    assert just_over.decide(12.1 * 3600.0, 1220.0, 20.0).outer_mode is OuterMode.ACTIVE


def test_a_zero_target_does_not_switch_the_outer_loop_on():
    """0으로 나누지 않는다 — 목표 H가 0이면 감시 모드에 머문다."""
    controller = _controller(target_heat_work=0.0)
    decision = controller.decide(12.1 * 3600.0, 1220.0, 20.0)
    assert decision.outer_mode is OuterMode.WATCHING
    assert decision.hold_extension_s == 0.0


# ─── 9-4절: 냉각에는 외측 루프가 없다 ───────────────────────────────────────


def test_cooling_has_no_outer_loop_and_no_hold_extension():
    controller = _controller(target_heat_work=1.0e-7)
    controller.heat_work_accumulated = 1.0e-9  # 큰 부족분
    decision = controller.decide(15 * 3600.0, 900.0, 20.0)
    assert decision.phase is Phase.COOL
    assert decision.outer_mode is OuterMode.WATCHING
    assert decision.hold_extension_s == 0.0
    assert "단일 루프" in decision.message


def test_cooling_temperatures_are_not_added_to_the_heat_work():
    """부록 E: H는 급냉과 서냉을 구분하지 못하므로 냉각을 합산하면 안 된다."""
    controller = _controller()
    controller.decide(13 * 3600.0, 1150.0, 3600.0)
    before = controller.heat_work_accumulated
    controller.decide(14 * 3600.0, 1100.0, 3600.0)
    controller.decide(15 * 3600.0, 1000.0, 3600.0)
    assert controller.heat_work_accumulated == before == 0.0


def test_ramp_and_hold_temperatures_are_accumulated():
    controller = _controller()
    controller.decide(12.05 * 3600.0, 1220.0, 60.0)
    controller.decide(12.05 * 3600.0 + 600.0, 1220.0, 600.0)
    assert controller.heat_work_accumulated == pytest.approx(
        600.0 * _peak_rate(), rel=1e-9
    )


# ─── 9-2절: 센서 이상 → 알림 후 일시 정지 ──────────────────────────────────


def test_an_implausible_temperature_jump_pauses_the_run():
    controller = _controller()
    controller.decide(0.0, 20.0, 20.0)
    decision = controller.decide(20.0, 900.0, 20.0)
    assert decision.paused is True
    assert decision.power_w == 0.0
    assert controller.is_paused is True
    assert "급변" in decision.message


def test_a_stuck_thermocouple_pauses_the_run():
    """승온 중 출력을 넣는데 센서가 15분간 움직이지 않는다 → 정체."""
    controller = _controller()
    paused_at = None
    for i in range(200):
        decision = controller.decide(i * 20.0, 500.0, 20.0)
        if decision.paused:
            paused_at = i * 20.0
            break
    assert paused_at is not None
    assert paused_at <= 1000.0
    assert "정체" in controller.pause_reason or "움직이지 않았다" in controller.pause_reason


def test_a_below_absolute_zero_reading_pauses_the_run():
    controller = _controller()
    assert controller.decide(0.0, -400.0, 20.0).paused is True


def test_the_pause_persists_until_a_human_resumes():
    """9-2절: 사람이 개입할 때까지 자동 진행을 금지한다."""
    controller = _controller()
    controller.decide(0.0, 20.0, 20.0)
    controller.decide(20.0, 900.0, 20.0)
    for i in range(2, 60):
        decision = controller.decide(i * 20.0, 20.0 + i, 20.0)
        assert decision.paused is True
        assert decision.power_w == 0.0

    controller.resume("열전대 교체함")
    resumed = controller.decide(2000.0, 50.0, 20.0)
    assert resumed.paused is False
    assert resumed.power_w > 0.0
    assert "열전대 교체함" in controller.pause_reason


def test_a_normal_ramp_is_not_mistaken_for_stagnation():
    """100℃/h 승온에서 20초 주기당 0.55℃ — 주기당으로 재면 오보가 난다."""
    controller = _controller()
    for i in range(400):
        t = i * 20.0
        decision = controller.decide(t, 20.0 + 100.0 * t / 3600.0, 20.0)
        assert decision.paused is False


# ─── 내측 루프 ──────────────────────────────────────────────────────────────


def test_power_is_clamped_to_the_kilns_range():
    controller = _controller()
    assert controller.decide(6 * 3600.0, -200.0, 20.0).power_w <= KILN_30L.max_power
    assert controller.decide(6 * 3600.0, 5000.0, 20.0).power_w >= 0.0


def test_being_below_setpoint_calls_for_more_power_than_being_above():
    controller = _controller()
    hot = controller.decide(6 * 3600.0, 680.0, 20.0).power_w
    controller_b = _controller()
    cold = controller_b.decide(6 * 3600.0, 580.0, 20.0).power_w
    assert cold > hot


# ─── 12-2절: 오지정 생성기 위에서의 폐루프 ──────────────────────────────────


def test_closed_loop_against_the_misspecified_generator_meets_the_heat_work_target():
    """제어기 + 생성기 폐루프.

    생성기는 3노드·복사 손실·센서 지연으로 오지정되어 있으므로(12-2절) 이
    결과는 자명하지 않다. 확인하는 것은 "정확히 맞았다"가 아니라
    **누적 H_s가 목표를 채우되 크게 넘기지 않는다**는 것과, 그 과정에서
    유지가 실제로 연장되었다는 것이다.
    """
    controller = _controller()
    sim = KilnSimulator(
        KILN_30L,
        Disturbance(
            supply_voltage_pct=-3.0,
            element_aging_pct=8.0,
            thermocouple_noise_c=0.5,
            thermocouple_lag_s=20.0,
            wall_lag_s=60.0,
            load_mismatch_pct=10.0,
            seed=7,
        ),
    )
    steps = sim.run(controller, 20 * 3600.0, dt=20.0)

    assert controller.is_paused is False
    ratio = controller.heat_work_accumulated / controller.target_heat_work
    assert 1.0 <= ratio <= 1.10
    assert steps[-1].sensor_c < 700.0  # 냉각 구간까지 내려왔다


def test_the_hold_is_actually_extended_when_the_ramp_falls_behind():
    """열선이 노후해 승온이 느리면 유지가 늘어난다 (9-5절 능동 모드)."""
    controller = _controller()
    sim = KilnSimulator(KILN_30L, Disturbance(element_aging_pct=15.0, seed=3))
    sim.run(controller, 20 * 3600.0, dt=20.0)
    assert controller.hold_credit_s > 0.0


def test_the_generator_ware_temperature_never_reaches_the_controller():
    """9-3절: H_s는 센서 기준이다. 기물이 받은 열을 직접 제어한다고 하지 않는다."""
    controller = _controller()
    sim = KilnSimulator(KILN_30L, Disturbance(seed=1))
    # 유지 연장이 시작되기 전(승온 끝)까지만 돌려 시각 축을 단순하게 둔다.
    steps = sim.run(controller, 12 * 3600.0, dt=20.0)
    sensor_based = heat_work(tuple((s.t, s.sensor_c) for s in steps), E_ASSUMED)
    ware_based = heat_work(tuple((s.t, s.ware_c) for s in steps), E_ASSUMED)
    # 두 값은 크게 다르고, 제어기가 쌓은 것은 **센서** 쪽이다.
    assert sensor_based != pytest.approx(ware_based, rel=0.10)
    assert controller.heat_work_accumulated == pytest.approx(sensor_based, rel=0.05)
