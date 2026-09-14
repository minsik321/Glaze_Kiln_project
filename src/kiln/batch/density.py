"""06절 · 배치와 비중 — 6-2 · 6-3 · 6-4절.

비중이 두께 산출에 관여하는 두 경로(6-2절)와, 측정 이벤트를 평가해
사용자에게 안내하는 판정(6-4절)을 담는다. 담금시간 역산(6-1절)은
:mod:`kiln.batch.dip_time` 이 맡는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from kiln import constants
from kiln.domain.models import DensityMeasurement

__all__ = [
    "DensityStatus",
    "DensityAdvice",
    "assess_density",
    "g_rho",
    "m_rho",
]

#: 6-4절 "화면의 권장 범위 수치에는 (문헌 추정 초기값 · 캘리브레이션 전)을
#: 병기한다" — 대상 범위(target)와 재측정 임계(settling_limit_min) 자체가
#: 캘리브레이션 이전의 문헌 추정값이라는 뜻. Coefficient.annotation()과
#: 문구를 맞춘다.
_LITERATURE_ANNOTATION = "(문헌 추정 초기값 · 캘리브레이션 전)"

#: ρ=1.45 부근에서 g(ρ), m(ρ)를 1.0으로 정규화하는 기준점 (부록 C).
_RHO_REFERENCE = 1.45


class DensityStatus(Enum):
    """6-4절 경고 분기 — 표의 네 행."""

    OK = "정상"
    TOO_THICK = "범위 초과(되직)"
    TOO_THIN = "범위 미달(묽음)"
    OUT_OF_RANGE = "극단적 이탈"


@dataclass(frozen=True, slots=True)
class DensityAdvice:
    """6-4절 판정 결과. 경고가 떠도 진행을 막지 않는다."""

    status: DensityStatus
    #: 6-4절 안내 문구
    message: str
    #: "(문헌 추정 초기값 · 캘리브레이션 전)"
    annotation: str
    #: 항상 False — 경고가 떠도 진행을 막지 않는다 (6-4절)
    blocks_progress: bool
    remeasure_recommended: bool


def g_rho(rho: float, *, exponent: float | None = None) -> float:
    """g(ρ) — 비중의 흡수 기여 (6-2절, 7-1절 t_abs 항).

    ``t_abs = k1·√(담금시간)·흡수율·g(ρ)`` 에 들어가는 단조증가 함수다.
    부록 C: "함수형 미정 — 멱함수로 잠정". 멱함수 ``(ρ/1.45)^exponent`` 로
    두면 파라미터 1개로 단조성과 정규화(ρ=1.45에서 1.0)를 동시에 만족한다.

    ``exponent`` 를 생략하면 :func:`kiln.constants.get` 의 ``g_rho`` 초기값을
    쓴다(문헌 추정, 캘리브레이션 전).
    """
    exp = exponent if exponent is not None else constants.get("g_rho").value
    return (rho / _RHO_REFERENCE) ** exp


def m_rho(rho: float, *, exponent: float | None = None) -> float:
    """m(ρ) — 비중의 흘러내림 기여 (6-2절 수정, 7-1절 t_flow 항).

    v5는 비중을 흡수층(t_abs)에만 넣었다. 물리적으로는 반대 경로도 있다 —
    고형분이 오르면 항복응력이 급격히 올라 흘러내리는 막 자체가 두꺼워진다.
    v5 본문이 "되직 → 두껍게 붙어 흘러내림 위험"이라고 서술해놓고 수식에는
    그 경로가 없던 모순을 이 함수가 메운다:
    ``t_flow = k2·m(ρ)·sinθ(z)·(h_max−z)/h_max``.

    :func:`g_rho` 와 같은 멱함수 형태를 쓰되 지수는 별도 계수
    (``m_rho``, 부록 C: "파라미터 1개짜리 단조증가 함수")로 독립 캘리브레이션한다.
    ``exponent`` 를 생략하면 :func:`kiln.constants.get` 의 ``m_rho`` 초기값을 쓴다.
    """
    exp = exponent if exponent is not None else constants.get("m_rho").value
    return (rho / _RHO_REFERENCE) ** exp


def assess_density(
    m: DensityMeasurement,
    *,
    target: tuple[float, float] = (1.40, 1.50),
    settling_limit_min: float = 10.0,
) -> DensityAdvice:
    """6-4절 경고 분기 + 6-3절 재측정 권고.

    ``target`` 바깥이지만 아직 "극단"은 아닌 구간을 되직/묽음으로 나누고,
    ``target`` 폭의 두 배를 넘어서면(6-4절 "모델 적용 범위 밖") 극단적
    이탈로 본다 — 이 배수 자체가 문헌 추정 관행값이며 실측으로 좁혀질
    항목이다(부록 C에는 명시적 행이 없으나 안전 두께 범위와 같은 성격).

    **경고가 떠도 진행을 막지 않는다** — :attr:`DensityAdvice.blocks_progress`
    는 어떤 분기에서도 항상 ``False`` 다.

    6-3절: 비중은 배치가 아니라 순간에 귀속된다. 교반 후 경과 시간이
    ``settling_limit_min`` 을 넘으면, 지금 값이 판정상 OK여도 재측정을
    권고한다 — 침강이 진행 중이면 재고 나서 담그는 사이에 이미 달라진다.
    """
    lo, hi = target
    band = hi - lo
    extreme_lo = lo - band
    extreme_hi = hi + band
    rho = m.specific_gravity

    if lo <= rho <= hi:
        status = DensityStatus.OK
        message = "비중이 권장 범위 안이다."
    elif extreme_lo <= rho < lo:
        status = DensityStatus.TOO_THIN
        message = (
            "비중이 권장 범위보다 낮다(고형분 부족) — 얇게 붙고 편차가 커질 "
            "수 있다. 가라앉힌 뒤 위 맑은 물을 따라내고 재측정을 권장한다."
        )
    elif hi < rho <= extreme_hi:
        status = DensityStatus.TOO_THICK
        message = (
            "비중이 권장 범위보다 높다(고형분 과다) — 두껍게 붙고 흘러내림 "
            "위험이 있다. 물을 소량 추가한 뒤 재측정을 권장한다."
        )
    else:
        status = DensityStatus.OUT_OF_RANGE
        message = (
            "비중이 모델 적용 범위를 크게 벗어났다 — 예측 신뢰도가 낮다. "
            "그대로 진행할지 확인하라."
        )

    settled_too_long = m.minutes_since_stirring > settling_limit_min
    remeasure_recommended = status is not DensityStatus.OK or settled_too_long
    if settled_too_long and status is DensityStatus.OK:
        message += (
            f" 교반 후 {m.minutes_since_stirring:.0f}분 경과 — 침강이 진행됐을 "
            "수 있어 재측정을 권장한다."
        )

    return DensityAdvice(
        status=status,
        message=message,
        annotation=_LITERATURE_ANNOTATION,
        blocks_progress=False,
        remeasure_recommended=remeasure_recommended,
    )
