"""kiln.batch — 06절 · 배치와 비중.

배치 제조 단계에서 사용자가 실제로 하는 일 둘을 담는다.

- 비중을 재고 6-4절 기준으로 판정한다(:mod:`kiln.batch.density`).
- 원하는 두께를 채우기 위한 담금시간을 역산한다(:mod:`kiln.batch.dip_time`).

비중과 담금시간 둘 다 두께에 관여하지만(07절), 이 모듈은 그 둘을
**측정·조작 대상**으로만 다룬다. 비중·담금시간을 받아 실제 두께 분포로
계산하는 것은 :mod:`kiln.thickness` 의 몫이다(모듈 의존 방향:
``batch → thickness``, docs/INTERFACES.md).
"""

from kiln.batch.density import (
    DensityAdvice,
    DensityStatus,
    assess_density,
    g_rho,
    m_rho,
)
from kiln.batch.dip_time import DipRecommendation, recommend_dip_time

__all__ = [
    "DensityStatus",
    "DensityAdvice",
    "assess_density",
    "g_rho",
    "m_rho",
    "DipRecommendation",
    "recommend_dip_time",
]
