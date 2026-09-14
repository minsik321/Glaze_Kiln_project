"""11절 · 데이터 모델과 공용 열거형.

다른 모든 모듈이 여기에 의존한다. 여기는 아무 데도 의존하지 않는다
(constants 제외). 계산 로직을 두지 않는다 — 좌표계의 거리처럼
자료형 자체에 딸린 연산만 둔다.
"""

from kiln.domain.enums import (
    FailureType,
    GlazingMethod,
    Gloss,
    Grade,
    RiskLevel,
    RiskType,
    Transparency,
)
from kiln.domain.models import (
    QUARTZ_INVERSION_C,
    Batch,
    CoefficientTable,
    CoolingSegment,
    DensityMeasurement,
    FiringResult,
    FiringRun,
    GlazeRecipe,
    GlazingRecord,
    KilnProfile,
    SearchState,
    TargetCoordinate,
    Ware,
    WareShape,
)

__all__ = [
    "Gloss",
    "Transparency",
    "Grade",
    "FailureType",
    "GlazingMethod",
    "RiskType",
    "RiskLevel",
    "TargetCoordinate",
    "GlazeRecipe",
    "Batch",
    "DensityMeasurement",
    "Ware",
    "WareShape",
    "GlazingRecord",
    "QUARTZ_INVERSION_C",
    "CoolingSegment",
    "FiringResult",
    "FiringRun",
    "KilnProfile",
    "CoefficientTable",
    "SearchState",
]
