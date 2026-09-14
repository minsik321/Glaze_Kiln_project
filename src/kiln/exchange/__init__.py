"""kiln.exchange — 10-3절 · 처방 발행과 변환.

**구현 제외, 기재 유지.** 개인 1대 범위이므로 발행은 스키마만, 수신 변환은
데모다(10-3절). 그래도 설계를 코드로 남기는 이유는 v5가 여기서 대비축을
틀렸기 때문이다 — "온도는 가마 의존, 열일은 가마 독립"은 성립하지 않는다.
E가 주어지면 H(t)와 T(t)는 일대일 변환이라 정보량이 같다. 실제 구분은
**설정 스케줄 vs 달성 열이력**이다.

공유 단위는 **H_s(승온·유지) + 냉각 온도 곡선**이고, 냉각은 H에 합산하지
않는다. 그리고 변환은 **비대칭**이다 — 대상 가마의 자연냉각률이 원본보다
느리면 재현 불가다.

:mod:`kiln.firing` 에 의존한다 (docs/INTERFACES.md 의존 방향).
"""

from kiln.exchange.prescription import (
    Prescription,
    TransformResult,
    equivalent_hold_at,
    issue,
    transform,
)

__all__ = [
    "Prescription",
    "TransformResult",
    "equivalent_hold_at",
    "issue",
    "transform",
]
