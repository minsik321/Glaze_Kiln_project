"""10-3절 · 처방 발행과 변환.

**구현 제외, 기재 유지** — 개인 1대 범위이므로 발행은 스키마만, 수신 변환은
데모다. 다만 설계는 명시한다(10-3절).

이 모듈이 존재하는 이유는 v5의 **대비축이 틀렸기** 때문이다.

    v5: "온도는 가마 의존, 열일은 가마 독립"

E가 주어지면 ``dH/dτ = exp(−E/RT)`` 이므로 H(t)와 T(t)는 **일대일 변환**이다.
정보량이 같으므로 한쪽이 가마 의존이고 다른 쪽이 독립일 수 없다. 실제 구분은
**설정 스케줄 vs 달성 열이력**이고, 공유 단위는 **H_s(승온·유지) + 냉각 온도
곡선**이다.

냉각을 H에 합산하지 않는 이유는 9-4절이 수치로 보여준다 — 급냉 310℃/h에
1220℃ 49분 유지와 서냉 77.5℃/h에 15분 유지가 **같은 H=7801**을 내는데
질감은 정반대다. H는 급냉과 서냉을 구분하지 못한다. 결정 석출은 특정 온도대의
**체류 시간**이 정하므로 냉각은 온도–시간 곡선 그대로 나른다.

그리고 **변환은 비대칭이다.** 대상 가마의 자연냉각률이 원본보다 느리면
재현할 수 없다 — 서냉은 이식 가능하고 급냉은 아닐 수 있다(9-6절: 전기가마는
서냉만 제어 가능하다).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from collections.abc import Sequence

from kiln.domain.models import FiringRun, KilnProfile
from kiln.firing.cooling import AMBIENT_C, CoolingSegment, plan_cooling
from kiln.firing.heatwork import R_GAS, equivalent_hold_seconds, heat_work

__all__ = [
    "Prescription",
    "TransformResult",
    "equivalent_hold_at",
    "issue",
    "transform",
]

_ABS_ZERO_C = -273.15


def _kelvin(temp_c: float) -> float:
    if temp_c <= _ABS_ZERO_C:
        raise ValueError(f"{temp_c}℃가 절대영도 이하다")
    return temp_c - _ABS_ZERO_C


@dataclass(frozen=True, slots=True)
class Prescription:
    """공유 단위 (10-3절).

    **H_s(승온·유지) + 냉각 온도 곡선**이 한 묶음이다. 둘을 하나로 합치면
    (즉 냉각을 H에 더하면) 급냉과 서냉이 구분되지 않는다.

    ``E_assumed`` 를 반드시 싣는 이유: H는 E 없이는 온도로 되돌릴 수 없고,
    E는 부록 C에서 **미정**이다. 수신 측이 다른 E를 쓰면 같은 H가 다른
    온도–시간을 뜻하게 되므로, 발행 측이 어떤 E 위에서 계산했는지가
    처방의 일부여야 한다.
    """

    #: 승온·유지 구간의 센서 기준 누적 열일 H_s [s]
    heat_work_target: float
    #: 최고온도 [℃]
    peak_c: float
    #: 냉각 계획. **온도–시간 그대로**이며 H에 합산하지 않는다 (9-4, 10-3절)
    cooling: tuple[CoolingSegment, ...]
    #: 이 처방을 계산할 때 가정한 활성화 에너지 [J/mol] (부록 C 미정 계수)
    E_assumed: float
    #: 가정·근사·신뢰도 하향 사유 (00절 공통 규칙 1)
    provenance_notes: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class TransformResult:
    """처방을 다른 가마로 옮긴 결과 (10-3절).

    ``feasible=False`` 일 때 ``schedule`` 은 ``None`` 이다. **부분적으로 되는
    스케줄을 내지 않는다** — 냉각 한 구간이 재현되지 않으면 그 처방은 다른
    처방이지 같은 처방이 아니다.
    """

    #: (시각[s], 목표 센서온도[℃]) 점열. 재현 불가면 None
    schedule: tuple[tuple[float, float], ...] | None
    feasible: bool
    #: 재현 불가 사유, 그리고 가능한 경우에도 남는 가정·한계
    reasons: tuple[str, ...]


def equivalent_hold_at(
    hold_seconds: float, *, from_c: float, to_c: float, E: float
) -> float:
    """``from_c`` 에서 ``hold_seconds`` 유지한 것과 같은 H를 내는 ``to_c`` 유지시간 [s].

    10-3절 **E 민감도 표**를 만드는 함수다.

        Δt₂ = Δt₁ · exp[(E/R)·(1/T₂ − 1/T₁)]      (T는 절대온도)

    유지 구간에서는 온도가 일정하므로 ``H = Δt·exp(−E/RT)`` 이고, 두 유지의
    H를 같게 두면 위 식이 나온다. 지수 안에 E가 들어 있으므로 **온도차가
    벌어질수록 E 불확실이 그대로 증폭된다** — 10-3절 표가 보여주는 것이
    그것이다(1220℃ 15분 기준: 1200℃에서는 E 200/400 kJ의 차가 18.7분 대
    23.2분이지만, 1150℃에서는 33.1분 대 73.2분으로 벌어진다).

    **온도차가 작으면 E를 몰라도 되고, 벌어질수록 오차가 그대로 나온다**
    (10-3절). 처방 변환이 같은 가마·비슷한 최고온도 사이에서 가장 안전한
    이유이며, E가 미정인 채로도 이 모듈이 쓸모를 갖는 근거다.
    """
    if E <= 0:
        raise ValueError(f"활성화 에너지 E는 양수여야 한다: {E}")
    if hold_seconds < 0:
        raise ValueError(f"유지시간이 음수다: {hold_seconds}")
    t1 = _kelvin(from_c)
    t2 = _kelvin(to_c)
    return hold_seconds * math.exp((E / R_GAS) * (1.0 / t2 - 1.0 / t1))


def _ramp_and_hold_curve(
    run: FiringRun, peak_c: float
) -> tuple[tuple[tuple[float, float], ...], list[str]]:
    """실측 곡선에서 **승온·유지 부분만** 잘라낸다 (10-3절).

    냉각은 H에 합산하지 않으므로 H를 적분하기 전에 잘라야 한다. 자르는
    지점은 **가마가 마지막으로 최고온도를 떠나는 순간**이다 — 그 뒤는 정의상
    냉각이고, 냉각은 ``Prescription.cooling`` 이 온도–시간으로 따로 나른다.
    """
    notes: list[str] = []
    curve = run.measured or run.schedule
    if not curve:
        return (), ["실측·설정 곡선이 모두 비어 있다 — H를 적분할 자료가 없다"]

    if run.measured:
        notes.append(
            "H는 **달성 열이력**(실측 센서 곡선)에서 적분했다 — 10-3절 대비축은 "
            "설정 스케줄이 아니라 달성 열이력이다"
        )
    else:
        notes.append(
            "실측 곡선이 없어 **설정 스케줄**로 적분했다 — 10-3절이 구분하려는 "
            "두 축 중 약한 쪽이므로 신뢰도를 하향해 읽어야 한다"
        )

    at_peak = [i for i, (_, temp) in enumerate(curve) if temp >= peak_c]
    if at_peak:
        cut = at_peak[-1]
    else:
        cut = max(range(len(curve)), key=lambda i: curve[i][1])
        notes.append(
            f"곡선이 선언된 최고온도 {peak_c:.0f}℃에 도달한 적이 없다 — "
            f"실제 최고 {curve[cut][1]:.0f}℃ 지점에서 잘랐다. "
            "처방의 peak_c와 달성값이 다르므로 수신 측에서 확인이 필요하다"
        )

    if cut == 0:
        notes.append("승온·유지 구간이 한 점뿐이라 H가 0이다 — 처방으로 쓸 수 없다")
    return tuple(curve[: cut + 1]), notes


def issue(
    run: FiringRun,
    *,
    E: float,
    peak_c: float,
    cooling: Sequence[CoolingSegment],
) -> Prescription:
    """소성 회차를 공유 가능한 처방으로 발행한다 (10-3절).

    발행하는 것은 온도 곡선 전체가 아니라 **H_s(승온·유지) + 냉각 온도
    곡선**이다. 승온·유지는 H로 접어도 정보가 보존되지만(같은 E 아래서
    H↔T는 일대일), 냉각은 접으면 **급냉과 서냉이 같은 값이 된다**
    (9-4절: 둘 다 H=7801). 그래서 냉각만 온도–시간 그대로 나른다.

    H는 **달성 열이력**에서 적분한다. ``run.measured`` 가 있으면 그것을,
    없으면 ``run.schedule`` 로 대신하되 그 사실을 ``provenance_notes`` 에
    남긴다 — 10-3절이 갈라놓은 두 축 중 어느 쪽으로 계산했는지가 처방의
    신뢰도를 정하기 때문이다.

    ``E`` 는 호출부가 :func:`kiln.firing.heatwork.assume_E` 로 가정을 세워
    넘긴 값이다. 부록 C에서 E는 미정이므로 그 가정이 ``E_assumed`` 와
    ``provenance_notes`` 에 실려 수신 측까지 간다.
    """
    if E <= 0:
        raise ValueError(f"활성화 에너지 E는 양수여야 한다: {E}")

    curve, notes = _ramp_and_hold_curve(run, peak_c)
    h_target = heat_work(curve, E) if len(curve) >= 2 else 0.0

    notes.append(
        f"E={E:.4g} J/mol 가정 위에서 계산했다 — 부록 C 미정 계수. "
        "수신 측이 다른 E를 쓰면 같은 H가 다른 온도–시간을 뜻한다 (10-3절)"
    )
    notes.append(
        "냉각은 H에 합산하지 않았다 — H는 급냉과 서냉을 구분하지 못한다 "
        "(9-4절: 급냉 310℃/h·49분 유지와 서냉 77.5℃/h·15분 유지가 둘 다 H=7801)"
    )

    return Prescription(
        heat_work_target=h_target,
        peak_c=peak_c,
        cooling=tuple(cooling),
        E_assumed=E,
        provenance_notes=tuple(notes),
    )


def _limiting_ramp_c_per_h(target: KilnProfile, peak_c: float) -> float:
    """대상 가마가 ``peak_c`` 부근에서 낼 수 있는 최대 승온율 [℃/h].

    ``P_max = UA·(T−T_amb) + C·(승온율)`` 을 승온율로 푼 것이다. 최고온도
    부근이 가장 불리하므로 그 지점으로 판정한다 — 여기서 0 이하면 그 가마는
    ``peak_c`` 에 **도달하지 못한다**(넣는 전력이 벽으로 새는 열을 못 이긴다).
    """
    surplus_w = target.max_power - target.ua * (peak_c - AMBIENT_C)
    if target.heat_capacity <= 0:
        return 0.0
    return surplus_w / target.heat_capacity * 3600.0


def transform(p: Prescription, target: KilnProfile) -> TransformResult:
    """처방을 다른 가마의 설정 스케줄로 옮긴다 (10-3절).

    **변환은 비대칭이다.** 대상 가마의 자연냉각률이 원본보다 느리면 재현할
    수 없다 — 전기가마는 서냉만 제어 가능하므로(9-6절) 요청 냉각률이 그
    가마의 자연냉각률을 넘으면 방법이 없다. 서냉은 이식 가능하고 급냉은
    아닐 수 있다는 것이 이 비대칭의 내용이다.

    절차:

    1. **도달 가능성** — ``peak_c`` 에서 최대 출력이 벽체 손실을 이기는가.
       못 이기면 재현 불가.
    2. **냉각 재현 가능성** — :func:`kiln.firing.cooling.plan_cooling` 에
       그대로 맡긴다. 자연냉각률 상한·573℃ 분리·출력 한계를 그쪽이 본다.
    3. **유지시간 역산** — 승온 중 쌓인 H를 빼고 남은 부족분을
       :func:`~kiln.firing.heatwork.equivalent_hold_seconds` 로 최고온도
       기준 초로 환산한다. 이것이 9-5절이 상대오차 대신 쓰는 양이다.

    **승온율은 대상 가마의 물리 상한**(전력이 벽체 손실을 이기고 남는 몫)을
    쓴다. 근거 없는 기본값을 두지 않기 위해서다. 이 선택이 결과를 크게
    바꾸지 않는 이유는 9-5절이 이미 보여줬다 — H의 90%가 마지막 1.29시간에
    쌓이므로 승온 구간이 H에 기여하는 몫은 작고, 승온율을 바꾸면 유지시간이
    그만큼 자동으로 흡수한다. 다만 상한 승온율은 **전력 여유가 0**이라는
    뜻이므로 실제 운전에서는 더 느린 승온을 골라야 하고, 그 사실을
    ``reasons`` 에 남긴다.
    """
    reasons: list[str] = []

    ramp_c_per_h = _limiting_ramp_c_per_h(target, p.peak_c)
    if ramp_c_per_h <= 0:
        reasons.append(
            f"대상 가마 '{target.name}'는 최고온도 {p.peak_c:.0f}℃에 도달하지 못한다 — "
            f"최대 출력 {target.max_power:.0f}W가 그 온도의 벽체 손실 "
            f"{target.ua * (p.peak_c - AMBIENT_C):.0f}W를 이기지 못한다"
        )

    cooling_plan = plan_cooling(target, p.cooling)
    if not cooling_plan.feasible:
        reasons.append(
            "냉각을 재현할 수 없다 — 처방 변환은 비대칭이다(10-3절). "
            "대상 가마의 자연냉각률이 요청 냉각률보다 느리면 서냉으로는 못 따라간다"
        )
        reasons.extend(cooling_plan.rejections)

    if reasons:
        return TransformResult(schedule=None, feasible=False, reasons=tuple(reasons))

    # ── 승온: 주위 온도 → 최고온도
    ramp_seconds = (p.peak_c - AMBIENT_C) / ramp_c_per_h * 3600.0
    ramp_curve = ((0.0, AMBIENT_C), (ramp_seconds, p.peak_c))
    h_ramp = heat_work(ramp_curve, p.E_assumed)

    # ── 유지: 남은 H를 최고온도 기준 초로 환산 (9-5절 Δt_eq와 같은 양)
    hold_seconds = equivalent_hold_seconds(
        p.heat_work_target - h_ramp, p.peak_c, p.E_assumed
    )
    if hold_seconds <= 0:
        reasons.append(
            f"승온만으로 목표 열일을 넘는다 — 대상 가마의 승온이 느려 "
            f"({ramp_c_per_h:.0f}℃/h) 도달 전에 H가 다 쌓인다. 최고온도를 "
            "낮추거나 더 빠른 승온이 가능한 가마여야 한다"
        )
        return TransformResult(schedule=None, feasible=False, reasons=tuple(reasons))

    schedule: list[tuple[float, float]] = [
        (0.0, AMBIENT_C),
        (ramp_seconds, p.peak_c),
        (ramp_seconds + hold_seconds, p.peak_c),
    ]

    # ── 냉각: 온도–시간 그대로 이어 붙인다. H로 접지 않는다 (9-4, 10-3절)
    t = ramp_seconds + hold_seconds
    for segment in cooling_plan.segments:
        t += segment.hours * 3600.0
        schedule.append((t, segment.to_c))

    reasons.append(
        f"승온율은 대상 가마의 물리 상한 {ramp_c_per_h:.0f}℃/h를 썼다 — 근거 없는 "
        "기본값을 두지 않기 위해서다. 전력 여유가 0이라는 뜻이므로 실제 운전은 "
        "더 느린 승온을 골라야 하고, 그만큼 유지시간이 짧아진다"
    )
    reasons.append(
        f"E={p.E_assumed:.4g} J/mol 가정 위의 변환이다 — 원본과 대상의 최고온도가 "
        "벌어질수록 E 불확실이 유지시간에 그대로 증폭된다 (10-3절 민감도 표)"
    )
    reasons.extend(cooling_plan.provenance_notes)

    return TransformResult(
        schedule=tuple(schedule), feasible=True, reasons=tuple(reasons)
    )
