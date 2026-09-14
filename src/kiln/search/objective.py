"""5-4절 · 목적함수와 필터 — 그리고 둘의 경계.

기획서 5-4절:

    d = w1 · |광택도_목표 − 광택도_결과| + w2 · |투명도_목표 − 투명도_결과|

    w1, w2 : 사용자가 UI에서 조정 (기본 1:1)
    부수 관측(색·흐름·핀홀·결정)은 d에 넣지 않고 **필터로만** 사용

**왜 나누는가.** 흐름·핀홀·결정에 가중치를 부여할 근거가 없다. "흐름 발생이
광택도 한 칸 어긋남의 몇 배인가"에 답할 데이터가 없는데 억지로 계수를 넣으면
그 계수가 곧 주장이 된다(00절이 금지하는 것). 5-4절은 그래서 **가중치를 만들
수 없는 항목은 목적함수에 넣지 말고 0/1 필터로 쓰는 편이 정직하다**고 적었다.
이 모듈에서 그 경계는 구조로 지켜진다 — :func:`objective` 는
:class:`~kiln.domain.models.FiringResult` 를 아예 받지 않고
:class:`~kiln.domain.models.TargetCoordinate` 두 개만 받는다. 부수 관측을
목적함수에 섞으려면 **시그니처를 바꿔야만** 하고, 그러면 눈에 띈다.

**색은 목적함수에도 필터에도 넣지 않는다(4-4절).** 같은 착색제도 기저 조성·
두께·냉각에 따라 결과가 달라져 예측하지 않기로 했고, 색이 "틀렸다"는 것은
결함이 아니라 관측이다. 그래서 색 관측은 기록만 되고 후보를 떨어뜨리지
않는다 — :data:`FILTERED_OBSERVATION_KEYS` 에 색이 없는 것이 그 규칙이다.

**미용융은 필터가 아니다.** 이건 의도된 비대칭이다. 흘러내림·핀홀·결정 과다·
응력 균열은 (광택도, 투명도) 평면 **바깥**에서 시편을 못 쓰게 만드는 결함이라
거리로는 잡히지 않는다 — 표면 질감이 목표와 완벽히 같아도 흘러내렸으면
그 배합은 쓸 수 없다. 반면 미용융은 광택도 축의 ``Dry`` 끝으로 **좌표에 그대로
찍힌다**. 이미 d가 큰 값으로 벌주고 있는 것을 필터로 한 번 더 지우면 "왜
떨어졌는지"의 신호가 이중으로 소비되고, 미용융 방향으로의 거리 정보가 통째로
사라진다(그 방향에서 4-3절이 이미 저실리카 매트와 미용융을 구분하지 못한다고
못 박았으므로, 남은 신호는 좌표뿐이다).
"""

from __future__ import annotations

from dataclasses import dataclass

from kiln.domain.enums import FailureType
from kiln.domain.models import FiringResult, TargetCoordinate

__all__ = [
    "Candidate",
    "DISQUALIFYING_FAILURES",
    "FILTERED_OBSERVATION_KEYS",
    "OCCURRENCE_MARKERS",
    "objective",
    "passes_filter",
]


#: 후보를 목표 거리와 **무관하게** 탈락시키는 실패 유형 (5-4절).
#:
#: 5-4절이 든 부수 관측은 색·흐름·핀홀·결정이다. 색은 4-4절에 따라 필터에서
#: 빠지고, 나머지 셋이 각각 ``RUNNING``·``BLISTER``·``EXCESS_CRYSTAL`` 이다.
#: ``CRAZING``(응력 균열)은 5-4절 문장에 이름이 없지만 같은 성격 — (광택도,
#: 투명도) 좌표에 찍히지 않으면서 시편을 못 쓰게 만든다 — 이라 함께 넣는다.
#: 이건 기획서 인용이 아니라 이 모듈의 판단이므로 여기 적어 둔다.
#: ``UNDERFIRED`` 가 빠진 이유는 모듈 docstring 참조.
DISQUALIFYING_FAILURES: frozenset[FailureType] = frozenset(
    {
        FailureType.RUNNING,
        FailureType.BLISTER,
        FailureType.EXCESS_CRYSTAL,
        FailureType.CRAZING,
    }
)

#: :attr:`~kiln.domain.models.FiringResult.observations` 에서 필터가 읽는 키.
#: **고정 표**다 — 자연어를 해석해 "이건 결함 같다"를 추론하지 않는다
#: (부록 D: AI를 판단 주체로 쓰지 않는다). 등록되지 않은 키는 기록만 되고
#: 판정에 관여하지 않으며, 색("색"·"color")은 의도적으로 여기 없다(4-4절).
FILTERED_OBSERVATION_KEYS: tuple[str, ...] = ("흐름", "핀홀", "결정", "균열")

#: 위 키의 값이 "발생했다"를 뜻하는 표기. 역시 고정 표다.
OCCURRENCE_MARKERS: tuple[str, ...] = (
    "발생",
    "있음",
    "심함",
    "다수",
    "yes",
    "true",
)


@dataclass(frozen=True, slots=True)
class Candidate:
    """제시되는 조성 후보 하나 (4-2절 "후보 N개 제시").

    ``expected_distance`` 는 5-4절 d의 **예상값**이지 관측값이 아니다.
    사전분포에 근거가 전혀 없어 예상할 수 없으면 ``math.inf`` 가 들어오고,
    그 사실이 ``umf_note`` 에 문장으로 실린다.

    ``umf_note`` 는 00절이 요구하는 출처 전달 통로다 — UMF·Stull 좌표가
    문헌 추정 초기값이라는 것, 고정 성분 비율의 출처, 개인 데이터 가중,
    색은 예측하지 않는다는 것이 전부 여기 실려 화면까지 나간다.
    """

    materials: dict[str, float]
    expected_distance: float
    umf_note: str


def objective(
    target: TargetCoordinate,
    result: TargetCoordinate,
    w_gloss: float = 1.0,
    w_transparency: float = 1.0,
) -> float:
    """5-4절 목적함수 d — 목표 좌표와 결과 좌표의 가중 거리.

    ``d = w1·|광택도_목표 − 광택도_결과| + w2·|투명도_목표 − 투명도_결과|``

    :meth:`kiln.domain.models.TargetCoordinate.distance` 에 그대로 위임한다.
    같은 식을 두 군데 적어 두면 한쪽만 고쳐지고, 그 순간 목표와 결과가 다른
    척도 위에 놓여 4-1절이 요구한 되먹임이 깨진다.

    가중치는 음수일 수 없다. 음수를 허용하면 d가 음수가 되어 거리 공리
    (비음수)가 깨지고, "특정 축은 어긋날수록 좋다"는 뜻이 되어 5-4절의
    정의와 맞지 않는다. 0은 허용한다 — 한 축을 보지 않겠다는 뜻이다.

    Args:
        target: 사용자가 고른 목표 좌표 (4-2절).
        result: 소성 결과 좌표 (10-1절 축 1). **같은 자료형**이어야 한다.
        w_gloss: w1, 광택도 가중. 기본 1.0.
        w_transparency: w2, 투명도 가중. 기본 1.0.

    Returns:
        거리 d. 비음수이고, 두 좌표가 같으면 정확히 0.0이다.

    Raises:
        ValueError: 가중치가 음수.
    """
    if w_gloss < 0 or w_transparency < 0:
        raise ValueError(
            f"목적함수 가중치는 음수일 수 없다 (w_gloss={w_gloss}, "
            f"w_transparency={w_transparency}). 음수를 허용하면 d가 음수가 되어 "
            "거리로서의 의미를 잃는다(5-4절)"
        )
    return target.distance(result, w_gloss=w_gloss, w_transparency=w_transparency)


def _observation_says_occurred(value: str) -> bool:
    """관측값 문자열이 "발생했다"를 뜻하는가. 고정 표 조회뿐이다."""
    text = value.strip().lower()
    if not text:
        return False
    if text in ("없음", "미발생", "no", "false", "0"):
        return False
    return any(marker in text for marker in OCCURRENCE_MARKERS)


def passes_filter(result: FiringResult) -> bool:
    """부수 관측 필터 (5-4절). 통과하면 True, 후보에서 제외하면 False.

    5-4절: **부수 관측은 d에 넣지 않고 필터로만 사용한다.** 예컨대
    "흐름 발생" 시편은 목표 거리와 무관하게 후보에서 제외한다.

    두 경로를 본다. 둘 다 고정 표 조회이며 자연어 추론은 하지 않는다.

    1. :attr:`~kiln.domain.models.FiringResult.failures` 에
       :data:`DISQUALIFYING_FAILURES` 가 하나라도 있으면 탈락.
    2. :attr:`~kiln.domain.models.FiringResult.observations` 의
       :data:`FILTERED_OBSERVATION_KEYS` 값이
       :data:`OCCURRENCE_MARKERS` 를 포함하면 탈락.

    등급(:class:`~kiln.domain.enums.Grade`)은 **보지 않는다.** 등급은 10-1절
    축 2의 만족도 신호이고 좌표는 축 1이다 — "실패"인데 실패 유형이
    미용융뿐이면 그 시편은 여전히 좌표를 갖고 있고 d가 그 정보를 나른다
    (모듈 docstring 참조). 색 관측도 보지 않는다(4-4절).

    Args:
        result: 소성 결과 3축 기록.

    Returns:
        후보로 남길 수 있으면 True.
    """
    if result.failures & DISQUALIFYING_FAILURES:
        return False
    for key, value in result.observations.items():
        if key.strip() in FILTERED_OBSERVATION_KEYS and _observation_says_occurred(
            value
        ):
            return False
    return True
