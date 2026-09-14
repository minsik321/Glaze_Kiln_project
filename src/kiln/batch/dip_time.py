"""06절 · 배치와 비중 — 6-1절 담금시간 역산.

두께를 결정하는 미지수는 비중과 담금시간 둘인데 목표(원하는 두께)는
하나뿐이다. 동시에 역산하면 방정식 하나에 미지수 둘이라 해가 무수히
많다 — 예를 들어 "1.2mm를 원한다"는 조건은 (비중 1.40, 12초)로도
(비중 1.48, 6초)로도 만족된다. 그래서 **비중을 지금 통에 있는 값으로
고정하고, 담금시간만 역산**한다. 실무적으로도 이쪽이 맞다: 이미 개어둔
유약통의 비중을 지금 바꾸는 것보다 "지금 이 통으로 몇 초 담그면 되는가"가
현장에서 필요한 답이다.
"""

from __future__ import annotations

from dataclasses import dataclass

from kiln import constants
from kiln.batch.density import g_rho

__all__ = ["DipRecommendation", "recommend_dip_time"]


@dataclass(frozen=True, slots=True)
class DipRecommendation:
    """6-1절 담금시간 역산 결과."""

    #: 권장 담금시간 [s]. ``feasible=False`` 면 의미 없는 값(0.0)이다.
    seconds: float
    #: 위 담금시간으로 예상되는 평균 두께 [mm] (흘러내림층 포함)
    predicted_mean_mm: float
    feasible: bool
    #: 실행 불가 사유(한국어). 가능하면 빈 문자열.
    reason: str


def recommend_dip_time(
    target_mm: float,
    *,
    rho: float,
    absorption: float,
    k1: float | None = None,
    t_flow_mm: float = 0.0,
) -> DipRecommendation:
    """t_dip = [(t_목표 − t_flow) / (k1·흡수율·g(ρ))]² (6-1절).

    비중 ``rho`` 는 상수로 고정하고 담금시간만 뒤집는다(위 모듈 docstring
    참고 — 미지수 둘에 목표 하나면 해가 무수히 많고, 실무에서 필요한 답도
    "이 비중으로 몇 초인가"다). ``t_flow_mm`` 는 위치 무관 흡수층과 달리
    경사각에 의존하는 흘러내림층 두께로, 호출부(예: 특정 부위의 예상
    두께를 맞추고 싶을 때)가 :mod:`kiln.thickness.geometry`/`profile` 로
    미리 계산해 넘긴다. 여기서는 그 값을 상수로만 다룬다.

    **도메인 가드**: ``target_mm <= t_flow_mm`` 이면 흘러내림층 하나만으로
    이미 목표를 채우거나 넘는다는 뜻이라, 괄호 안이 0 이하가 되어 제곱해도
    다시 양수가 되는 함정(음수를 제곱해 "해가 있는 것처럼" 보이는 사고)에
    빠진다. 그런 해는 담금시간의 의미를 갖지 않으므로 제곱하지 않고
    ``feasible=False`` 와 사유를 반환한다.
    """
    k1_val = k1 if k1 is not None else constants.get("k1").value
    denom = k1_val * absorption * g_rho(rho)

    if target_mm <= t_flow_mm:
        return DipRecommendation(
            seconds=0.0,
            predicted_mean_mm=t_flow_mm,
            feasible=False,
            reason=(
                f"흘러내림층만으로 이미 {t_flow_mm:.3f}mm이며 목표 "
                f"{target_mm:.3f}mm 이상이다. 이 비중으로는 어떤 담금시간을 "
                "택해도 목표에 도달할 수 없다 — 비중을 낮추거나 목표를 "
                "재검토해야 한다."
            ),
        )

    if denom <= 0:
        return DipRecommendation(
            seconds=0.0,
            predicted_mean_mm=t_flow_mm,
            feasible=False,
            reason=(
                "k1·흡수율·g(ρ)가 0 이하라 담금시간을 역산할 수 없다. "
                "계수 또는 비중 입력을 확인하라."
            ),
        )

    seconds = ((target_mm - t_flow_mm) / denom) ** 2
    predicted_mean_mm = t_flow_mm + denom * (seconds**0.5)
    return DipRecommendation(
        seconds=seconds,
        predicted_mean_mm=predicted_mean_mm,
        feasible=True,
        reason="",
    )
