"""08절 · 대응 선택지 — 8-4절.

위험을 표시하는 것만으로는 08절이 닫히지 않는다. **가마에 들어가기 전이
되돌릴 수 있는 마지막 지점**이므로, 무엇을 되돌릴 수 있고 **그 되돌림이
얼마짜리인지**를 같이 내야 사용자가 고를 수 있다.

v5가 여기서 틀렸던 것: 재시유 예측에만 ``✓ 안전`` 확정 기호를 붙였다.
07절이 "국소 최대 두께가 가장 불확실"이라고 못 박고 스케줄 보정에는
"효과 불확실"을 붙여놓은 것과 태도가 어긋난다. **어떤 선택지에도 확정
기호를 붙이지 않는다.** 재시유는 오히려 재습윤으로 흡수율이 변해 07절
모델의 적용 범위를 벗어나므로(7-5절) 예측 신뢰도가 **내려간다** —
그것이 :attr:`ReversalOption.confidence_downgrade` 다.
"""

from __future__ import annotations

from dataclasses import dataclass

__all__ = ["ReversalOption", "reversal_options"]


@dataclass(frozen=True, slots=True)
class ReversalOption:
    """되돌림 선택지 하나 (8-4절 표).

    ``cost`` 와 ``effect`` 를 **반드시 함께** 낸다. 비용 없이 효과만 적으면
    "재시유하면 되지"로 읽히는데, 재시유는 건조 시간을 다시 쓰고 모델
    적용 범위를 벗어나는 선택이다.
    """

    #: 재시유 / 부분 보정 / 적재 조정 / 스케줄 보정 / 그대로 진행
    name: str
    #: 되돌림 비용. 없으면 "없음" — 빈 문자열로 두지 않는다
    cost: str
    #: 기대 효과. 확정 기호(✓ 안전 등)를 붙이지 않는다
    effect: str
    #: 이 선택지를 고르면 이후 예측 신뢰도가 내려가는가 (7-5절)
    confidence_downgrade: bool


#: 8-4절 표를 그대로 옮긴 것. 행 순서까지 기획서와 같다.
_CATALOGUE: tuple[ReversalOption, ...] = (
    ReversalOption(
        name="재시유",
        cost="건조 4시간 재소요",
        effect=(
            "가장 확실하나 예측 신뢰도 하향 — 재습윤으로 흡수율이 변해 "
            "07절 두께 모델의 적용 범위를 벗어난다 (7-5절)"
        ),
        confidence_downgrade=True,
    ),
    ReversalOption(
        name="부분 보정",
        cost="수 분 (약 5분)",
        effect="국소 위험 완화",
        confidence_downgrade=False,
    ),
    ReversalOption(
        name="적재 조정",
        cost="없음",
        effect="2차 피해 방지 — 흘러내려도 아래 선반·이웃 기물로 번지지 않게 한다",
        confidence_downgrade=False,
    ),
    ReversalOption(
        name="스케줄 보정",
        cost="없음",
        effect=(
            "효과 불확실 — 8-3절대로 기포가 먼저 터질지 흘러내림이 먼저 "
            "터질지를 시스템이 관측하지 않으므로 어느 쪽으로 틀지 정할 근거가 없다"
        ),
        confidence_downgrade=False,
    ),
    ReversalOption(
        name="그대로 진행",
        cost="없음",
        effect="—",
        confidence_downgrade=False,
    ),
)

#: 부위별 정보가 없을 때 제외되는 선택지. 국소를 짚을 수 없으면 "국소 위험
#: 완화"라는 효과를 주장할 수 없다 (8-2절과 같은 태도).
_NEEDS_DISTRIBUTION = frozenset({"부분 보정"})


def reversal_options(*, has_distribution: bool = True) -> tuple[ReversalOption, ...]:
    """8-4절 되돌림 선택지 목록. 비용을 반드시 병기한다.

    ``has_distribution`` 이 False면(부기·분무·붓칠) **부분 보정을 빼고**
    낸다. 어느 부위가 위험한지 짚을 수 없는 상태에서 "국소 위험 완화"를
    선택지로 내밀면 8-2절이 막으려던 것과 같은 종류의 거짓 안심이 된다.
    나머지 선택지(재시유·적재 조정·스케줄 보정·그대로 진행)는 부위 정보와
    무관하게 실행 가능하므로 그대로 남는다.
    """
    if has_distribution:
        return _CATALOGUE
    return tuple(o for o in _CATALOGUE if o.name not in _NEEDS_DISTRIBUTION)
