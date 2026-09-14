"""4-1 · 10-1절 · 순서형 좌표축과 라벨 열거형.

기획서 4-1: 광택도와 투명도는 **독립 2축**이고 둘 다 **순서형**이다.
순서형이라는 것이 두 가지를 준다 — 거리가 정의되고(5-4절 목적함수),
사용자가 소성 결과를 목표와 같은 척도로 고를 수 있다(⑬ 되먹임).

폐기된 것: Dry–Matte–Clear 삼각좌표. 셋은 배타적 성분이 아니라 용융도가
올라가는 한 축 위의 순서이고, 표면은 한 상태만 가지므로
"Dry 60 / Matte 30 / Clear 10"이 정의되지 않는다.
"""

from __future__ import annotations

from enum import Enum

__all__ = [
    "OrdinalAxis",
    "Gloss",
    "Transparency",
    "Grade",
    "FailureType",
    "GlazingMethod",
    "RiskType",
    "RiskLevel",
]


class OrdinalAxis(Enum):
    """순서형 축의 공통 동작. 값이 곧 순위이며 거리는 순위 차다."""

    def __init__(self, level: int, label: str) -> None:
        self.level = level
        self.label = label

    def distance(self, other: "OrdinalAxis") -> int:
        """같은 축 위 두 등급의 거리. 다른 축이면 TypeError."""
        if type(self) is not type(other):
            raise TypeError(
                f"{type(self).__name__}과 {type(other).__name__}은 다른 축이다. "
                f"거리가 정의되지 않는다 (4-1절: 두 축은 독립)."
            )
        return abs(self.level - other.level)

    @classmethod
    def span(cls) -> int:
        """축의 최대 거리. 목적함수 정규화에 쓴다."""
        levels = [m.level for m in cls]
        return max(levels) - min(levels)

    @classmethod
    def from_level(cls, level: int) -> "OrdinalAxis":
        for member in cls:
            if member.level == level:
                return member
        raise ValueError(f"{cls.__name__}에 level={level}인 등급이 없다")

    def __str__(self) -> str:
        return self.label


class Gloss(OrdinalAxis):
    """축 1 · 광택도 — 5단계 순서형 (4-1절)."""

    DRY = (0, "Dry")
    MATTE = (1, "Matte")
    SATIN = (2, "Satin")
    SEMI_GLOSS = (3, "Semi-gloss")
    GLOSS = (4, "Gloss")


class Transparency(OrdinalAxis):
    """축 2 · 투명도 — 4단계 순서형 (4-1절).

    광택도와 독립이다: 불투명 광택도, 투명 매트도 모두 존재한다.
    """

    OPAQUE = (0, "불투명")
    SEMI_OPAQUE = (1, "반불투명")
    TRANSLUCENT = (2, "반투명")
    TRANSPARENT = (3, "투명")


class Grade(Enum):
    """10-1절 축 2 · 등급 — 전반적 방향 신호.

    등급과 목표 좌표는 **다른 축이다**. 3단계 등급은 만족도이지 질감이 아니므로
    그것만으로는 탐색도 Stull 경계 보정도 못 한다.

    "허용"의 주관성은 개인 1인 시스템이므로 일관성만 있으면 문제되지 않는다.
    다중 사용자 확장 시 정규화 필요 (부록 B).
    """

    AS_INTENDED = "의도일치"
    ACCEPTABLE = "허용"
    FAILED = "실패"


class FailureType(Enum):
    """10-1절 축 3 · 실패 유형. 등급=실패일 때 다중 선택.

    08절 위험 유형과 1:1로 대응한다 — 사전 판정과 사후 라벨이 같은 어휘를
    써야 10-2절 "안전 두께 범위" 보정이 성립한다.
    """

    RUNNING = "흘러내림"
    UNDERFIRED = "미용융"
    BLISTER = "기포·핀홀"
    CRAZING = "응력 균열"
    EXCESS_CRYSTAL = "결정 과다"


class GlazingMethod(Enum):
    """8-2절 · 시유 방법. 가용 판정의 층을 가른다.

    분포 모델은 담금 전용이다. 담금이 아니면 분포 기반 판정
    (흘러내림·응력 균열)이 작동하지 않고 「판정 불가」로 회색 처리된다.
    """

    DIPPING = "담금"
    POURING = "부기"
    SPRAYING = "분무"
    BRUSHING = "붓칠"

    @property
    def has_distribution_model(self) -> bool:
        """부위별 두께 분포를 산출할 수 있는가 (7-5절)."""
        return self is GlazingMethod.DIPPING


class RiskType(Enum):
    """8-1절 · 위험 유형 5종."""

    RUNNING = "흘러내림"
    UNDERFIRED = "미용융"
    BLISTER = "기포·핀홀"
    CRAZING = "응력 균열"
    EXCESS_CRYSTAL = "결정 과다"

    @property
    def needs_distribution(self) -> bool:
        """분포 모델이 있어야 판정되는가 (8-2절)."""
        return self in (RiskType.RUNNING, RiskType.CRAZING)

    def to_failure(self) -> FailureType:
        """대응하는 사후 실패 유형."""
        return FailureType[self.name]


class RiskLevel(OrdinalAxis):
    """위험 수준. 「판정 불가」가 등급의 하나라는 점이 중요하다 — 8-2절에서
    분포 모델이 없을 때 위험을 '없음'으로 내리면 거짓 안심이 된다."""

    UNAVAILABLE = (-1, "판정 불가")
    NONE = (0, "없음")
    LOW = (1, "낮음")
    MEDIUM = (2, "보통")
    HIGH = (3, "높음")

    @property
    def is_actionable(self) -> bool:
        """사용자에게 대응 선택지를 제시해야 하는가."""
        return self.level >= RiskLevel.MEDIUM.level
