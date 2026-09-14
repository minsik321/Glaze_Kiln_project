"""9-3 · 9-5절 — 열일 H_s 와 등가 유지시간 Δt_eq.

    H_s(t) = ∫₀ᵗ exp( −E / (R · T_s(τ)) ) dτ

**T는 센서 온도다.** 9-3절이 이 정의를 못 박은 이유: v5는 T가 무엇인지 쓰지
않았다. 센서 온도라면 9-1절 ①("컨트롤러는 벽 센서 하나로 판단하지만 기물이
받은 열은 다르다")이 스스로 부정한 값이고, 기물 온도라면 실물에서 관측
불가다. 시뮬레이터에서는 노드 온도가 다 있으니 돌아가지만 그건 관측 문제를
회피한 것이다. 그래서 본 모듈은 **센서 기준 H_s** 만 계산하고,
기물–센서 오프셋은 가마 프로필의 캘리브레이션 대상으로 남긴다
(``constants.get("sensor_offset")`` — 부록 C 미정).
**"기물이 받은 열을 직접 제어한다"고 주장하지 않는다.**

**Δt_eq 를 쓰고 e_H 를 쓰지 않는 이유** (9-5절, 부록 E #3):
H는 거의 전부 최상단에서 쌓인다. 100℃/h·1220℃ 소성(20℃ 출발, 총 12.25h)에서

    6h(620℃) 0.00%   8h(820℃) 0.01%   10h(1020℃) 1.26%   11h(1120℃) 10.75%

즉 H의 90%가 마지막 1.29시간에 누적된다. 3시간 시점의 H_목표는 0에 붙어
있어 **상대오차 `e_H = (H목표−H실제)/H목표` 의 분모로 쓸 수 없다** — 소성 앞
80% 구간에서 0으로 나눈다. 대신 부족분을 최고온 기준 **초 단위 등가 유지시간**
으로 환산한다:

    Δt_eq = (H_목표 − H_실제) / exp(−E/(R·T_peak))      [s]

**냉각은 여기 들어오지 않는다** (9-4·10-3절, 부록 E). H는 급냉과 서냉을
구분하지 못한다 — 부록 E의 예시에서 급냉(310℃/h)+유지 49분과
서냉(77.5℃/h)+유지 15분이 같은 H를 낸다. 결정 석출을 결정하는 것은 특정
온도대의 체류 시간이므로 냉각은 :mod:`kiln.firing.cooling` 이 온도–시간
곡선 그대로 다룬다.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from kiln import constants

__all__ = [
    "R_GAS",
    "AssumedE",
    "assume_E",
    "heat_work",
    "heat_work_curve",
    "equivalent_hold_seconds",
]

#: 기체 상수 R [J/(mol·K)] — CODATA 정의값.
R_GAS = 8.314462618

#: 한 구간 안에서 지수 φ = −E/(R·T) 가 이만큼 변할 때마다 세분한다.
#: exp(φ) 는 온도에 대해 극단적으로 볼록해서 성긴 사다리꼴 적분이 크게 틀린다.
#: Δφ ≤ 0.02 면 구간별 사다리꼴 상대오차가 Δφ²/12 ≈ 3e-5 이하다.
_MAX_PHI_STEP = 0.02

#: 구간당 세분 상한. 병적인 입력에서 무한 루프를 막는다.
_MAX_SUBSTEPS = 4096

_ABS_ZERO_C = -273.15


@dataclass(frozen=True, slots=True)
class AssumedE:
    """가정된 활성화 에너지 E 와 그 사실을 나르는 출처 문구 (부록 C).

    E는 부록 C에서 **값 기재 금지**로 표시된 미정 계수다
    (``constants.get("E").value`` 는 :class:`~kiln.constants.UndeterminedCoefficientError`
    를 던진다). 그런데 H를 계산하려면 숫자가 필요하다. 그래서 값을 쓰려면
    반드시 :func:`assume_E` 를 거치게 하고, 그 결과가 **가정이었다는 사실을
    문자열로 함께 들고 다니게** 한다. 조용한 기본값을 두면 부록 C가
    명세서 실시가능성의 근거가 되는 구조 자체가 무너진다.
    """

    #: 가정한 값 [J/mol]
    value: float
    #: 결과의 ``provenance_notes`` / ``message`` 에 그대로 실릴 문구
    note: str


def assume_E(value: float, reason: str) -> AssumedE:
    """부록 C 미정 계수 E에 가정값을 세우고 출처 문구를 함께 만든다.

    ``constants.get("E").assume()`` 를 거치므로 대장에 등록된 동정 절차
    (콘의 승온율별 도달온도 쌍에서 역산, 10-3절)와 문헌 범위가 함께 검증된다.
    범위(부록 C: 200~400 kJ/mol)를 벗어나면 문구에 그 사실이 덧붙는다 —
    막지는 않는다. 민감도 스윕이 범위 밖을 훑는 것은 정상 사용이기 때문이다.
    """
    if value <= 0:
        raise ValueError(f"활성화 에너지 E는 양수여야 한다: {value}")
    coeff = constants.get("E").assume(value, reason)
    note = f"E={value:.4g} J/mol {coeff.annotation()} — 부록 C 미정값, {reason}"
    if coeff.lower is not None and value < coeff.lower:
        note += f" · 부록 C 추정 범위({coeff.lower:.0f}~{coeff.upper:.0f}) 하한 밖"
    elif coeff.upper is not None and value > coeff.upper:
        note += f" · 부록 C 추정 범위({coeff.lower:.0f}~{coeff.upper:.0f}) 상한 밖"
    return AssumedE(value=coeff.value, note=note)


def _rate(temp_c: float, E: float) -> float:
    """순간 열일 축적률 exp(−E/(R·T_s)) [1/s]. T_s는 **센서 온도** [℃]."""
    if temp_c <= _ABS_ZERO_C:
        raise ValueError(
            f"센서 온도 {temp_c}℃는 절대영도({_ABS_ZERO_C}℃) 이하다. "
            "열전대 단선·오배선을 의심하라 (9-7절 공통 안전 장치)"
        )
    return math.exp(-E / (R_GAS * (temp_c + 273.15)))


def _segment_heat_work(t0: float, T0: float, t1: float, T1: float, E: float) -> float:
    """한 구간의 열일. 구간 안에서 온도가 선형이라고 보고 세분 적분한다."""
    span = t1 - t0
    if span == 0.0:
        return 0.0
    phi0 = -E / (R_GAS * (T0 + 273.15))
    phi1 = -E / (R_GAS * (T1 + 273.15))
    n = int(min(max(math.ceil(abs(phi1 - phi0) / _MAX_PHI_STEP), 1), _MAX_SUBSTEPS))
    h = span / n
    total = 0.5 * (math.exp(phi0) + math.exp(phi1))
    for i in range(1, n):
        w = i / n
        total += _rate(T0 + w * (T1 - T0), E)
    return total * h


def heat_work(curve: Sequence[tuple[float, float]], E: float) -> float:
    """센서 기준 누적 열일 H_s = ∫exp(−E/(R·T_s))dτ (9-3절).

    ``curve`` 는 ``(시각[s], 센서온도[℃])`` 의 점열이며 시각은 비감소여야 한다.
    점 사이의 온도는 선형으로 보간하고, 지수의 볼록성 때문에 구간마다
    자동으로 세분해 적분한다(성긴 사다리꼴은 승온 구간에서 크게 틀린다).

    ``E`` 는 부록 C **미정** 계수다. 호출부는 :func:`assume_E` 로 가정을
    세우고 그 ``note`` 를 결과에 실어야 한다 — 이 함수는 float만 받으므로
    출처를 붙일 자리가 없다.

    도메인 가드
        - 점이 2개 미만이면 적분할 구간이 없으므로 ``0.0``.
        - 시각이 감소하면 :class:`ValueError` (역행하는 시간 축).
        - 센서 온도가 절대영도 이하면 :class:`ValueError`.
        - ``E <= 0`` 이면 :class:`ValueError`.

    **냉각 구간을 이 함수에 넣지 마라.** H는 급냉과 서냉을 구분하지 못한다
    (9-4절). 냉각은 :func:`kiln.firing.cooling.plan_cooling` 이 온도–시간
    곡선 그대로 다룬다.
    """
    if E <= 0:
        raise ValueError(f"활성화 에너지 E는 양수여야 한다: {E}")
    if len(curve) < 2:
        return 0.0

    total = 0.0
    prev_t, prev_T = curve[0]
    _rate(prev_T, E)  # 첫 점의 온도 가드
    for t, temp in curve[1:]:
        if t < prev_t:
            raise ValueError(
                f"곡선의 시각이 감소했다: {prev_t}s → {t}s. "
                "(시각[s], 센서온도[℃]) 점열은 시간 순서여야 한다"
            )
        _rate(temp, E)
        total += _segment_heat_work(prev_t, prev_T, t, temp, E)
        prev_t, prev_T = t, temp
    return total


def heat_work_curve(
    curve: Sequence[tuple[float, float]], E: float
) -> tuple[tuple[float, float], ...]:
    """누적 H_s 곡선 ``(시각[s], 누적 H)`` — 9-5절 누적 비율 표시용.

    "H의 90%가 마지막 1.29시간에 누적된다"(9-5절)를 화면에 그리려면 최종
    값 하나가 아니라 누적 곡선이 필요하다. 마지막 점의 값은
    :func:`heat_work` 의 결과와 같다.
    """
    if len(curve) == 0:
        return ()
    if E <= 0:
        raise ValueError(f"활성화 에너지 E는 양수여야 한다: {E}")
    out = [(curve[0][0], 0.0)]
    total = 0.0
    prev_t, prev_T = curve[0]
    _rate(prev_T, E)
    for t, temp in curve[1:]:
        if t < prev_t:
            raise ValueError(f"곡선의 시각이 감소했다: {prev_t}s → {t}s")
        _rate(temp, E)
        total += _segment_heat_work(prev_t, prev_T, t, temp, E)
        out.append((t, total))
        prev_t, prev_T = t, temp
    return tuple(out)


def equivalent_hold_seconds(h_deficit: float, peak_c: float, E: float) -> float:
    """9-5절 Δt_eq = (H_목표 − H_실제)/exp(−E/(R·T_peak))  [초].

    외측 루프 **능동 모드**의 출력이다. 상대오차 ``e_H`` 대신 이 값을 내는
    이유는 모듈 docstring에 적었다 — 소성 앞 80% 구간에서 H_목표가 0에
    붙어 있어 분모로 쓸 수 없기 때문이다. Δt_eq 는 분모에 H가 없고
    ``exp(−E/(R·T_peak))`` 라는 **0이 아닌 상수**만 있으므로 소성 전 구간에서
    정의된다.

    화면에는 "유지 7분 부족" 형태로 표시한다(9-5절).

    도메인 가드
        - ``h_deficit <= 0`` 이면 부족분이 없다는 뜻이므로 ``0.0``
          (음수 연장시간은 의미가 없다).
        - ``E <= 0`` 또는 ``peak_c <= 절대영도`` 면 :class:`ValueError`.
    """
    if E <= 0:
        raise ValueError(f"활성화 에너지 E는 양수여야 한다: {E}")
    if peak_c <= _ABS_ZERO_C:
        raise ValueError(f"최고온도 {peak_c}℃가 절대영도 이하다")
    if h_deficit <= 0:
        return 0.0
    return h_deficit / _rate(peak_c, E)
