"""12-2절 · 가마 시뮬레이터 — 생성기는 추정 모델과 **구조적으로 다르다**.

부록 E: *"생성기와 추정 모델이 같으면 어떤 수렴도 자명하다. v5의 '더미
20회차 수렴'이 그랬다."* 그래서 이 시뮬레이터는 제어기·가마 프로필이 쓰는
추정 모델을 그대로 되풀이하지 않고 **일부러 오지정(misspecified)** 한다.

============  ==========================================  =======================
구분          추정 모델 (KilnProfile · SegmentedController)  생성기 (이 모듈)
============  ==========================================  =======================
노드 수       1개 (가마 전체 하나의 C)                       3개 (벽 · 기물 · 센서)
손실          선형 ``UA·(T−T_amb)``                         선형 + 복사 ``σ_eff·(T⁴−T_amb⁴)``
기물          없음 (기물 온도를 모형화하지 않음)               벽과 유한 열저항으로 결합
센서          벽 온도 = 센서 온도                            2단 지연 + 잡음
출력          지령 전력 = 실제 전력                          전압²·열선 노후로 변형
============  ==========================================  =======================

**따라서 제어기가 이 생성기 위에서 잘 도는 것은 자명하지 않다.** 결과는
"수렴"이 아니라 "RMSE X% 감소, Y% 편향 잔존"으로 적어야 한다(부록 E).

**절대 온도 정확도는 담보하지 않는다** (부록 A: "시뮬레이터 — 절대 온도
정확도 담보 불가. 상대 비교만 유효"). 이 모듈이 내는 온도는 제어 전략 A와
B를 같은 조건에서 견주기 위한 값이지 실물 예측이 아니다.

외란은 :class:`Disturbance` 로 주입하고 ``seed`` 로 **재현 가능**하다.
같은 seed·같은 지령이면 부동소수 수준까지 같은 궤적이 나온다.

기물 온도 ``ware_c`` 는 생성기 내부에서만 알 수 있는 값이다. 9-3절이
"기물 온도는 실물에서 관측 불가"라고 못 박았으므로, **제어기는 이 값을
읽지 않는다** — :meth:`KilnSimulator.run` 이 제어기에 넘기는 것은
``sensor_c`` 뿐이다. ``ware_c`` 는 사후 분석(센서–기물 오프셋의 크기를
눈으로 보는 용도)에만 쓴다.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass

from kiln.domain.models import KilnProfile
from kiln.firing.cooling import AMBIENT_C

__all__ = ["Disturbance", "SimStep", "KilnSimulator"]

# ─── 생성기 전용 오지정 파라미터 ─────────────────────────────────────────────
# 아래 값들은 **부록 C 계수가 아니다.** 추정 모델과 구조를 다르게 만들기
# 위한 생성기 내부의 허구이며, 어떤 실물 값도 주장하지 않는다. 그래서
# constants 대장을 거치지 않는다. 크기만은 가마 프로필과 어긋나지 않게
# 맞춰 두어(아래 _RADIATIVE_SHARE 참고) 제어기가 도달 가능한 범위에서
# 비교가 이루어지게 한다.

#: 기준 온도 ``_RADIATIVE_REF_C`` 에서 전체 벽 손실 중 복사가 차지하는 몫.
#: 이 몫만큼을 T⁴ 항으로 옮기므로, 기준 온도에서는 총손실이 선형 모델과
#: 같고 그 밖의 온도에서는 어긋난다 — 이 어긋남이 오지정의 본체다.
_RADIATIVE_SHARE = 0.35
_RADIATIVE_REF_C = 1200.0

#: 기물의 열용량을 가마 유효 열용량의 몇 배로 둘지. 기물은 벽보다 훨씬
#: 가볍지만 무시할 만큼은 아니다.
_WARE_CAPACITY_FRACTION = 0.15

#: 벽–기물 열결합 [W/K] 을 UA의 몇 배로 둘지. 기물이 벽을 몇십 분 뒤따르게
#: 하는 크기다 — 9-1절 ①("기물이 받은 열은 다르다")이 눈에 보이도록.
_WARE_COUPLING_FACTOR = 3.0

#: 벽 안쪽 → 열전대 자리까지의 기본 지연 [s]. ``Disturbance.wall_lag_s`` 가
#: 여기에 더해진다.
_BASE_WALL_LAG_S = 30.0

#: 열전대 자체의 기본 시상수 [s]. ``Disturbance.thermocouple_lag_s`` 가 더해진다.
_BASE_TC_LAG_S = 5.0


@dataclass(frozen=True, slots=True)
class Disturbance:
    """주입 가능한 외란 (12-2절, 9-2절 계통 불확실).

    9-2절이 든 계통 불확실이 그대로 필드가 된다 — 공급전압 ±5%(전력 ±10%),
    열선 노후 −5~15%, 내화물 축열 침투 지연. 여기에 열전대 잡음·지연과
    적재 오차를 더한다.

    ``seed`` 가 잡음의 유일한 입력이므로 같은 seed면 같은 궤적이 나온다.
    검증이 재현 가능해야 한다는 12-2절 요구가 이 필드 하나에 걸려 있다.
    """

    #: 공급전압 편차 [%]. 전력은 전압의 제곱이므로 ±5% → 전력 ±10% (9-2절)
    supply_voltage_pct: float = 0.0
    #: 열선 노후로 인한 출력 감소 [%]. 9-2절 범위는 −5~15%
    element_aging_pct: float = 0.0
    #: 열전대 잡음의 표준편차 [℃]
    thermocouple_noise_c: float = 0.0
    #: 열전대 시상수에 더해지는 지연 [s]
    thermocouple_lag_s: float = 0.0
    #: 등록 적재량 대비 실제 적재량의 오차 [%] (9-2절 총량 이상 감지의 대상)
    load_mismatch_pct: float = 0.0
    #: 내화물 축열 침투 지연에 더해지는 지연 [s] (9-2절)
    wall_lag_s: float = 0.0
    #: 난수 seed. 같은 seed면 같은 잡음열이 나온다
    seed: int = 0


@dataclass(frozen=True, slots=True)
class SimStep:
    """한 스텝의 결과.

    ``power_w`` 는 지령 전력이 아니라 **실제로 들어간 전력**이다. 전압·노후
    외란이 지령과 실제 사이에 끼어 있다는 사실이 결과에 남아야 한다.
    """

    #: 스텝 종료 시각 [s]
    t: float
    #: 열전대가 읽은 온도 [℃] — 제어기가 볼 수 있는 유일한 온도 (9-3절)
    sensor_c: float
    #: 기물 온도 [℃] — 실물에서는 관측 불가. 사후 분석 전용 (9-3절)
    ware_c: float
    #: 실제로 투입된 전력 [W]
    power_w: float


class KilnSimulator:
    """3노드 오지정 가마 생성기 (12-2절).

    상태 방정식(모두 전진 오일러):

    ``C_w·dT_w/dt = P_actual − UA_lin·(T_w−T_a) − σ_eff·((T_w+273.15)⁴−(T_a+273.15)⁴)
    − k_c·(T_w−T_ware)``

    ``C_ware·dT_ware/dt = k_c·(T_w−T_ware)``

    센서는 벽 온도를 2단 1차 지연으로 뒤따르고 마지막에 잡음이 붙는다.

    **이 구조 어디에도 추정 모델과 같은 항이 없다** — 추정 모델은 노드
    하나에 선형 손실뿐이고 기물도 센서 지연도 없다. 12-2절이 요구한
    "구조적으로 다른 생성기"가 이 차이다.
    """

    def __init__(
        self,
        profile: KilnProfile,
        disturbance: Disturbance | None = None,
        *,
        initial_c: float = AMBIENT_C,
        ambient_c: float = AMBIENT_C,
    ) -> None:
        """가마 프로필과 외란으로 생성기를 세운다.

        ``profile`` 에서 가져오는 것은 ``heat_capacity`` · ``ua`` ·
        ``max_power`` 뿐이고, 생성기는 그 값들을 **다른 구조로 재배치**한다
        (복사/선형 분할, 기물 노드 분리). 프로필의 ``natural_cooling`` 곡선은
        쓰지 않는다 — 그것은 추정 모델 쪽 자산이고, 생성기가 그것을 그대로
        따르면 오지정이 사라진다.
        """
        if profile.heat_capacity <= 0:
            raise ValueError(f"가마 열용량이 {profile.heat_capacity} J/K다. 양수여야 한다")
        if profile.ua <= 0:
            raise ValueError(f"벽체 손실 계수 UA가 {profile.ua} W/K다. 양수여야 한다")
        if profile.max_power <= 0:
            raise ValueError(f"최대 출력이 {profile.max_power} W다. 양수여야 한다")

        self.profile = profile
        self.disturbance = disturbance if disturbance is not None else Disturbance()
        self.ambient_c = ambient_c

        d = self.disturbance
        self._rng = random.Random(d.seed)

        # 손실을 선형/복사로 쪼갠다 — 기준 온도에서만 총량이 선형 모델과 같다.
        ref_k = _RADIATIVE_REF_C + 273.15
        amb_k = ambient_c + 273.15
        self._ua_lin = profile.ua * (1.0 - _RADIATIVE_SHARE)
        denom = ref_k**4 - amb_k**4
        self._sigma_eff = (
            _RADIATIVE_SHARE * profile.ua * (_RADIATIVE_REF_C - ambient_c) / denom
            if denom > 0
            else 0.0
        )

        self._c_wall = profile.heat_capacity
        self._c_ware = (
            profile.heat_capacity
            * _WARE_CAPACITY_FRACTION
            * max(1.0 + d.load_mismatch_pct / 100.0, 1e-6)
        )
        self._k_couple = profile.ua * _WARE_COUPLING_FACTOR

        # 지령 → 실제 전력 변형. 전력은 전압의 제곱 (9-2절: ±5% → ±10%).
        self._power_gain = ((1.0 + d.supply_voltage_pct / 100.0) ** 2) * (
            1.0 - d.element_aging_pct / 100.0
        )

        self._tau_wall = _BASE_WALL_LAG_S + max(d.wall_lag_s, 0.0)
        self._tau_tc = _BASE_TC_LAG_S + max(d.thermocouple_lag_s, 0.0)

        self.t = 0.0
        self._t_wall = initial_c
        self._t_ware = initial_c
        self._t_wall_lagged = initial_c
        self._t_tc = initial_c
        #: 제어기가 마지막으로 읽은 센서값(잡음 포함). 실물에서 제어기가
        #: 볼 수 있는 것은 잡음이 얹힌 값뿐이므로 잡음 없는 필터 상태를
        #: 넘기면 검증이 관대해진다.
        self._last_sensor_c = initial_c

    # ─── 출처 ────────────────────────────────────────────────────────────
    @property
    def provenance_notes(self) -> tuple[str, ...]:
        """이 시뮬레이터가 무엇을 주장하지 않는지 (부록 A, 12-2절)."""
        d = self.disturbance
        return (
            "12-2절: 생성기(3노드·복사 손실·센서 2단 지연)는 추정 모델"
            "(1노드·선형 손실)과 구조적으로 다르게 오지정되어 있다. "
            "이 위에서의 수렴은 자명하지 않다",
            "부록 A: 시뮬레이터는 절대 온도 정확도를 담보하지 않는다. "
            "상대 비교(전략 A vs B)에만 유효하다",
            f"외란 seed={d.seed} · 전압 {d.supply_voltage_pct:+.1f}% · "
            f"열선 노후 {d.element_aging_pct:+.1f}% · "
            f"열전대 잡음 σ={d.thermocouple_noise_c:.2f}℃ · "
            f"적재 오차 {d.load_mismatch_pct:+.1f}% — 같은 seed면 재현된다",
            "9-3절: ware_c는 생성기 내부값이다. 실물에서 기물 온도는 관측되지 "
            "않으므로 제어기에는 sensor_c만 전달한다",
        )

    # ─── 적분 ────────────────────────────────────────────────────────────
    def step(self, power_w: float, dt: float) -> SimStep:
        """지령 전력 ``power_w`` 를 ``dt`` 초 동안 넣고 한 스텝 전진한다.

        지령은 ``[0, profile.max_power]`` 로 잘린 뒤 전압²·열선 노후 외란을
        거쳐 **실제 전력**이 되고, 반환되는 ``SimStep.power_w`` 는 그
        실제 전력이다.

        도메인 가드
            - ``dt <= 0`` → :class:`ValueError` (시간이 흐르지 않거나 역행).
            - ``power_w`` 가 음수면 0으로 잘린다 — 전기가마는 열을 빼지
              못한다(9-6절: 급냉은 제어 대상이 아니다).
        """
        if dt <= 0:
            raise ValueError(f"스텝 폭이 {dt}s다. 양수여야 한다")

        commanded = min(max(power_w, 0.0), self.profile.max_power)
        actual = max(commanded * self._power_gain, 0.0)

        wall_k = self._t_wall + 273.15
        amb_k = self.ambient_c + 273.15
        loss_lin = self._ua_lin * (self._t_wall - self.ambient_c)
        loss_rad = self._sigma_eff * (wall_k**4 - amb_k**4)
        coupling = self._k_couple * (self._t_wall - self._t_ware)

        d_wall = (actual - loss_lin - loss_rad - coupling) / self._c_wall
        d_ware = coupling / self._c_ware

        self._t_wall += d_wall * dt
        self._t_ware += d_ware * dt

        # 센서 경로: 벽 내부 → (내화물 침투 지연) → 열전대 시상수 → 잡음.
        # 1차 지연을 지수 이산화로 풀어 dt가 커도 발산하지 않는다.
        a_wall = 1.0 - math.exp(-dt / self._tau_wall)
        self._t_wall_lagged += a_wall * (self._t_wall - self._t_wall_lagged)
        a_tc = 1.0 - math.exp(-dt / self._tau_tc)
        self._t_tc += a_tc * (self._t_wall_lagged - self._t_tc)

        noise = 0.0
        if self.disturbance.thermocouple_noise_c > 0:
            noise = self._rng.gauss(0.0, self.disturbance.thermocouple_noise_c)

        self.t += dt
        self._last_sensor_c = self._t_tc + noise
        return SimStep(
            t=self.t,
            sensor_c=self._last_sensor_c,
            ware_c=self._t_ware,
            power_w=actual,
        )

    def run(self, controller, duration_s: float, dt: float = 1.0) -> list[SimStep]:
        """제어기를 물려 ``duration_s`` 초를 돌린다 (12-2절 검증 루프).

        제어기에 넘기는 것은 **현재 시각과 센서 온도, 스텝 폭**뿐이다.
        기물 온도는 넘기지 않는다 — 9-3절이 "기물 온도는 실물에서 관측
        불가"라고 못 박았으므로, 그것을 제어기에 넘기면 관측 문제를
        회피한 검증이 된다(부록 E).

        ``controller`` 는 ``decide(t, sensor_c, dt)`` 를 가진 무엇이든 되고,
        반환값은 ``power_w`` 속성을 가진 객체(:class:`~kiln.firing.controller.ControlDecision`)
        이거나 전력 [W] 숫자면 된다.

        도메인 가드: ``dt <= 0`` 또는 ``duration_s < 0`` 이면 :class:`ValueError`.
        """
        if dt <= 0:
            raise ValueError(f"스텝 폭이 {dt}s다. 양수여야 한다")
        if duration_s < 0:
            raise ValueError(f"소성 길이가 {duration_s}s다. 음수일 수 없다")

        steps: list[SimStep] = []
        remaining = duration_s
        while remaining > 1e-12:
            span = min(dt, remaining)
            decision = controller.decide(self.t, self._sensor_reading(), span)
            power = getattr(decision, "power_w", decision)
            steps.append(self.step(float(power), span))
            remaining -= span
        return steps

    def _sensor_reading(self) -> float:
        """제어기가 지금 읽는 센서 온도 [℃] — **잡음이 얹힌** 직전 표본.

        실물에서 제어기가 볼 수 있는 것은 잡음이 섞인 열전대 출력뿐이다.
        잡음 없는 내부 필터 상태를 넘기면 12-2절이 경계한 "관측 문제를
        회피한 검증"이 된다.
        """
        return self._last_sensor_c
