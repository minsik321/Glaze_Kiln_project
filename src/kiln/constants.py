"""부록 C · 미정값 대장 — 계수의 단일 출처.

기획서 부록 C: "이 표가 명세서 실시가능성의 근거다. 값이 없어도 동정 절차가
개시되어 있으면 요건을 충족한다."

따라서 이 모듈이 보관하는 것은 *값*이 아니라 **값과 출처와 동정 절차의 묶음**이다.
계수를 값으로만 다루면 기획서 00절이 금지한 주장("계수의 값을 주장한다")이
코드 안에서 소리 없이 되살아난다. 그래서:

- 모든 계수는 :class:`Coefficient` 로 감싼다.
- ``UNDETERMINED`` 계수는 ``.value`` 접근 시 :class:`UndeterminedCoefficientError`.
  값을 쓰려면 호출부가 명시적으로 가정을 세우고(``assume()``) 그 사실이 결과에
  기록되어야 한다.
- 화면·보고서에 쓸 문구는 :meth:`Coefficient.annotation` 이 만든다.
  ("(문헌 추정 초기값 · 캘리브레이션 전)" — 기획서 6-4, 8-4)
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import Enum

__all__ = [
    "Provenance",
    "Coefficient",
    "UndeterminedCoefficientError",
    "REGISTRY",
    "get",
]


class Provenance(Enum):
    """계수 값의 출처. 화면 표기와 신뢰도 판정의 근거."""

    UNDETERMINED = "미정"
    """값 기재 금지. 동정 절차만 존재한다. (예: E, α, β)"""

    LITERATURE = "문헌 추정 초기값"
    """문헌에서 끌어온 범위의 대표값. 캘리브레이션 전."""

    CONVENTION = "문헌 관행"
    """관행적으로 쓰이는 값. 실측 근거는 없다."""

    CALIBRATED = "캘리브레이션됨"
    """이 사용자·이 유약의 실측에서 동정된 값."""

    USER = "사용자 지정"
    """사용자가 UI에서 직접 넣은 값."""

    @property
    def is_trustworthy(self) -> bool:
        """실측에 근거한 값인가. 예측 신뢰도 표기의 기준."""
        return self in (Provenance.CALIBRATED, Provenance.USER)


class UndeterminedCoefficientError(RuntimeError):
    """미정 계수의 값을 읽으려 했다.

    기획서 부록 C에서 ``값 기재 금지``로 표시된 계수(E 등)를 그대로 쓰면
    발생한다. 호출부는 :meth:`Coefficient.assume` 으로 가정을 명시하고,
    그 가정이 결과에 실려 나가게 해야 한다.
    """

    def __init__(self, symbol: str, identification: str) -> None:
        super().__init__(
            f"계수 {symbol!r}는 미정값이다(부록 C). 값을 기재할 수 없다.\n"
            f"  동정 방법: {identification}\n"
            f"  값이 필요하면 .assume(값, 사유)로 가정을 명시하라. "
            f"가정한 값은 결과에 provenance가 함께 실린다."
        )
        self.symbol = symbol


@dataclass(frozen=True, slots=True)
class Coefficient:
    """계수 하나. 값·차원·출처·동정 절차를 함께 나른다.

    ``_value`` 가 ``None`` 이면 미정이다. 값 접근은 :attr:`value` 로만 하고,
    그 접근이 미정 계수에서 실패하는 것이 이 클래스의 요점이다.
    """

    symbol: str
    definition: str
    dimension: str
    identification: str
    provenance: Provenance
    _value: float | None = None
    lower: float | None = None
    upper: float | None = None
    note: str = ""

    @property
    def value(self) -> float:
        """계수 값. 미정이면 :class:`UndeterminedCoefficientError`."""
        if self._value is None:
            raise UndeterminedCoefficientError(self.symbol, self.identification)
        return self._value

    @property
    def is_determined(self) -> bool:
        return self._value is not None

    def assume(self, value: float, reason: str) -> "Coefficient":
        """미정 계수에 가정값을 세운다.

        민감도 스윕과 시뮬레이터 튜닝의 진입점이다(부록 C: α·β는
        "시뮬레이터 민감도 스윕"으로 동정). 반환된 계수는 여전히
        ``UNDETERMINED`` provenance를 달고 다니므로, 결과 보고서에서
        "가정에 근거함"이 지워지지 않는다.
        """
        return replace(self, _value=value, note=f"가정: {reason}")

    def calibrated(self, value: float, source: str) -> "Coefficient":
        """실측으로 동정된 값으로 교체한다. provenance가 CALIBRATED로 올라간다."""
        return replace(
            self, _value=value, provenance=Provenance.CALIBRATED, note=source
        )

    def annotation(self) -> str:
        """화면·보고서 병기 문구.

        기획서 6-4: "화면의 권장 범위 수치에는
        ``(문헌 추정 초기값 · 캘리브레이션 전)``을 병기한다."
        """
        if self.provenance is Provenance.LITERATURE:
            return "(문헌 추정 초기값 · 캘리브레이션 전)"
        if self.provenance is Provenance.UNDETERMINED:
            if self.is_determined:
                return f"(미정값 · {self.note or '가정값'})"
            return "(미정 — 값 없음)"
        return f"({self.provenance.value})"

    def __str__(self) -> str:
        head = f"{self.symbol}={self._value}" if self.is_determined else f"{self.symbol}=미정"
        return f"{head} {self.annotation()}"


def _c(
    symbol: str,
    definition: str,
    dimension: str,
    identification: str,
    provenance: Provenance,
    value: float | None = None,
    lower: float | None = None,
    upper: float | None = None,
    note: str = "",
) -> Coefficient:
    return Coefficient(
        symbol=symbol,
        definition=definition,
        dimension=dimension,
        identification=identification,
        provenance=provenance,
        _value=value,
        lower=lower,
        upper=upper,
        note=note,
    )


#: 부록 C 표를 그대로 옮긴 것. 행 순서까지 기획서와 같다.
REGISTRY: dict[str, Coefficient] = {
    c.symbol: c
    for c in [
        _c(
            "k1",
            "흡수층 계수",
            "mm/√s",
            "타일 3~4장 무게 회귀 (7-3절)",
            Provenance.LITERATURE,
            value=0.55,
            lower=0.3,
            upper=0.9,
        ),
        _c(
            "absorption",
            "소지 흡수 특성",
            "무차원",
            "k₁과 곱으로만 식별. 분리 불가 (부록 A)",
            Provenance.LITERATURE,
            value=1.0,
            note="k₁과 곱으로만 식별되므로 1.0으로 고정하고 k₁이 곱을 흡수한다",
        ),
        _c(
            "k2",
            "흘러내림층 계수",
            "mm",
            "파단면 관찰. s와 분리 불가 (7-4절)",
            Provenance.LITERATURE,
            value=0.35,
            lower=0.1,
            upper=0.8,
            note="인출 속도에 지배됨 — 상수가 아니라 분산을 가진 양 (부록 A #39)",
        ),
        _c(
            "m_rho",
            "비중의 흘러내림 기여 m(ρ)의 지수 파라미터",
            "무차원",
            "배치 간 비교 (6-2절)",
            Provenance.LITERATURE,
            value=3.0,
            lower=1.0,
            upper=6.0,
            note="파라미터 1개짜리 단조증가 함수",
        ),
        _c(
            "g_rho",
            "비중의 흡수 기여 g(ρ)의 지수 파라미터",
            "무차원",
            "타일 회귀 (7-3절)",
            Provenance.LITERATURE,
            value=1.0,
            lower=0.3,
            upper=2.0,
            note="함수형 미정 — 멱함수로 잠정",
        ),
        _c(
            "rho_dry",
            "건조 유약층 겉보기 밀도",
            "g/cm³",
            "타일 캘리퍼 1회 측정: ρ_dry = W/(A·t) (7-3절)",
            Provenance.LITERATURE,
            value=1.5,
            lower=1.3,
            upper=1.7,
            note="7-2절: 이 값 하나로 08절 안전창이 한 칸 통째로 이동한다",
        ),
        _c(
            "s",
            "압밀 계수 (소성후/생)",
            "무차원",
            "유약별 고정 상수로 취급. k₂와 분리 동정 불가 (7-4절)",
            Provenance.LITERATURE,
            value=0.75,
            lower=0.5,
            upper=0.95,
        ),
        _c(
            "E",
            "겉보기 활성화 에너지",
            "J/mol",
            "콘의 승온율별 도달온도 쌍에서 역산 (10-3절). "
            "수치는 Orton 공식 자료로 직접 대조한 뒤 채운다",
            Provenance.UNDETERMINED,
            value=None,
            lower=200_000.0,
            upper=400_000.0,
            note="부록 C: 값 기재 금지",
        ),
        _c(
            "alpha",
            "밀집도 감쇠 계수 α (열분포 균일도)",
            "무차원",
            "시뮬레이터 민감도 스윕 (12-1절: 값 없이는 자리표시자)",
            Provenance.UNDETERMINED,
            value=None,
        ),
        _c(
            "beta",
            "밀집도 감쇠 계수 β (승온 응답)",
            "무차원",
            "시뮬레이터 민감도 스윕 (12-1절: 값 없이는 자리표시자)",
            Provenance.UNDETERMINED,
            value=None,
        ),
        _c(
            "Kh",
            "외측 루프 이득",
            "무차원",
            "시뮬레이터 튜닝 (9-5절)",
            Provenance.UNDETERMINED,
            value=None,
        ),
        _c(
            "UA",
            "가마 벽체 손실 계수",
            "W/K",
            "유지전력 역산. 가마 프로필 등록 시 (9-6절)",
            Provenance.LITERATURE,
            # 9-6절이 유도 과정을 명시했다: UA = 2500 W / (1220−20) K.
            # 2.1로 반올림하면 같은 절의 자연냉각률 표(1220℃ 155 / 1000℃ 127
            # / 800℃ 101 / 600℃ 75 ℃/h)가 한 칸씩 어긋난다(1220℃에서 156).
            # 기획서 수치가 정본이므로 나눗셈을 그대로 둔다.
            value=2500.0 / 1200.0,
            note="30L 가마, 1220℃ 유지전력 2.5kW에서 선형 역산 (2500 W / 1200 K)",
        ),
        _c(
            "sensor_offset",
            "기물–센서 온도차",
            "K",
            "가마 프로필 캘리브레이션 (9-3절)",
            Provenance.UNDETERMINED,
            value=None,
            note="9-3절: 기물 온도는 관측하지 않는다. H는 센서 기준 H_s로 정의",
        ),
        _c(
            "kaolin_background",
            "카올린 배경 비율",
            "%",
            "탐색 결과로 조정 (5-1절)",
            Provenance.LITERATURE,
            value=12.5,
            lower=10.0,
            upper=15.0,
        ),
        _c(
            "bentonite_fixed",
            "벤토나이트 고정량",
            "%",
            "침강 관찰 (5-1절)",
            Provenance.CONVENTION,
            value=2.0,
        ),
    ]
}


def get(symbol: str) -> Coefficient:
    """계수를 대장에서 꺼낸다. 없는 기호는 KeyError."""
    try:
        return REGISTRY[symbol]
    except KeyError:
        raise KeyError(
            f"{symbol!r}는 부록 C 미정값 대장에 없다. "
            f"등록된 기호: {sorted(REGISTRY)}"
        ) from None
