"""kiln.search — 05절 · 조성 탐색.

바깥 루프(회차 사이)의 조성 계층이다. 목표 좌표(04절)를 받아 다음 회차에
걸 배합 후보를 낸다.

    격자 생성   :mod:`kiln.search.grid`      5-2절 단체 격자 · 국소 세분화
    목적함수    :mod:`kiln.search.objective` 5-4절 거리 d와 부수 관측 필터
    사전분포    :mod:`kiln.search.prior`     5-5절 콜드 스타트 · 후보 제시

**이 모듈은 조성 계층 전용이다(5-3절).** 소성 조건은 회차당 1점만
관측되므로 베이지안 최적화·Active Learning·GP를 쓰지 않는다. 그래서
:mod:`kiln.firing` 을 import하지 않으며, 어떤 공개 함수도 최고온·유지시간·
냉각률을 인자로 받지 않는다. 5-3절의 2단계 절차 중 **1단계(소성 조건 고정
→ 조성만 탐색)** 가 여기 구현된 범위다.

의존 방향은 ``domain → chem → search`` 한 방향이다(docs/INTERFACES.md).
"""

from kiln.search.grid import refine, simplex_grid
from kiln.search.objective import (
    Candidate,
    DISQUALIFYING_FAILURES,
    FILTERED_OBSERVATION_KEYS,
    OCCURRENCE_MARKERS,
    objective,
    passes_filter,
)
from kiln.search.prior import (
    DEFAULT_COMPONENTS,
    PRIOR_PSEUDO_COUNT,
    Prior,
    propose,
)

__all__ = [
    "simplex_grid",
    "refine",
    "Candidate",
    "objective",
    "passes_filter",
    "DISQUALIFYING_FAILURES",
    "FILTERED_OBSERVATION_KEYS",
    "OCCURRENCE_MARKERS",
    "Prior",
    "propose",
    "PRIOR_PSEUDO_COUNT",
    "DEFAULT_COMPONENTS",
]
