"""kiln.risk — 08절 · 위험 판정.

**가마에 들어가기 전이 되돌릴 수 있는 마지막 지점이다.** 07절이 낸 두께
분포를 받아 위험 5종을 등급으로 매기고(:mod:`kiln.risk.findings`), 되돌림
비용을 병기한 대응 선택지를 붙인다(:mod:`kiln.risk.options`).

이 모듈이 지키는 두 문장:

- 판정할 수 없으면 「판정 불가」이지 「없음」이 아니다 (8-2절).
- 어떤 선택지에도 확정 기호를 붙이지 않는다 (8-4절).

:mod:`kiln.thickness` 에 의존하고, 이 모듈에 의존하는 상위 모듈은 없다
(docs/INTERFACES.md 의존 방향 — 안쪽 루프의 마지막 판단 지점이다).
"""

from kiln.risk.assess import RiskAssessment, assess
from kiln.risk.findings import DEFAULT_SAFE_RANGE_MM, RiskFinding, evaluate_findings
from kiln.risk.options import ReversalOption, reversal_options

__all__ = [
    "DEFAULT_SAFE_RANGE_MM",
    "RiskFinding",
    "evaluate_findings",
    "ReversalOption",
    "reversal_options",
    "RiskAssessment",
    "assess",
]
