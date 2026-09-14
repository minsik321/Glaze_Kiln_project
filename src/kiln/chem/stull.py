"""4-3절 · Stull 좌표 — 판정이 아니라 참조.

기획서 4-3절의 세 규칙을 그대로 코드로 옮긴다.

1. **판정이 아니라 참조.** ``StullReading`` 은 질감을 확정하지 않는다.
   ``provenance_note`` 에 항상 문헌 추정 초기값이라는 disclaimer가 실려
   나간다(부록 C "Stull 경계" 행: 초기값 출처 = 문헌, 콘 11 기준).
2. **2차원 판정.** SiO₂:Al₂O₃ 비 1차원이 아니라 ``(SiO₂, Al₂O₃)`` 좌표
   그대로 판정한다. 05-2절의 석회석 스윕이 그 이유를 정량으로 보여준다 —
   규석:장석 비를 1:1로 고정하고 석회석만 10%p 단위로 늘리면(10/20/30/40%)
   SiO₂:Al₂O₃ **비는 15.19로 전 구간 불변**인데(장석이 유일한 Al₂O₃원이라
   규석·장석 비가 안 변하면 비도 안 변한다) SiO₂ 절대값은 6.83 → 1.81로
   6배 가까이 떨어진다. 비만 보고 판정하면 이 넷을 전부 "같은 칸"으로
   묶어버려 **석회석 축이 판정에서 통째로 사라진다**. 그래서 ``classify``
   는 ``umf.ratio`` 를 아예 읽지 않고 ``umf.sio2`` · ``umf.al2o3`` 를 각각
   구간화(bucket)해 2차원 표로 판정한다.
3. **이산 프리셋만.** 콘은 ``"cone6"`` / ``"cone11"`` 두 값만 받는다.
   연속 콘 값을 받아 경계를 보간하는 함수는 없다 — 이동량을 산출할 근거
   문헌이 하나뿐이라 함수화하면 없는 정밀도를 있는 것처럼 보여준다.
   두 프리셋은 서로 다른 경계표(``_BOUNDARIES``)를 각각 갖는, 완전히
   독립된 참조표다.

**저실리카 매트 vs 미용융은 차트만으로 갈리지 않는다(4-3절, 부록 A).**
SiO₂가 아주 낮은 쪽으로 가면 Al₂O₃ 값과 무관하게 두 가지가 겹친다 —
"유리질 자체가 부족해 아예 안 녹은 것"과 "녹긴 녹았는데 유리형성제가
모자라 냉각 중 결정화해 매트가 된 것"은 (SiO₂, Al₂O₃) 평면에서 같은
방향에 있다. 갈라주는 것은 콘·유지시간·냉각(09절)이지 조성 좌표가
아니다. 그래서 이 영역은 ``MATTE`` 나 ``UNDERFIRED`` 중 하나로 임의로
배정하지 않고 :attr:`StullZone.LOW_SILICA_AMBIGUOUS` 라는 별도 값을 두어
"모른다"를 명시적으로 표현한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Literal

from kiln.chem.umf import UMF

__all__ = ["StullZone", "ConePreset", "StullReading", "classify"]


class StullZone(Enum):
    """Stull 참조 영역. 값은 화면 표기용 한국어 라벨이다.

    ``LOW_SILICA_AMBIGUOUS`` 는 04절 다른 어떤 영역과도 다르게, "판정
    불가"를 적극적으로 표현하는 값이다 — 판정 로직이 게을러서가 아니라
    04절이 그렇게 하라고 명시했기 때문이다.
    """

    #: SiO₂ 과다 · Al₂O₃ 상대적으로 부족 — 유리형성제가 융제에 비해 너무
    #: 많아 이 콘·이 융제량으로는 다 녹이기 어려운 방향.
    UNDERFIRED = "미용융"

    #: SiO₂가 매우 낮은 방향 — 저실리카 매트와 미용융이 겹치는 영역.
    #: classify()는 이 방향에서 둘 중 하나를 고르지 않는다.
    LOW_SILICA_AMBIGUOUS = "저실리카매트/미용융(구분불가)"

    #: Al₂O₃가 SiO₂ 대비 상대적으로 높아 무광이 되는 방향(알루미나 매트).
    MATTE = "매트"

    #: 매트와 광택의 중간 — 완전한 광택도 뚜렷한 무광도 아닌 방향.
    SEMI_MATTE = "세미매트"

    #: 고전적인 "잘 녹은 광택" 방향.
    BRIGHT = "광택"

    #: SiO₂·Al₂O₃가 모두 낮아(융제 비중이 매우 커) 열팽창이 크고 유동성이
    #: 높은 방향 — 크레이징(관유) 및 흘러내림에 취약.
    CRAZING = "크레이징 위험"


#: 콘 프리셋. 연속 슬라이더 금지(4-3절) — 이 두 문자열 리터럴만 받는다.
ConePreset = Literal["cone6", "cone11"]


@dataclass(frozen=True, slots=True)
class StullReading:
    """Stull 참조 결과 — 판정(verdict)이 아니라 참조(reference)다.

    ``provenance_note`` 는 항상 문헌 추정 초기값 disclaimer를 포함한다.
    이 값을 근거로 레시피를 자동 기각/승인하는 로직을 다른 모듈에 심지
    않는다(4-3절: "질감을 확정하는 근거로 쓰지 않는다").
    """

    zone: StullZone
    sio2: float
    al2o3: float
    cone: str
    provenance_note: str


# ─── 경계표 (문헌 추정 초기값 · 부록 C "Stull 경계") ─────────────────────────
#
# 각 프리셋은 SiO2·Al2O3 축을 각각 3개의 경계값으로 4구간(LOW/MID/HIGH/
# VERY_HIGH)으로 나눈 뒤 두 구간 인덱스의 조합으로 영역을 정한다. 콘6 경계는
# 콘11 대비 낮은 화도에서 같은 표면 인상을 내려면 SiO2·Al2O3가 함께
# 낮아져야 한다는 통상적 유약화학 경험칙을 반영해 고정값으로 따로 둔 것이지,
# 콘11 표에 어떤 배율을 곱해 "계산"한 것이 아니다 — 그런 함수가 있으면
# 임의의 콘에 대해 경계를 만들어낼 수 있게 되므로 4-3절이 금지한
# "연속 이동"이 뒷문으로 들어온다. 두 표는 각자 독립적으로 문헌값이다.

_CONE11_SIO2_EDGES = (2.0, 3.2, 5.5)
_CONE11_AL2O3_EDGES = (0.15, 0.35, 0.55)

_CONE6_SIO2_EDGES = (1.6, 2.6, 4.4)
_CONE6_AL2O3_EDGES = (0.12, 0.28, 0.45)

_BOUNDARIES: dict[str, dict[str, tuple[float, float, float]]] = {
    "cone11": {"sio2": _CONE11_SIO2_EDGES, "al2o3": _CONE11_AL2O3_EDGES},
    "cone6": {"sio2": _CONE6_SIO2_EDGES, "al2o3": _CONE6_AL2O3_EDGES},
}

_CONE_LABEL: dict[str, str] = {"cone11": "콘 11", "cone6": "콘 6"}


def _bucket(value: float, edges: tuple[float, float, float]) -> int:
    """3개 경계로 4구간 중 몇 번째인지(0=LOW .. 3=VERY_HIGH)."""
    idx = 0
    for edge in edges:
        if value >= edge:
            idx += 1
        else:
            break
    return idx


def _zone_from_buckets(sio2_bucket: int, al2o3_bucket: int) -> StullZone:
    """(SiO2 구간, Al2O3 구간) 조합 → 영역. 04절 2차원 판정 규칙의 본체.

    비(ratio)는 어디에도 쓰지 않는다 — 두 구간 인덱스가 곧 판정 근거다.
    """
    if sio2_bucket == 0:
        # SiO2가 가장 낮은 구간: Al2O3 값과 무관하게 저실리카매트/미용융이
        # 겹친다(4-3절, 부록 A). 여기서 더 세분하지 않는다.
        return StullZone.LOW_SILICA_AMBIGUOUS

    if sio2_bucket == 3:
        # SiO2가 융제 대비 지나치게 많은 구간: 다 녹이기 어려운 방향.
        return StullZone.UNDERFIRED

    if sio2_bucket == 1:
        # SiO2 중간: Al2O3가 낮거나 중간이면 아직 광택에 못 미치는 세미매트,
        # Al2O3가 높으면 알루미나 매트 방향.
        return StullZone.SEMI_MATTE if al2o3_bucket <= 1 else StullZone.MATTE

    # sio2_bucket == 2 (충분한 SiO2)
    if al2o3_bucket == 0:
        # 안정제가 너무 적어 열팽창이 크고 유동적인 방향.
        return StullZone.CRAZING
    if al2o3_bucket == 1:
        return StullZone.BRIGHT
    # Al2O3가 많으면 SiO2가 충분해도 다시 매트 쪽으로 끌려간다.
    return StullZone.SEMI_MATTE


def classify(umf: UMF, cone: ConePreset = "cone11") -> StullReading:
    """UMF를 Stull 참조 영역으로 분류한다 (4-3절).

    ``cone`` 은 ``"cone6"`` / ``"cone11"`` 이산 프리셋만 받는다. 이 함수가
    돌려주는 :class:`StullReading` 은 판정이 아니라 참조다 —
    ``provenance_note`` 에 그 disclaimer가 항상 실린다.
    """
    if cone not in _BOUNDARIES:
        raise ValueError(
            f"콘 프리셋 {cone!r}은 지원하지 않는다. "
            f"이산 프리셋만 허용한다: {sorted(_BOUNDARIES)} (4-3절)"
        )

    sio2 = umf.sio2
    al2o3 = umf.al2o3
    edges = _BOUNDARIES[cone]
    sio2_bucket = _bucket(sio2, edges["sio2"])
    al2o3_bucket = _bucket(al2o3, edges["al2o3"])
    zone = _zone_from_buckets(sio2_bucket, al2o3_bucket)

    cone_label = _CONE_LABEL[cone]
    note = (
        f"(문헌 추정 초기값 · {cone_label} 기준 · 캘리브레이션 전) "
        "이 좌표는 표면 질감을 확정하는 판정이 아니라 참조다(4-3절). "
        "실제 경계는 라벨 축적 후에만 좁혀진다(부록 C)."
    )
    if zone is StullZone.LOW_SILICA_AMBIGUOUS:
        note += (
            " 저실리카 매트와 미용융은 Stull 좌표상 같은 방향이라 이 차트만으로"
            " 갈리지 않는다 — 갈라주는 것은 콘·유지시간·냉각이다(4-3절, 부록 A)."
        )

    return StullReading(
        zone=zone,
        sio2=sio2,
        al2o3=al2o3,
        cone=cone_label,
        provenance_note=note,
    )
