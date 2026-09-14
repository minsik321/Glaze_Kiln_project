"""08절 · 위험 판정 진입점 — 판정(8-1~8-3절)과 선택지(8-4절)를 묶는다.

07절이 낸 :class:`~kiln.thickness.profile.ThicknessProfile` 하나가 입력이고,
출력은 "무엇이 얼마나 위험한가"와 "무엇을 얼마에 되돌릴 수 있는가"다.
그 둘이 한 자료형에 같이 담겨야 8-4절 화면이 그려진다.
"""

from __future__ import annotations

from dataclasses import dataclass

from kiln.domain.enums import GlazingMethod, RiskLevel
from kiln.domain.models import GlazeRecipe
from kiln.risk.findings import DEFAULT_SAFE_RANGE_MM, RiskFinding, evaluate_findings
from kiln.risk.options import ReversalOption, reversal_options
from kiln.thickness.profile import ThicknessProfile

__all__ = ["RiskAssessment", "assess"]

#: 요약 등급의 순서. **「판정 불가」는 「없음」보다 나쁘고 「낮음」보다 낫다.**
#: RiskLevel.level(-1)을 그대로 최대값으로 쓰면 「흘러내림 판정 불가 + 나머지
#: 없음」이 요약에서 「없음」으로 접혀 8-2절이 막으려던 거짓 안심이 된다.
_SUMMARY_ORDER: dict[RiskLevel, int] = {
    RiskLevel.NONE: 0,
    RiskLevel.UNAVAILABLE: 1,
    RiskLevel.LOW: 2,
    RiskLevel.MEDIUM: 3,
    RiskLevel.HIGH: 4,
}


@dataclass(frozen=True, slots=True)
class RiskAssessment:
    """한 기물의 소성 전 위험 판정 결과 (08절 전체)."""

    findings: tuple[RiskFinding, ...]
    #: 8-4절 되돌림 선택지. 고를 것이 없으면 빈 튜플이다
    options: tuple[ReversalOption, ...]

    @property
    def worst(self) -> RiskLevel:
        """요약 등급 (8-2절).

        단순 최대값이 아니라 :data:`_SUMMARY_ORDER` 순서로 고른다 —
        ``RiskLevel.UNAVAILABLE.level`` 이 −1이라 그대로 max를 걸면
        「흘러내림 판정 불가 + 나머지 없음」이 「없음」으로 접힌다.
        **판정하지 못했다는 사실이 요약에서 사라지면 안 된다.**
        """
        if not self.findings:
            return RiskLevel.UNAVAILABLE
        return max(self.findings, key=lambda f: _SUMMARY_ORDER[f.level]).level

    @property
    def unavailable(self) -> tuple[RiskFinding, ...]:
        """판정 근거가 없어 회색 처리해야 하는 항목들 (8-2절)."""
        return tuple(f for f in self.findings if not f.available)

    @property
    def actionable(self) -> tuple[RiskFinding, ...]:
        """사용자에게 대응을 물어야 하는 항목들 (보통 이상)."""
        return tuple(f for f in self.findings if f.level.is_actionable)


def assess(
    profile: ThicknessProfile,
    *,
    method: GlazingMethod,
    safe_range_mm: tuple[float, float] = DEFAULT_SAFE_RANGE_MM,
    recipe: GlazeRecipe | None = None,
) -> RiskAssessment:
    """소성 전 위험을 판정하고 되돌림 선택지를 붙인다 (08절).

    절차:

    1. 8-1 ~ 8-3절 판정 — :func:`~kiln.risk.findings.evaluate_findings`.
       분포 모델이 없는 시유 방법이면 흘러내림·응력 균열은 「판정 불가」로
       내려오지 「없음」으로 내려오지 **않는다**(8-2절).
    2. 8-4절 선택지 — 대응이 필요한 항목이 있거나(**보통** 이상),
       판정하지 못한 항목이 있으면 되돌림 선택지를 낸다.

    **판정 불가일 때도 선택지를 내는 이유**: 8-2절이 「판정 불가」를 등급으로
    둔 목적은 사용자가 그 사실을 알고 스스로 판단하게 하는 것이다. 위험을
    확인해주지 못하면서 되돌릴 기회까지 닫으면 회색 처리의 의미가 없다.
    반대로 모든 항목이 판정되었고 전부 「없음」·「낮음」이면 고를 것이 없으므로
    빈 튜플을 낸다.
    """
    findings = evaluate_findings(
        profile, method=method, safe_range_mm=safe_range_mm, recipe=recipe
    )

    needs_choice = any(f.level.is_actionable for f in findings) or any(
        not f.available for f in findings
    )
    distributed = method.has_distribution_model and profile.has_distribution
    options = (
        reversal_options(has_distribution=distributed) if needs_choice else ()
    )

    return RiskAssessment(findings=findings, options=options)
