"""9-4 · 9-5 · 9-2절 · 구간별 제어 — 승온 감시 / 유지 능동 / 냉각 단일 루프.

9-4절 표를 그대로 코드로 옮긴다.

======  ===========  =============  ==================
구간    내측 루프    외측 루프      추종 대상
======  ===========  =============  ==================
승온    온도 PID     **감시 모드**  원본 스케줄
유지    온도 PID     **능동 모드**  누적 열일 H_s
냉각    온도 PID     **없음**       목표 냉각률 궤적
======  ===========  =============  ==================

**냉각에는 외측 루프가 없다.** H는 급냉과 서냉을 구분하지 못하므로
(부록 E: 급냉 310℃/h+유지 49분 = 서냉 77.5℃/h+유지 15분, H 동일) 냉각
구간은 H로 환산하지 않고 온도–시간 궤적을 그대로 따른다. 이 제어기는
냉각 구간에서 **H를 적산조차 하지 않는다**.

**모드 전환은 상대오차가 아니라 절대 문턱으로 한다** (9-5절, 부록 E #3).

    감시 모드   누적 H < 목표의 1%   보정 출력 0, 원본 스케줄 추종, 이상 감시만
    능동 모드   누적 H ≥ 목표의 1%   Δt_eq = (H_목표−H_실제)/exp(−E/R·T_peak) [초]

``e_H = (H_목표−H_실제)/H_목표`` 는 쓰지 않는다. 100℃/h·1220℃ 소성에서
3시간 시점의 H_목표가 0에 붙어 있어(H의 90%가 마지막 1.29시간에 누적)
**소성 앞 80% 구간에서 0으로 나눈다.** 그래서 외측 루프의 출력은 이득을
곱한 보정량이 아니라 **초 단위 Δt_eq** 다 — 덕분에 부록 C에서 미정인
외측 루프 이득 ``Kh`` 가 이 제어기에는 아예 필요하지 않다.

**센서 이상은 알림 후 일시 정지다** (9-2절). 온도 정체·급변처럼 물리적으로
불가능한 패턴을 만나면 출력을 0으로 내리고 :attr:`SegmentedController.is_paused`
를 세운 뒤, **사람이 :meth:`SegmentedController.resume` 을 부를 때까지 자동
진행을 하지 않는다.** 정지 해제는 코드가 스스로 하지 않는다.

9-7절 아키텍처 A(스케줄 주입)에서는 실행 중 램프·홀드 교체가 안 되는
컨트롤러가 많다. 그래서 :attr:`ControlDecision.hold_extension_s` 는
**요청값**으로도 읽히도록 따로 낸다 — 직접 제어(B)가 아니면 사람이 이
값을 보고 기존 컨트롤러의 유지 시간을 늘린다.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from enum import Enum

from kiln import constants
from kiln.domain.models import KilnProfile
from kiln.firing.cooling import AMBIENT_C
from kiln.firing.heatwork import R_GAS, equivalent_hold_seconds, heat_work

__all__ = [
    "Phase",
    "OuterMode",
    "ControlDecision",
    "SegmentedController",
    "WATCHING_FRACTION",
]

#: 9-5절 모드 전환 문턱 — 누적 H가 목표의 1%에 닿으면 능동 모드로 넘어간다.
WATCHING_FRACTION = 0.01

#: 스케줄 기울기를 승온/유지/냉각으로 가르는 문턱 [℃/s].
#: 0.6 ℃/h — 이보다 완만하면 유지로 본다.
_SLOPE_EPS_C_PER_S = 1.0 / 6000.0

#: 내측 PID의 목표 정정 시상수 [s]. 비례이득을 ``C/τ`` 로 물리에서 뽑는다.
#: 임의의 숫자를 이득으로 박지 않으려는 것 — 이득이 가마 열용량과 함께
#: 움직여야 프로필이 바뀌어도 같은 동작을 한다.
_INNER_TAU_S = 300.0

#: 물리적으로 불가능한 온도 변화율 [℃/s]. 30 ℃/s = 108,000 ℃/h.
#: 열전대 단선·접촉 불량이면 이보다 큰 점프가 나온다 (9-2·9-7절).
_IMPLAUSIBLE_RATE_C_PER_S = 30.0

#: 승온 중인데 센서가 :data:`_STAGNATION_WINDOW_S` 동안 이만큼도 움직이지
#: 않으면 정체로 본다 [℃]. **창(window) 전체의 변화량**이지 주기당 변화량이
#: 아니다 — 100℃/h 승온이면 900초에 25℃가 움직여야 하므로, 주기당으로 재면
#: 20초 주기에서 0.55℃뿐이라 정상 승온을 정체로 오인한다.
#: 3℃로 둔 것은 열전대 잡음(σ ≈ 0.5℃)의 몇 배 위에 두기 위해서다.
_STAGNATION_DELTA_C = 3.0
_STAGNATION_WINDOW_S = 900.0


class Phase(Enum):
    """9-4절 구간."""

    RAMP = "승온"
    HOLD = "유지"
    COOL = "냉각"


class OuterMode(Enum):
    """9-5절 외측 루프 모드."""

    WATCHING = "감시"
    """누적 H < 목표의 1%. 보정 출력 0, 원본 스케줄 추종, 이상 감시만."""

    ACTIVE = "능동"
    """누적 H ≥ 목표의 1%. Δt_eq를 초 단위로 낸다."""


@dataclass(frozen=True, slots=True)
class ControlDecision:
    """한 제어 주기의 결정 (9-4 · 9-5절)."""

    #: 내측 루프가 내는 지령 전력 [W]. 일시 정지 중이면 0
    power_w: float
    phase: Phase
    outer_mode: OuterMode
    #: 9-5절 Δt_eq [초]. 감시 모드·냉각 구간에서는 0
    hold_extension_s: float
    #: 화면 문구. E가 부록 C 미정 가정값이라는 사실이 항상 실려 나간다
    message: str
    #: 센서 이상으로 자동 진행이 멈췄는가 (9-2절)
    paused: bool = False


class SegmentedController:
    """구간별 제어기 (9-4 · 9-5 · 9-2절).

    ``schedule`` 은 ``(시각[s], 목표온도[℃])`` 점열이며
    :attr:`kiln.domain.models.FiringRun.schedule` 과 같은 자료형이다.
    구간(:class:`Phase`)은 스케줄의 국소 기울기에서 읽는다 — 오르면 승온,
    평평하면 유지, 내려가면 냉각.

    ``E`` 는 부록 C **미정** 계수이므로 호출부가 반드시 가정값을 넘겨야 한다
    (기본값 없음). 그 사실은 매 :class:`ControlDecision` 의 ``message`` 에
    실려 나간다 — :meth:`kiln.constants.Coefficient.annotation` 을 거치므로
    조용한 기본값이 될 수 없다.

    ``target_heat_work`` 를 주지 않으면 **원본 스케줄의 승온·유지 구간**에서
    직접 계산한다. 냉각 구간은 계산에서 제외한다(9-4절: 냉각을 H에 합산하지
    않는다).
    """

    def __init__(
        self,
        profile: KilnProfile,
        schedule: Sequence[tuple[float, float]],
        *,
        E: float,
        target_heat_work: float | None = None,
        ambient_c: float = AMBIENT_C,
    ) -> None:
        if len(schedule) < 2:
            raise ValueError(
                f"스케줄에 점이 {len(schedule)}개다. (시각, 목표온도) 점이 "
                "2개 이상이어야 구간을 가를 수 있다"
            )
        times = [t for t, _ in schedule]
        if any(b <= a for a, b in zip(times, times[1:])):
            raise ValueError("스케줄의 시각이 단조증가가 아니다")
        if E <= 0:
            raise ValueError(f"활성화 에너지 E는 양수여야 한다: {E}")

        self.profile = profile
        self.schedule = tuple(schedule)
        self.E = E
        self.ambient_c = ambient_c

        e_coeff = constants.get("E").assume(E, "9-5절 외측 루프 운용을 위한 가정")
        #: E가 가정값이라는 사실. 매 결정의 message에 붙는다 (00절 공통 규칙 1)
        self.e_note = f"E={E:.4g} J/mol {e_coeff.annotation()}"

        self.peak_c = max(temp for _, temp in self.schedule)
        ramp_hold = self._ramp_and_hold_curve()
        #: 승온·유지 구간이 끝나는 스케줄 시각 [s]. 유지 연장은 **여기서만**
        #: 적용한다 — 유지 도중에 스케줄을 얼리면 남은 유지분이 그대로 덧붙어
        #: 목표 H를 넘긴다.
        self._hold_end_t = ramp_hold[-1][0]
        self.target_heat_work = (
            target_heat_work if target_heat_work is not None else heat_work(ramp_hold, E)
        )
        if self.target_heat_work < 0:
            raise ValueError("목표 열일이 음수다")

        self.heat_work_accumulated = 0.0
        #: 유지 연장으로 스케줄 진행을 멈춰 둔 누적 시간 [s]
        self.hold_credit_s = 0.0
        self.is_paused = False
        self.pause_reason = ""

        self._prev_t: float | None = None
        self._prev_sensor_c: float | None = None
        self._stagnation_anchor: tuple[float, float] | None = None

    # ─── 스케줄 ──────────────────────────────────────────────────────────
    def _ramp_and_hold_curve(self) -> tuple[tuple[float, float], ...]:
        """스케줄에서 **승온·유지 구간만** 잘라낸다 (9-4절).

        최고온도에 마지막으로 머무는 지점까지가 H의 정의역이다. 그 뒤는
        냉각이고, 냉각은 H로 환산하지 않는다 — 부록 E가 폐기한 설계다.
        """
        cut = 0
        for i, (_, temp) in enumerate(self.schedule):
            if temp >= self.peak_c - 1e-9:
                cut = i
        return self.schedule[: cut + 1]

    def _schedule_at(self, t: float) -> tuple[float, float]:
        """유효 시각 ``t`` 에서의 (목표온도 [℃], 기울기 [℃/s])."""
        pts = self.schedule
        if t <= pts[0][0]:
            slope = (pts[1][1] - pts[0][1]) / (pts[1][0] - pts[0][0])
            return pts[0][1], slope
        if t >= pts[-1][0]:
            return pts[-1][1], 0.0
        for (t0, T0), (t1, T1) in zip(pts, pts[1:]):
            if t0 <= t <= t1:
                slope = (T1 - T0) / (t1 - t0)
                return T0 + slope * (t - t0), slope
        return pts[-1][1], 0.0

    @staticmethod
    def _phase_of(slope: float) -> Phase:
        if slope > _SLOPE_EPS_C_PER_S:
            return Phase.RAMP
        if slope < -_SLOPE_EPS_C_PER_S:
            return Phase.COOL
        return Phase.HOLD

    # ─── 안전 (9-2 · 9-7절) ──────────────────────────────────────────────
    def resume(self, operator_note: str = "") -> None:
        """사람이 확인한 뒤 일시 정지를 푼다 (9-2절).

        **코드가 스스로 부르지 않는다.** 9-2절은 센서 이상 시 "알림 후
        일시 정지하고 사람이 개입할 때까지 자동 진행을 금지"할 것을 요구한다.
        해제 경로를 사람 손에만 두는 것이 그 요구의 구현이다.
        """
        self.is_paused = False
        self.pause_reason = (
            f"사람이 해제함{': ' + operator_note if operator_note else ''}"
        )
        self._stagnation_anchor = None
        self._prev_t = None
        self._prev_sensor_c = None

    def _sensor_anomaly(
        self, t: float, sensor_c: float, dt: float, phase: Phase, powered: bool
    ) -> str:
        """센서 이상 사유. 없으면 빈 문자열 (9-2절)."""
        if sensor_c <= -273.15:
            return f"센서가 {sensor_c:.1f}℃를 읽었다 — 절대영도 이하. 열전대 단선 의심"

        if self._prev_sensor_c is not None and self._prev_t is not None:
            span = t - self._prev_t
            if span > 0:
                rate = abs(sensor_c - self._prev_sensor_c) / span
                if rate > _IMPLAUSIBLE_RATE_C_PER_S:
                    return (
                        f"센서 온도가 {span:.1f}초 만에 "
                        f"{sensor_c - self._prev_sensor_c:+.1f}℃ 변했다"
                        f"({rate:.1f}℃/s). 가마의 열용량으로 불가능한 급변이다 — "
                        "열전대 접촉·배선을 확인하라"
                    )

        if phase is Phase.RAMP and powered:
            anchor = self._stagnation_anchor
            if anchor is None or abs(sensor_c - anchor[1]) >= _STAGNATION_DELTA_C:
                # 창을 새로 연다 — 센서가 의미 있게 움직였다.
                self._stagnation_anchor = (t, sensor_c)
            elif t - anchor[0] >= _STAGNATION_WINDOW_S:
                return (
                    f"승온 중 출력을 넣고 있는데 센서 온도가 {t - anchor[0]:.0f}초 "
                    f"동안 {_STAGNATION_DELTA_C:.1f}℃도 움직이지 않았다"
                    f"({anchor[1]:.1f}℃ → {sensor_c:.1f}℃). "
                    "열전대 고착 또는 열선 단선 의심"
                )
        else:
            self._stagnation_anchor = None
        return ""

    # ─── 내측 루프 ───────────────────────────────────────────────────────
    def _inner_power(self, setpoint_c: float, sensor_c: float, slope: float) -> float:
        """온도 PID(여기서는 전향보상 + 비례) 지령 전력 [W] (9-4절).

        ``P = UA·(T_sp − T_amb) + C·(스케줄 기울기) + (C/τ)·(T_sp − T_s)``

        앞 두 항은 정상상태 손실과 승온에 필요한 열을 그대로 계산한 **전향
        보상**이고, 마지막 항만 되먹임이다. 비례이득을 ``C/τ`` 로 물리에서
        뽑기 때문에 가마 프로필이 바뀌어도 같은 정정 시상수를 유지한다 —
        임의의 숫자를 이득으로 박지 않으려는 선택이다.

        **냉각 구간도 같은 식이다** — 목표 냉각률이 음수 기울기로 들어가
        필요한 유지 전력이 저절로 줄고, 자연냉각보다 빠른 냉각을 요구하면
        전력이 0으로 잘린다. 전기가마는 열을 뺄 수 없다(9-6절).
        """
        feedforward = self.profile.ua * max(setpoint_c - self.ambient_c, 0.0)
        ramp_term = self.profile.heat_capacity * slope
        proportional = (self.profile.heat_capacity / _INNER_TAU_S) * (
            setpoint_c - sensor_c
        )
        return min(
            max(feedforward + ramp_term + proportional, 0.0), self.profile.max_power
        )

    # ─── 외측 루프 ───────────────────────────────────────────────────────
    def decide(self, t: float, sensor_c: float, dt: float) -> ControlDecision:
        """한 제어 주기의 결정 (9-4 · 9-5 · 9-2절).

        순서:

        1. **센서 이상 감시** — 정체·급변이면 출력 0, 일시 정지, 사람 개입
           대기(9-2절). 이후 주기도 :meth:`resume` 전까지 계속 정지 상태다.
        2. **H_s 적산** — 직전 주기와 이번 주기의 센서 온도를 잇는 구간을
           적분해 누적한다. **냉각 구간에서는 적산하지 않는다**(9-4절).
        3. **구간 판정** — 유효 시각(= t − 누적 유지 연장)의 스케줄 기울기.
        4. **모드 전환** — 누적 H가 목표의 1% 미만이면 감시(보정 0),
           이상이면 능동. 능동이면 Δt_eq를 초 단위로 낸다(9-5절).
        5. **유지 연장** — 유지 구간에서 Δt_eq > 0이면 스케줄 진행을 멈춰
           유지를 실제로 늘린다. 아키텍처 A에서는 이 값을 사람이 읽고
           기존 컨트롤러에 반영한다(9-7절).
        6. **내측 루프** — 온도 PID가 지령 전력을 낸다.

        도메인 가드: ``dt <= 0`` 이면 :class:`ValueError`.
        """
        if dt <= 0:
            raise ValueError(f"제어 주기가 {dt}s다. 양수여야 한다")

        eff_t = t - self.hold_credit_s
        setpoint_c, slope = self._schedule_at(eff_t)
        phase = self._phase_of(slope)

        # 1. 센서 이상 감시 — 정지 중이면 무엇도 진행하지 않는다.
        if self.is_paused:
            return ControlDecision(
                power_w=0.0,
                phase=phase,
                outer_mode=OuterMode.WATCHING,
                hold_extension_s=0.0,
                message=(
                    f"[일시 정지] {self.pause_reason} — 9-2절: 사람이 개입해 "
                    "resume()을 호출하기 전까지 자동 진행하지 않는다. "
                    f"누적 H_s={self.heat_work_accumulated:.4g} ({self.e_note})"
                ),
                paused=True,
            )

        powered_last = phase is Phase.RAMP
        anomaly = self._sensor_anomaly(t, sensor_c, dt, phase, powered_last)
        if anomaly:
            self.is_paused = True
            self.pause_reason = anomaly
            self._prev_t, self._prev_sensor_c = t, sensor_c
            return ControlDecision(
                power_w=0.0,
                phase=phase,
                outer_mode=OuterMode.WATCHING,
                hold_extension_s=0.0,
                message=(
                    f"[센서 이상 · 일시 정지] {anomaly}. 9-2절에 따라 출력을 0으로 "
                    "내리고 사람의 개입을 기다린다. 자동 재개는 없다"
                ),
                paused=True,
            )

        # 2. H_s 적산 — 냉각은 합산하지 않는다 (9-4절, 부록 E).
        if (
            phase is not Phase.COOL
            and self._prev_t is not None
            and self._prev_sensor_c is not None
            and t > self._prev_t
        ):
            self.heat_work_accumulated += heat_work(
                ((self._prev_t, self._prev_sensor_c), (t, sensor_c)), self.E
            )
        self._prev_t, self._prev_sensor_c = t, sensor_c

        # 4. 모드 전환 — 상대오차 e_H가 아니라 절대 문턱 (9-5절).
        target = self.target_heat_work
        deficit = target - self.heat_work_accumulated
        if phase is Phase.COOL:
            # 9-4절: 냉각에는 외측 루프가 **없다**. 단일 루프로 냉각률 궤적만 따른다.
            outer_mode = OuterMode.WATCHING
            dt_eq = 0.0
            outer_text = (
                "냉각 구간 — 외측 루프 없음(단일 루프). 목표 냉각률 궤적만 "
                "추종하며 H로 환산하지 않는다 (9-4절). "
                f"자연냉각률 상한 {self.profile.natural_cooling_rate(sensor_c):.0f}℃/h"
            )
        elif target <= 0:
            outer_mode = OuterMode.WATCHING
            dt_eq = 0.0
            outer_text = "목표 열일이 0이라 외측 루프를 켜지 않는다 (감시 모드)"
        elif self.heat_work_accumulated < WATCHING_FRACTION * target:
            outer_mode = OuterMode.WATCHING
            dt_eq = 0.0
            pct = 100.0 * self.heat_work_accumulated / target
            outer_text = (
                f"감시 모드 — 누적 H_s가 목표의 {pct:.2f}% "
                f"({WATCHING_FRACTION * 100:.0f}% 미만). 보정 출력 0, 원본 스케줄 "
                "추종. 9-5절: 이 구간에서 상대오차 e_H는 0으로 나눈다"
            )
        else:
            outer_mode = OuterMode.ACTIVE
            dt_eq = equivalent_hold_seconds(deficit, self.peak_c, self.E)
            pct = 100.0 * self.heat_work_accumulated / target
            if dt_eq > 0:
                outer_text = (
                    f"능동 모드 — 누적 H_s가 목표의 {pct:.2f}%. "
                    f"Δt_eq = {dt_eq:.0f}초 → 최고온 {self.peak_c:.0f}℃ 기준 "
                    f"유지 {dt_eq / 60.0:.0f}분 부족"
                )
            else:
                outer_text = (
                    f"능동 모드 — 누적 H_s가 목표의 {pct:.2f}%로 목표를 채웠다. "
                    "유지 연장 불필요"
                )

        # 5. 유지 연장 — 유지 구간의 **끝**에서만 스케줄 진행을 멈춘다.
        #    유지 도중에 얼면 원본 스케줄의 남은 유지분이 연장분 위에 그대로
        #    덧붙어 목표 H를 넘긴다. 연장은 스케줄이 다 지나간 뒤에 모자란
        #    만큼만 붙이는 것이다(9-5절: "유지 7분 부족").
        at_hold_end = eff_t + dt >= self._hold_end_t - 1e-9
        extending = (
            phase is Phase.HOLD
            and outer_mode is OuterMode.ACTIVE
            and dt_eq > 0
            and at_hold_end
        )
        if extending:
            self.hold_credit_s += dt

        power_w = self._inner_power(setpoint_c, sensor_c, slope)

        message = (
            f"[{phase.value}] 설정 {setpoint_c:.1f}℃ / 센서 {sensor_c:.1f}℃ → "
            f"{power_w:.0f}W. {outer_text}. "
            f"{'유지를 연장하는 중이다. ' if extending else ''}"
            f"H_s는 **센서 기준**이다 — 기물 온도는 관측하지 않는다(9-3절). "
            f"{self.e_note}"
        )
        return ControlDecision(
            power_w=power_w,
            phase=phase,
            outer_mode=outer_mode,
            hold_extension_s=dt_eq,
            message=message,
            paused=False,
        )

    # ─── 진단 ────────────────────────────────────────────────────────────
    @property
    def peak_rate_per_s(self) -> float:
        """최고온에서의 열일 축적률 exp(−E/(R·T_peak)) [1/s] — Δt_eq의 분모."""
        return math.exp(-self.E / (R_GAS * (self.peak_c + 273.15)))
