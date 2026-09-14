"""9-6절 · 냉각 제어의 물리적 범위 — 자연냉각률이 상한이다.

**전기가마는 서냉만 제어 가능하고 급냉은 제어 대상이 아니다.** 가마가
할 수 있는 일은 열을 더 넣는 것뿐이라, 자연냉각보다 빠르게 식히는 방법이
없다. 그래서 요청 냉각률이 자연냉각률을 넘으면 **거부**하고 사유를
``rejections`` 에 적는다. UI는 자연냉각률 곡선을 배경으로 깔고 그 아래만
선택 가능하게 한다(9-6절).

9-6절 예제(30L 가마, C=58 kJ/K, 1220℃ 유지전력 2.5kW로 UA 역산):

    자연냉각률(제어 상한)  1220℃ 155 / 1000℃ 127 / 800℃ 101 / 600℃ 75  [℃/h]

    결정 성장 구간 1100→900℃ 서냉 비용
       126 ℃/h   1.6h   자연냉각, 추가전력 0
        80 ℃/h   2.5h   평균  751W    +1.9 kWh
        50 ℃/h   4.0h   평균 1234W    +4.9 kWh
        30 ℃/h   6.7h   평균 1556W   +10.4 kWh

*선형 UA 근사는 고온 복사 손실을 과소평가한다. 실제 자연냉각률은 이보다
빠를 수 있다. 상대 비교용으로만 쓴다*(9-6절 각주, 부록 A).

**냉각을 H로 환산하지 않는다** (9-4절, 부록 E). H는 급냉과 서냉을 구분하지
못한다 — 급냉(310℃/h)+1220℃ 유지 49분과 서냉(77.5℃/h)+유지 15분이 같은
H를 낸다. 결정 석출은 특정 온도대의 **체류 시간**이 결정하므로 냉각은
온도–시간 곡선 그대로 다룬다. 그래서 이 모듈은
:mod:`kiln.firing.heatwork` 를 **쓰지 않는다**.

**573℃ 석영 전이 구간은 별도 세그먼트로 나눈다** (9-6절). 빠르게 통과하면
소지가 균열되고, 목적이 결정 성장 구간과 다르다. 한 세그먼트가 573℃를
가로지르면 거부하고 분리를 요구한다. *573℃ 구간의 허용 냉각률 자체는
부록 B 미해결 항목이라 임계를 정하지 않는다 — 분리만 강제한다.*
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from kiln.domain.models import (
    QUARTZ_INVERSION_C as _QUARTZ_INVERSION_C,
    CoolingSegment,
    KilnProfile,
)

__all__ = [
    "AMBIENT_C",
    "QUARTZ_INVERSION_C",
    "CoolingSegment",
    "CoolingPlan",
    "natural_cooling_hours",
    "plan_cooling",
]

#: 주위 온도 기본값 [℃]. 실제로는 ``KilnProfile.ambient_c`` 를 쓴다 —
#: 자연냉각률 역산과 서냉 비용이 **같은** 주위 온도를 써야 9-6절 표와
#: 비용 계산이 어긋나지 않기 때문이다. 이 상수는 프로필 없이 온도를
#: 이야기해야 하는 자리(예: 처방 변환의 승온 시작점)의 기본값이다.
AMBIENT_C = 20.0

#: 석영 α↔β 전이 온도 [℃] (9-6절). :mod:`kiln.domain.models` 에서 재수출한다.
QUARTZ_INVERSION_C = _QUARTZ_INVERSION_C

#: 자연냉각률 적분의 구간 분할 수. 자연냉각률은 온도에 대해 완만하므로
#: 200분할이면 사다리꼴 오차가 0.01% 아래다.
_NATURAL_STEPS = 200


@dataclass(frozen=True, slots=True)
class CoolingPlan:
    """냉각 계획 판정 결과 (9-6절).

    ``extra_hours`` / ``extra_kwh`` 는 **되돌림 비용**이다. 08절이 재시유
    선택지에 "건조 4시간 재소요"를 병기하는 것과 같은 원칙으로, 서냉을
    고르면 무엇을 지불하는지 같은 화면에 적는다(9-6절).
    """

    segments: tuple[CoolingSegment, ...]
    #: 모든 세그먼트가 물리적 범위 안이고 573℃가 분리되어 있는가
    feasible: bool
    #: 거부 사유. 비어 있으면 ``feasible=True``
    rejections: tuple[str, ...]
    #: 자연냉각 대비 **추가로** 드는 시간 [h] (서냉 비용)
    extra_hours: float
    #: 서냉을 유지하기 위해 추가로 넣는 전력량 [kWh]
    extra_kwh: float
    #: 근사의 한계·출처를 나르는 문구 (00절 공통 규칙 1)
    provenance_notes: tuple[str, ...] = ()

    @property
    def total_hours(self) -> float:
        """냉각 전체 소요 시간 [h] (자연냉각분 포함)."""
        return sum(s.hours for s in self.segments if s.rate_c_per_h > 0)


def natural_cooling_hours(profile: KilnProfile, from_c: float, to_c: float) -> float:
    """자연냉각만으로 ``from_c`` → ``to_c`` 를 지나는 데 걸리는 시간 [h].

    자연냉각률은 온도에 따라 변하므로(9-6절 표: 1220℃ 155 → 600℃ 75) 단순히
    ``폭/율`` 로는 안 되고 ``∫dT/rate(T)`` 를 적분해야 한다. 9-6절 예제
    1100→900℃가 "126℃/h·1.6h"로 적힌 것도 이 적분의 평균률이다
    (구간 양 끝의 자연냉각률은 139.7과 113.8℃/h로 서로 다르다).

    도메인 가드
        - ``from_c <= to_c`` 면 냉각 구간이 아니므로 :class:`ValueError`.
        - 구간 안에서 자연냉각률이 0 이하가 되면(주위 온도에 닿음)
          :class:`ValueError` — 유한 시간에 도달하지 못한다.
    """
    if from_c <= to_c:
        raise ValueError(
            f"냉각 구간이 아니다: {from_c}℃ → {to_c}℃ (시작이 종료보다 높아야 한다)"
        )
    step = (from_c - to_c) / _NATURAL_STEPS
    total = 0.0
    for i in range(_NATURAL_STEPS + 1):
        temp = from_c - i * step
        rate = profile.natural_cooling_rate(temp)
        if rate <= 0:
            raise ValueError(
                f"{temp:.0f}℃에서 자연냉각률이 {rate:.3f}℃/h다. "
                "주위 온도에 닿아 유한 시간에 도달하지 못한다"
            )
        weight = 0.5 if i in (0, _NATURAL_STEPS) else 1.0
        total += weight * step / rate
    return total


def _sustain_power_w(profile: KilnProfile, mean_c: float, rate_c_per_h: float) -> float:
    """평균 온도 ``mean_c`` 에서 ``rate_c_per_h`` 서냉을 유지하는 데 드는 전력 [W].

    ``P = UA·(T−T_amb) − C·(냉각률)`` — 벽으로 새는 열 중 냉각에 쓰고 남는
    만큼을 열선이 되메운다. 자연냉각률에서는 0이 되고(9-6절 "추가전력 0"),
    느리게 식힐수록 커진다.
    """
    loss_w = profile.ua * max(mean_c - profile.ambient_c, 0.0)
    removed_w = profile.heat_capacity * rate_c_per_h / 3600.0
    return max(loss_w - removed_w, 0.0)


def plan_cooling(
    profile: KilnProfile, segments: Sequence[CoolingSegment]
) -> CoolingPlan:
    """냉각 계획을 자연냉각률 상한에 대고 검사한다 (9-6절).

    세그먼트마다 다음을 본다.

    1. **방향·율 가드** — ``from_c <= to_c`` 이거나 냉각률이 0 이하면 거부.
    2. **자연냉각률 상한** — 구간 평균 자연냉각률
       (``폭 / natural_cooling_hours``)을 넘으면 거부한다. 전기가마는
       서냉만 제어 가능하다. 이것이 이 모듈의 핵심 판정이다.
    3. **573℃ 분리** — 석영 전이를 구간 내부에서 가로지르면 거부하고
       세그먼트를 나누라고 적는다(9-6절).
    4. **출력 한계** — 서냉 유지에 필요한 전력이 ``profile.max_power`` 를
       넘으면 거부한다. 물리적 상한 아래여도 이 가마로는 못 한다.

    비용은 08절 되돌림 비용과 같은 원칙으로 항상 병기한다:
    ``extra_hours`` 는 자연냉각 대비 **추가** 시간, ``extra_kwh`` 는 서냉을
    유지하려 추가로 넣는 전력량이다.

    도메인 가드: 세그먼트가 비면 ``feasible=False`` 와 사유를 낸다 —
    빈 계획을 "문제 없음"으로 통과시키면 냉각을 지정하지 않은 회차가
    조용히 승인된다.
    """
    rejections: list[str] = []
    notes: list[str] = [
        "9-6절 각주: 선형 UA 근사는 고온 복사 손실을 과소평가한다. "
        "실제 자연냉각률은 이보다 빠를 수 있으므로 상대 비교용으로만 쓴다 (부록 A)",
        "9-4절: 냉각은 H로 환산하지 않는다. H는 급냉과 서냉을 구분하지 못한다",
    ]

    if not segments:
        return CoolingPlan(
            segments=(),
            feasible=False,
            rejections=(
                "냉각 세그먼트가 비어 있다. 9-6절은 냉각을 최소 두 구간"
                "(결정 성장 구간 · 573℃ 석영 전이 통과)으로 명시할 것을 요구한다",
            ),
            extra_hours=0.0,
            extra_kwh=0.0,
            provenance_notes=tuple(notes),
        )

    extra_hours = 0.0
    extra_kwh = 0.0

    for idx, seg in enumerate(segments, start=1):
        tag = f"세그먼트 {idx}({seg.from_c:.0f}→{seg.to_c:.0f}℃)"

        if seg.from_c <= seg.to_c:
            rejections.append(
                f"{tag}: 냉각 구간이 아니다. 시작 온도가 종료 온도보다 높아야 한다"
            )
            continue
        if seg.rate_c_per_h <= 0:
            rejections.append(
                f"{tag}: 냉각률이 {seg.rate_c_per_h}℃/h다. 양수여야 한다 "
                "(0이면 그 온도에 영원히 머문다)"
            )
            continue
        if seg.crosses_quartz_inversion:
            rejections.append(
                f"{tag}: 573℃ 석영 전이를 구간 내부에서 가로지른다. "
                "9-6절은 이 구간을 별도 세그먼트로 분리할 것을 요구한다 — "
                "빠르게 통과하면 소지가 균열되고, 결정 성장 구간과 목적이 다르다"
            )
            continue

        try:
            nat_hours = natural_cooling_hours(profile, seg.from_c, seg.to_c)
        except ValueError as exc:
            rejections.append(f"{tag}: {exc}")
            continue

        nat_rate = seg.span_c / nat_hours
        if seg.rate_c_per_h > nat_rate * (1.0 + 1e-9):
            rejections.append(
                f"{tag}: 요청 {seg.rate_c_per_h:.1f}℃/h가 자연냉각률 상한 "
                f"{nat_rate:.1f}℃/h를 넘는다. 9-6절 — 전기가마는 서냉만 제어 "
                "가능하고 급냉은 제어 대상이 아니다. 가마는 열을 넣을 수만 있다"
            )
            continue

        hours = seg.hours
        mean_c = (seg.from_c + seg.to_c) / 2.0
        power_w = _sustain_power_w(profile, mean_c, seg.rate_c_per_h)
        if power_w > profile.max_power:
            rejections.append(
                f"{tag}: 서냉 유지에 평균 {power_w:.0f}W가 필요한데 가마 최대 "
                f"출력은 {profile.max_power:.0f}W다. 이 가마로는 이 냉각률을 "
                "유지할 수 없다"
            )
            continue

        extra_hours += max(hours - nat_hours, 0.0)
        extra_kwh += power_w * hours / 1000.0
        notes.append(
            f"{tag} {seg.purpose or '목적 미기재'}: {seg.rate_c_per_h:.0f}℃/h · "
            f"{hours:.2f}h (자연냉각 {nat_hours:.2f}h) · 평균 {power_w:.0f}W · "
            f"+{power_w * hours / 1000.0:.2f} kWh"
        )

    lowest = min(s.to_c for s in segments)
    highest = max(s.from_c for s in segments)
    on_boundary = any(
        abs(s.from_c - QUARTZ_INVERSION_C) < 1e-9
        or abs(s.to_c - QUARTZ_INVERSION_C) < 1e-9
        for s in segments
    )
    if highest > QUARTZ_INVERSION_C > lowest and not on_boundary:
        notes.append(
            "573℃가 세그먼트 경계에 놓여 있지 않다. 9-6절은 석영 전이를 "
            "별도 구간으로 다루기를 요구한다 — 경계를 573℃에 맞추는 편이 안전하다"
        )

    return CoolingPlan(
        segments=tuple(segments),
        feasible=not rejections,
        rejections=tuple(rejections),
        extra_hours=extra_hours,
        extra_kwh=extra_kwh,
        provenance_notes=tuple(notes),
    )
