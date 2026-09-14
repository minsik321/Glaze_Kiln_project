"""kiln.firing.simulator — 오지정 생성기와 외란 주입 (12-2절).

부록 E: *"생성기와 추정 모델이 같으면 어떤 수렴도 자명하다."* 그래서 이
테스트가 확인하는 것은 정확도가 아니라 **생성기가 추정 모델과 실제로 다른가**,
그리고 **외란이 seed로 재현되는가** 다.
"""

from __future__ import annotations

import pytest

from kiln.domain.models import KilnProfile
from kiln.firing.cooling import AMBIENT_C
from kiln.firing.simulator import Disturbance, KilnSimulator, SimStep

KILN_30L = KilnProfile(
    profile_id="30L",
    name="30L 전기가마",
    heat_capacity=58_000.0,
    ua=2500.0 / (1220.0 - 20.0),
    max_power=6000.0,
)

FULL_DISTURBANCE = Disturbance(
    supply_voltage_pct=-3.0,
    element_aging_pct=8.0,
    thermocouple_noise_c=0.8,
    thermocouple_lag_s=20.0,
    load_mismatch_pct=10.0,
    wall_lag_s=60.0,
    seed=7,
)


class _ConstantPower:
    """일정 출력만 내는 최소 제어기 — run()의 계약을 확인하는 용도."""

    def __init__(self, power_w: float) -> None:
        self.power_w_command = power_w
        self.seen: list[tuple[float, float, float]] = []

    def decide(self, t: float, sensor_c: float, dt: float):
        self.seen.append((t, sensor_c, dt))
        return self.power_w_command


def _soak(power_w: float, seconds: float, disturbance=None, dt: float = 10.0):
    sim = KilnSimulator(KILN_30L, disturbance)
    steps = [sim.step(power_w, dt) for _ in range(int(seconds / dt))]
    return sim, steps


# ─── 재현성 (12-2절: seed로 재현 가능해야 한다) ─────────────────────────────


def test_same_seed_reproduces_the_trajectory_exactly():
    a = _soak(3000.0, 3600.0, FULL_DISTURBANCE)[1]
    b = _soak(3000.0, 3600.0, FULL_DISTURBANCE)[1]
    assert a == b


def test_a_different_seed_changes_the_noise_but_not_the_scale():
    other = Disturbance(
        supply_voltage_pct=FULL_DISTURBANCE.supply_voltage_pct,
        element_aging_pct=FULL_DISTURBANCE.element_aging_pct,
        thermocouple_noise_c=FULL_DISTURBANCE.thermocouple_noise_c,
        thermocouple_lag_s=FULL_DISTURBANCE.thermocouple_lag_s,
        load_mismatch_pct=FULL_DISTURBANCE.load_mismatch_pct,
        wall_lag_s=FULL_DISTURBANCE.wall_lag_s,
        seed=8,
    )
    a = _soak(3000.0, 3600.0, FULL_DISTURBANCE)[1]
    b = _soak(3000.0, 3600.0, other)[1]
    assert a != b
    assert a[-1].sensor_c == pytest.approx(b[-1].sensor_c, abs=5.0)


def test_seed_is_irrelevant_when_there_is_no_noise():
    quiet_a = Disturbance(thermocouple_noise_c=0.0, seed=1)
    quiet_b = Disturbance(thermocouple_noise_c=0.0, seed=999)
    assert _soak(3000.0, 1800.0, quiet_a)[1] == _soak(3000.0, 1800.0, quiet_b)[1]


# ─── 외란이 실제로 작용하는가 (9-2절 계통 불확실) ───────────────────────────


def test_supply_voltage_moves_power_by_the_square_of_the_ratio():
    """9-2절: 공급전압 ±5% → 전력 ±10%. 전력은 전압의 제곱이다."""
    base = _soak(3000.0, 10.0, Disturbance(), dt=10.0)[1][-1].power_w
    high = _soak(3000.0, 10.0, Disturbance(supply_voltage_pct=5.0), dt=10.0)[1][-1]
    low = _soak(3000.0, 10.0, Disturbance(supply_voltage_pct=-5.0), dt=10.0)[1][-1]
    assert base == pytest.approx(3000.0)
    assert high.power_w / base == pytest.approx(1.05**2, rel=1e-12)
    assert low.power_w / base == pytest.approx(0.95**2, rel=1e-12)
    assert high.power_w / base - 1.0 == pytest.approx(0.1025, abs=0.005)


def test_element_aging_reduces_delivered_power():
    """9-2절: 열선 노후 −5~15%."""
    base = _soak(3000.0, 10.0, Disturbance())[1][-1].power_w
    aged = _soak(3000.0, 10.0, Disturbance(element_aging_pct=15.0))[1][-1].power_w
    assert aged == pytest.approx(base * 0.85, rel=1e-12)


def test_load_mismatch_slows_the_ware_node():
    """등록보다 무겁게 실리면 기물이 더 늦게 따라온다 (9-2절 적재 오차)."""
    light = _soak(3000.0, 7200.0, Disturbance(load_mismatch_pct=0.0))[1][-1]
    heavy = _soak(3000.0, 7200.0, Disturbance(load_mismatch_pct=50.0))[1][-1]
    assert heavy.ware_c < light.ware_c


def test_thermocouple_lag_delays_the_reading():
    fast = _soak(3000.0, 1200.0, Disturbance(thermocouple_lag_s=0.0))[1][-1]
    slow = _soak(3000.0, 1200.0, Disturbance(thermocouple_lag_s=600.0))[1][-1]
    assert slow.sensor_c < fast.sensor_c


# ─── 12-2절: 생성기는 추정 모델과 구조적으로 다르다 ─────────────────────────


def _equilibrium_power_w(sim: KilnSimulator, temp_c: float) -> float:
    """벽 온도를 ``temp_c`` 로 두었을 때 정지시키는 전력 [W] — 생성기 기준."""
    sim._t_wall = temp_c
    sim._t_ware = temp_c
    lo, hi = 0.0, 50_000.0
    for _ in range(80):
        mid = (lo + hi) / 2.0
        wall_k = temp_c + 273.15
        amb_k = AMBIENT_C + 273.15
        drift = (
            mid
            - sim._ua_lin * (temp_c - AMBIENT_C)
            - sim._sigma_eff * (wall_k**4 - amb_k**4)
        )
        if drift > 0:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2.0


def test_generator_loss_is_not_the_linear_estimation_model():
    """생성기 손실은 T⁴ 항을 품는다 — 1200℃에서만 선형 모델과 일치한다.

    12-2절이 요구한 "구조적으로 다른 생성기"를 수치로 확인한다. 기준 온도
    1200℃에서는 총손실을 맞춰 두었지만, 600℃에서는 선형 모델과 어긋난다.
    어긋나지 않으면 검증이 자기 생성기 역추적이 된다(부록 E).
    """
    sim = KilnSimulator(KILN_30L)
    at_ref = _equilibrium_power_w(sim, 1200.0)
    linear_ref = KILN_30L.ua * (1200.0 - AMBIENT_C)
    assert at_ref == pytest.approx(linear_ref, rel=1e-6)

    at_600 = _equilibrium_power_w(sim, 600.0)
    linear_600 = KILN_30L.ua * (600.0 - AMBIENT_C)
    assert at_600 != pytest.approx(linear_600, rel=0.05)


def test_the_ware_is_a_separate_node_that_lags_the_sensor():
    """9-1절 ①: 컨트롤러는 벽 센서 하나로 판단하지만 기물이 받은 열은 다르다."""
    _, heating = _soak(4000.0, 7200.0)
    assert heating[-1].ware_c < heating[-1].sensor_c

    sim = KilnSimulator(KILN_30L, initial_c=1000.0)
    cooling = [sim.step(0.0, 10.0) for _ in range(720)]
    assert cooling[-1].ware_c > cooling[-1].sensor_c


def test_power_in_raises_temperature_and_no_power_cools_toward_ambient():
    _, heating = _soak(4000.0, 3600.0)
    assert heating[-1].sensor_c > heating[0].sensor_c

    sim = KilnSimulator(KILN_30L, initial_c=800.0)
    cooling = [sim.step(0.0, 10.0) for _ in range(3600)]
    assert cooling[-1].sensor_c < 800.0
    assert cooling[-1].sensor_c > AMBIENT_C


# ─── run() 의 계약 ──────────────────────────────────────────────────────────


def test_run_never_hands_the_ware_temperature_to_the_controller():
    """9-3절: 기물 온도는 실물에서 관측 불가다. 제어기에 넘기면 검증이 무너진다."""
    ctrl = _ConstantPower(3000.0)
    sim = KilnSimulator(KILN_30L, FULL_DISTURBANCE)
    steps = sim.run(ctrl, 3600.0, dt=10.0)
    assert len(ctrl.seen) == len(steps)
    # 제어기가 본 값은 직전 스텝의 **센서** 기록과 같다.
    for i in range(1, len(steps)):
        assert ctrl.seen[i][1] == pytest.approx(steps[i - 1].sensor_c, rel=1e-15)
    # 그리고 기물 온도와는 벌어져 있다 — 그 간격이 9-3절 센서 오프셋이다.
    gaps = [abs(ctrl.seen[i][1] - steps[i - 1].ware_c) for i in range(1, len(steps))]
    assert max(gaps) > 10.0


def test_run_accepts_a_plain_number_from_the_controller():
    steps = KilnSimulator(KILN_30L).run(_ConstantPower(2000.0), 100.0, dt=10.0)
    assert len(steps) == 10
    assert all(isinstance(s, SimStep) for s in steps)


def test_run_covers_exactly_the_requested_duration():
    steps = KilnSimulator(KILN_30L).run(_ConstantPower(1000.0), 95.0, dt=10.0)
    assert steps[-1].t == pytest.approx(95.0)


def test_run_of_zero_duration_does_nothing():
    assert KilnSimulator(KILN_30L).run(_ConstantPower(1000.0), 0.0) == []


# ─── 도메인 가드 ────────────────────────────────────────────────────────────


def test_nonpositive_step_raises():
    sim = KilnSimulator(KILN_30L)
    with pytest.raises(ValueError):
        sim.step(1000.0, 0.0)
    with pytest.raises(ValueError):
        sim.step(1000.0, -5.0)


def test_negative_duration_raises():
    with pytest.raises(ValueError):
        KilnSimulator(KILN_30L).run(_ConstantPower(1000.0), -10.0)


def test_degenerate_profiles_are_refused():
    for bad in (
        KilnProfile(profile_id="x", name="열용량 0", heat_capacity=0.0, ua=2.0, max_power=3000.0),
        KilnProfile(profile_id="x", name="UA 0", heat_capacity=58_000.0, ua=0.0, max_power=3000.0),
        KilnProfile(profile_id="x", name="출력 0", heat_capacity=58_000.0, ua=2.0, max_power=0.0),
    ):
        with pytest.raises(ValueError):
            KilnSimulator(bad)


def test_commanded_power_is_clamped_to_the_kilns_range():
    """전기가마는 열을 뺄 수 없다 — 음수 지령은 0으로 잘린다 (9-6절)."""
    sim = KilnSimulator(KILN_30L)
    assert sim.step(-5000.0, 10.0).power_w == 0.0
    assert sim.step(99_999.0, 10.0).power_w == pytest.approx(KILN_30L.max_power)


# ─── 출처 문구 (00절 공통 규칙 1, 부록 A) ───────────────────────────────────


def test_provenance_notes_refuse_to_claim_absolute_accuracy():
    notes = " ".join(KilnSimulator(KILN_30L, FULL_DISTURBANCE).provenance_notes)
    assert "절대 온도 정확도" in notes
    assert "상대 비교" in notes
    assert "구조적으로 다르게" in notes
    assert "seed=7" in notes
