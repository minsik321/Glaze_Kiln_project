"""08절 · 위험 판정 — 8-1 ~ 8-3절.

**가마에 들어가기 전이 되돌릴 수 있는 마지막 지점이다.** 이 모듈은 07절이
낸 두께 분포를 받아 8-1절 위험 5종을 등급으로 매긴다.

두 가지가 이 모듈의 설계를 지배한다.

1. **8-2절 층 구조** — 분포 모델은 담금 전용이다. 담금이 아니면 흘러내림·
   응력 균열은 판정 근거 **자체가 없다**. 그때 위험을 「없음」으로 내리면
   거짓 안심이 된다. 그래서 :class:`~kiln.domain.enums.RiskLevel` 은
   ``UNAVAILABLE``(「판정 불가」)을 등급의 하나로 갖고 있고, 이 모듈은 근거가
   없을 때 반드시 그쪽을 쓴다. 총량 기반 판정이 상위, 분포 기반 판정이
   하위인 2층 구조다.
2. **8-3절 미분기** — 두께가 과다할 때 기포가 먼저 터질지 흘러내림이 먼저
   터질지는 유약의 용융 범위와 소지의 가스 방출 온도대가 결정하는데,
   **시스템이 관측하는 값이 아니다.** 숨기지 않고 **둘 다 표시**한다.

등급 경계(안전 범위 폭 대비 초과 비율 0.25 / 0.5)는 10-2절의 **점선 항목**이다
— 실패 발생 지점이 축적되어야 좁혀지며 지금은 8-4절 예시 하나 말고 근거가
없다. 그 사실이 :attr:`RiskFinding.annotation` 에 실려 나간다.
"""

from __future__ import annotations

from dataclasses import dataclass

from kiln.domain.enums import GlazingMethod, RiskLevel, RiskType
from kiln.domain.models import GlazeRecipe
from kiln.thickness.profile import ThicknessProfile

__all__ = [
    "DEFAULT_SAFE_RANGE_MM",
    "RiskFinding",
    "evaluate_findings",
]

#: 08절 예시가 쓰는 안전 두께 범위 [mm]. 유약별로 좁혀지기 전의 초기값이며
#: 10-2절 **점선** 항목이다(실패 발생 지점 축적으로만 좁혀진다).
DEFAULT_SAFE_RANGE_MM = (0.8, 1.3)

#: 안전 범위 폭 대비 초과 비율의 등급 경계. 근거 없는 구획이라 점선이다.
_LOW_BAND = 0.25
_MEDIUM_BAND = 0.5

#: 응력 균열의 기준선: 편차가 안전창 폭의 **절반**을 넘으면 평균을 창 한가운데
#: 맞춰도 일부 부위가 창 밖으로 나간다. 그 지점부터 위험이 시작한다고 본다.
_SPREAD_TOLERANCE_RATIO = 0.5


@dataclass(frozen=True, slots=True)
class RiskFinding:
    """위험 한 종에 대한 판정 (8-1 ~ 8-3절)."""

    risk: RiskType
    level: RiskLevel
    #: 판정 근거를 사람이 읽는 문장으로. 예: "굽에서 12mm 지점 두께 1.72mm"
    detail: str
    #: 안전 범위의 출처 병기 (8-4절 화면 예시의 "(문헌 추정 초기값 …)" 줄)
    annotation: str
    #: 8-2절: 분포 모델이 없어 판정 근거가 없으면 False → level=UNAVAILABLE
    available: bool


def _band(excess_ratio: float) -> RiskLevel:
    """안전 범위 폭 대비 초과 비율을 위험 등급으로 (8-1절).

    ``excess_ratio`` 는 (초과량 / 안전창 폭)이다. 안전창 폭으로 정규화하는
    이유는 그것이 이 판정에서 의미가 정의된 유일한 길이 척도이기 때문이다 —
    절대 mm로 경계를 잡으면 10-2절이 유약별 안전창을 좁혔을 때 등급이 따라오지
    않는다.

    경계값은 8-4절 화면 예시(안전 범위 0.8–1.3mm에서 국소 최대 1.72mm →
    「높음」)와 맞춘 것이고, **그 예시 하나 말고는 근거가 없다.** 10-2절
    점선 항목이며 실패 발생 지점이 쌓여야 좁혀진다.
    """
    if excess_ratio <= 0:
        return RiskLevel.NONE
    if excess_ratio <= _LOW_BAND:
        return RiskLevel.LOW
    if excess_ratio <= _MEDIUM_BAND:
        return RiskLevel.MEDIUM
    return RiskLevel.HIGH


def _raise_one(level: RiskLevel) -> RiskLevel:
    """등급을 한 칸 올린다(HIGH에서 멈춘다). 8-3절 유약 유형 지정에 쓴다."""
    if level is RiskLevel.HIGH or level.level < RiskLevel.NONE.level:
        return level
    return RiskLevel.from_level(min(level.level + 1, RiskLevel.HIGH.level))


def _thickest_point_detail(profile: ThicknessProfile) -> str:
    """가장 두꺼운 지점을 8-4절 화면 문구 형식으로 (예: "굽에서 12mm 지점 …")."""
    if not profile.points:
        return f"평균 두께 {profile.mean_mm:.2f}mm"
    thickest = max(profile.points, key=lambda p: p.total)
    return f"굽에서 {thickest.z:.0f}mm 지점 두께 {thickest.total:.2f}mm"


def _thinnest_point_detail(profile: ThicknessProfile) -> str:
    """가장 얇은 지점 — 미용융 판정의 근거 문구 (8-1절)."""
    if not profile.points:
        return f"평균 두께 {profile.mean_mm:.2f}mm"
    thinnest = min(profile.points, key=lambda p: p.total)
    return f"굽에서 {thinnest.z:.0f}mm 지점 두께 {thinnest.total:.2f}mm"


def _unavailable(risk: RiskType, method: GlazingMethod, annotation: str) -> RiskFinding:
    """8-2절: 근거가 없을 때의 판정. **「없음」이 아니라 「판정 불가」다.**"""
    return RiskFinding(
        risk=risk,
        level=RiskLevel.UNAVAILABLE,
        detail=(
            f"{method.value}은 부위별 두께 분포를 산출할 수 없어 "
            f"{risk.value} 판정 근거가 없다. 위험이 없다는 뜻이 아니다 (8-2절)."
        ),
        annotation=annotation,
        available=False,
    )


def _safe_range_annotation(safe_range_mm: tuple[float, float]) -> str:
    """안전 범위의 출처를 병기한다 (8-4절 화면 예시, 10-2절 점선 항목).

    기본값 그대로면 6-4절·8-4절이 요구하는 "(문헌 추정 초기값 · 캘리브레이션
    전)"을, 호출부가 좁힌 범위면 그 값이 여전히 **점선**이라는 사실을 적는다.
    안전 두께 범위는 캘리브레이션되더라도 실선이 되지 않는다 — 10-2절이
    실선으로 인정한 것은 k1과 ρ_dry 둘뿐이다.
    """
    lo, hi = safe_range_mm
    head = f"이 유약의 안전 범위 {lo:.1f}–{hi:.1f}mm"
    if (lo, hi) == DEFAULT_SAFE_RANGE_MM:
        return f"{head} (문헌 추정 초기값 · 캘리브레이션 전)"
    return f"{head} (10-2절 점선 — 실패 발생 지점 축적으로만 좁혀진다)"


def evaluate_findings(
    profile: ThicknessProfile,
    *,
    method: GlazingMethod,
    safe_range_mm: tuple[float, float] = DEFAULT_SAFE_RANGE_MM,
    recipe: GlazeRecipe | None = None,
) -> tuple[RiskFinding, ...]:
    """8-1절 위험 5종을 판정한다. 반환 순서는 8-1절 표 순서다.

    판정 근거(8-1절 표):

    ==================== ==================================================
    흘러내림              국소 최대 두께가 안전 상한 초과 — **분포 필요**
    미용융                최소 두께가 안전 하한 미달
    기포·핀홀             두께 과다 + 가스 배출 저해 — 총량(평균) 기반
    응력 균열             두께 편차 과대 — **분포 필요**
    결정 과다             두께 과다 + 서냉 과다 — 아래 참조
    ==================== ==================================================

    **결정 과다의 절반은 여기서 판정되지 않는다.** 8-1절 판정 근거는
    "두께 과다 + 서냉 과다"인데 냉각 스케줄은 09절에서 정해지고 이 시점에
    아직 없다. 그래서 두께 조건만으로 매기고 그 사실을 ``detail`` 에 적는다 —
    8-2절 표가 결정 과다를 부기·분무·붓칠에서도 "평균 기반 가용"으로 분류한
    것과 일관된다.

    **8-3절 미분기**: 평균이 두꺼우면 기포와 흘러내림이 **둘 다** 올라온다.
    어느 쪽이 먼저 터지는지는 관측하지 않는 값이 결정하므로 숨기지 않는다.
    ``recipe.failure_mode_hint`` 로 유약 유형이 지정되어 있으면 그쪽만 한 칸
    올린다 — 반대쪽을 **내리지는 않는다**(8-3절 초기 단계는 양쪽 표시이고,
    유형 지정은 우선순위를 주는 것이지 반대쪽을 지우는 것이 아니다).
    """
    lo, hi = safe_range_mm
    if not 0 < lo < hi:
        raise ValueError(
            f"안전 두께 범위가 잘못됐다: {safe_range_mm}. 0 < 하한 < 상한이어야 한다"
        )
    width = hi - lo
    annotation = _safe_range_annotation(safe_range_mm)

    # 8-2절: 시유 방법과 실제 산출 결과 **둘 다** 분포를 줘야 분포 기반 판정이
    # 선다. 담금이어도 모양 항이 퇴화하면 profile.has_distribution이 False다
    # (7-5절: 분포를 지어내지 않는다).
    distributed = method.has_distribution_model and profile.has_distribution

    # ── 흘러내림 — 국소 최대 두께. 07절이 "가장 불확실"이라고 못 박은 값이다.
    if distributed:
        running = RiskFinding(
            risk=RiskType.RUNNING,
            level=_band((profile.local_max_mm - hi) / width),
            detail=_thickest_point_detail(profile),
            annotation=annotation,
            available=True,
        )
    else:
        running = _unavailable(RiskType.RUNNING, method, annotation)

    # ── 미용융 — 최소 두께 미달. 분포가 있으면 국소 최소, 없으면 평균(8-2절).
    thinnest = profile.local_min_mm if distributed else profile.mean_mm
    underfired = RiskFinding(
        risk=RiskType.UNDERFIRED,
        level=_band((lo - thinnest) / width),
        detail=(
            _thinnest_point_detail(profile)
            if distributed
            else f"평균 두께 {profile.mean_mm:.2f}mm (총량 기반)"
        ),
        annotation=annotation,
        available=True,
    )

    # ── 기포·핀홀 — 총량 기반. 평균이 두꺼우면 가스 배출이 저해된다(8-1절).
    blister = RiskFinding(
        risk=RiskType.BLISTER,
        level=_band((profile.mean_mm - hi) / width),
        detail=f"평균 두께 {profile.mean_mm:.2f}mm (총량 기반)",
        annotation=annotation,
        available=True,
    )

    # ── 응력 균열 — 두께 편차. 분포가 없으면 편차라는 값 자체가 없다(8-2절).
    if distributed:
        spread_excess = (profile.spread_mm - _SPREAD_TOLERANCE_RATIO * width) / width
        crazing = RiskFinding(
            risk=RiskType.CRAZING,
            level=_band(spread_excess),
            detail=(
                f"두께 편차 {profile.spread_mm:.2f}mm "
                f"(국소 {profile.local_min_mm:.2f}–{profile.local_max_mm:.2f}mm, "
                f"안전창 폭 {width:.2f}mm)"
            ),
            annotation=annotation,
            available=True,
        )
    else:
        crazing = _unavailable(RiskType.CRAZING, method, annotation)

    # ── 결정 과다 — 두께 과다 + 서냉 과다. 냉각 스케줄은 아직 없다(09절).
    crystal = RiskFinding(
        risk=RiskType.EXCESS_CRYSTAL,
        level=_band((profile.mean_mm - hi) / width),
        detail=(
            f"평균 두께 {profile.mean_mm:.2f}mm (총량 기반). "
            "서냉 과다 여부는 09절 냉각 계획이 정해져야 판정되므로 "
            "두께 조건만으로 매긴 값이다"
        ),
        annotation=annotation,
        available=True,
    )

    findings = [running, underfired, blister, crazing, crystal]

    # ── 8-3절: 유약 유형이 지정되어 있으면 그쪽만 상향. 반대쪽은 그대로 둔다.
    hint = recipe.failure_mode_hint if recipe is not None else None
    if hint is not None:
        hinted = RiskType[hint.name]
        findings = [
            (
                RiskFinding(
                    risk=f.risk,
                    level=_raise_one(f.level),
                    detail=(
                        f"{f.detail} · 이 유약은 {hint.value}형으로 등록되어 있어 "
                        "등급을 한 칸 올렸다 (8-3절)"
                    ),
                    annotation=f.annotation,
                    available=f.available,
                )
                if f.risk is hinted and f.available and f.level is not RiskLevel.NONE
                else f
            )
            for f in findings
        ]

    return tuple(findings)
