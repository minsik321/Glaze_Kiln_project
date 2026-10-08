"""Outcome-based trial targets for one recipe, not physical calibration.

Only explicitly reviewed, complete outcomes are eligible. Target-matching,
defect-free outcomes support observed settings. Running/crawling supports a
bounded thinner-coat trial hypothesis, not a claim about defect causality.
The policy steps below are simulator assumptions, not measured constants or
established safe windows. k1, k2 and rho_dry are never updated here.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from math import isfinite

__all__ = [
    "DensityCoefficientTable", "DensityRunUpdate", "NextTrialSuggestion",
    "suggest_next_trial", "update_after_evaluated_run",
]

_GLOSS = {"matte", "satin", "gloss"}
_TRANSPARENCY = {"opaque", "translucent", "transparent"}
_DEFECTS = {"pinholes", "crawling", "crazing", "running"}
_DENSITY_MARGIN = 0.03
_DENSITY_STEP = 0.01
_THICKNESS_FACTOR = 0.90
#: 시험 제안의 변화 폭 — 실측으로 정한 값이 아니라 MVP 시작값(시뮬레이터 가정)이다.
#: "차이가 있어요"는 전체 폭, "목표에 가까워요"인데 일부 항목만 어긋나면 절반 폭.
_TRIAL_THICKNESS_PCT = 10.0
_TRIAL_HOLD_MIN = 10
_RELATIVE_LESS = {"much_less", "less"}
_RELATIVE_MORE = {"much_more", "more"}
_DEFAULT_SAFE_THICKNESS_MM = (0.8, 1.3)


@dataclass(frozen=True, slots=True)
class NextTrialSuggestion:
    """한 번의 평가에서 나온 "다음 시도 제안" 1건 (추정, 학습값 아님).

    학습값(`specific_gravity_range`, `next_trial_thickness_mm`)과 따로 저장한다 —
    "차이가 있어요" 한 번만으로 학습값이 흔들리지 않게 하면서도, 사용자가 바로
    시험해 볼 조건은 보여 주기 위해서다. 평가할 때마다 새로 계산해 덮어쓴다.

    ``variable``은 한 번에 하나만 바꾼다: ``"thickness"``(건조층 두께, ``change_pct``와
    ``thickness_mm``), ``"hold"``(소성 유지시간, ``hold_delta_min``), ``"none"``.
    """

    trigger: str  # defect | gloss | transparency | texture | color | none
    variable: str  # thickness | hold | none
    magnitude: str  # full | half | none
    message: str
    change_pct: float | None = None
    thickness_mm: float | None = None
    hold_delta_min: int | None = None
    estimated: bool = True


@dataclass(frozen=True, slots=True)
class DensityCoefficientTable:
    """`next_trial_thickness_mm` is a personal next-attempt suggestion, never a
    safety boundary — it must not share storage or a display slot with
    `kiln.domain.models.CoefficientTable.safe_thickness_mm` (08절 위험 판정
    경계, `kiln.risk`). Colliding the two silently replaces the safety
    threshold shown on the thickness risk screen with whatever thickness a
    past personal run happened to use.
    """

    recipe_id: str
    specific_gravity_range: tuple[float, float] | None = None
    calibration_runs: int = 0
    provenance_notes: tuple[str, ...] = ()
    next_trial_thickness_mm: tuple[float, float] | None = None
    successful_runs: int = 0
    failed_runs: int = 0
    anchor_specific_gravity: float | None = None
    anchor_thickness_mm: float | None = None
    suggestion: NextTrialSuggestion | None = None


@dataclass(frozen=True, slots=True)
class DensityRunUpdate:
    table: DensityCoefficientTable
    applied: bool
    notes: tuple[str, ...]


def _label(value: str | None) -> str:
    return value.strip().lower() if isinstance(value, str) else ""


def _valid(value: float | None, lo: float, hi: float) -> bool:
    return value is not None and not isinstance(value, bool) and isfinite(value) and lo <= value <= hi


def _clamp(value: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, value))


def _center(bounds: tuple[float, float] | None, fallback: float) -> float:
    return sum(bounds) / 2 if bounds else fallback


def update_after_evaluated_run(
    table: DensityCoefficientTable,
    *,
    specific_gravity: float | None,
    mean_thickness_mm: float | None = None,
    goal_gloss: str | None = None,
    goal_transparency: str | None = None,
    result_gloss: str | None = None,
    result_transparency: str | None = None,
    overall: str | None = None,
    defects: tuple[str, ...] = (),
    defects_reviewed: bool = False,
) -> DensityRunUpdate:
    """Recommend next trial settings; retain failure evidence without inventing success.

    A missing defect review is not a clean result. A defect-free but off-target
    result is not a successful sample. Failure-driven movement is anchored to
    the first usable observation (density -0.05, thickness -25% maximum), so
    repeated failures cannot silently ratchet targets towards zero.
    """
    def skip(reason: str) -> DensityRunUpdate:
        return DensityRunUpdate(table=replace(table), applied=False, notes=(reason,))

    goal_g, goal_t = _label(goal_gloss), _label(goal_transparency)
    result_g, result_t = _label(result_gloss), _label(result_transparency)
    if (not defects_reviewed or overall not in {"close", "different"}
            or goal_g not in _GLOSS or result_g not in _GLOSS
            or goal_t not in _TRANSPARENCY or result_t not in _TRANSPARENCY):
        return skip("광택·투명도·전체 평가·결함 확인이 완전하지 않아 추천을 갱신하지 않습니다.")
    if any(defect not in _DEFECTS for defect in defects):
        return skip("알 수 없는 결함 기록은 자동 추천에 사용하지 않습니다.")

    success = overall == "close" and not defects and (goal_g, goal_t) == (result_g, result_t)
    thinner_trial = bool({"running", "crawling"}.intersection(defects))
    density_valid = _valid(specific_gravity, 1.0, 2.5)
    thickness_valid = _valid(mean_thickness_mm, 0.05, 5.0)
    if not density_valid and not thickness_valid:
        return skip("유효한 비중·건조층 두께가 없어 다음 시유 조건을 제안할 수 없습니다.")

    density_range = table.specific_gravity_range
    thickness_range = table.next_trial_thickness_mm
    density_anchor = table.anchor_specific_gravity
    thickness_anchor = table.anchor_thickness_mm
    notes = ["개인 결과 기반 다음 실험 제안(휴리스틱)입니다. 검증된 안전범위·결함 원인 또는 물리 계수 보정이 아닙니다."]
    if success:
        notes.append("결함 확인 완료, 전체 평가 및 광택·투명도가 목표에 맞은 회차의 조건을 반영했습니다.")
    elif thinner_trial:
        notes.append("흘러내림/기어감 관측: 원인은 확정할 수 없으며, 두께 10%·비중 0.01 감소를 제한된 다음 실험 후보로 제안합니다.")
    else:
        notes.append("목표와 다르거나 다른 결함이 있습니다. 조성·소성 등 원인을 구분할 근거가 없어 두께·비중의 방향은 유지합니다.")

    if density_valid and (success or thinner_trial):
        assert specific_gravity is not None
        density_anchor = density_anchor if density_anchor is not None else specific_gravity
        previous = _center(density_range, specific_gravity)
        if success:
            center = previous + _clamp(specific_gravity - previous, -0.02, 0.02)
        else:
            center = max(min(previous, specific_gravity - _DENSITY_STEP), density_anchor - 0.05)
        center = _clamp(center, 1.03, 2.47)
        density_range = (round(center - _DENSITY_MARGIN, 4), round(center + _DENSITY_MARGIN, 4))
        notes.append(f"관측 비중 {specific_gravity:.3f} → 다음 실험 범위 {density_range}; 최초 관측 {density_anchor:.3f} 기준 감소 한도 0.05.")

    if thickness_valid and (success or thinner_trial):
        assert mean_thickness_mm is not None
        thickness_anchor = thickness_anchor if thickness_anchor is not None else mean_thickness_mm
        previous = _center(thickness_range, mean_thickness_mm)
        if success:
            center = previous + _clamp(mean_thickness_mm - previous, -previous * 0.1, previous * 0.1)
        else:
            center = max(min(previous, mean_thickness_mm * _THICKNESS_FACTOR), thickness_anchor * 0.75)
        center = _clamp(center, 0.06, 4.5)
        thickness_range = (round(center * 0.90, 4), round(center * 1.10, 4))
        notes.append(f"관측 건조층 두께 {mean_thickness_mm:.3f}mm → 다음 실험 범위 {thickness_range}mm; 최초 관측 기준 중심 감소 한도 25%.")

    if thinner_trial:
        notes.append("여러 조건이 함께 바뀌면 원인을 분리할 수 없습니다. 작은 시험편에서 조건별 재확인이 필요합니다.")
    updated = replace(
        table,
        specific_gravity_range=density_range,
        next_trial_thickness_mm=thickness_range,
        calibration_runs=table.calibration_runs + 1,
        successful_runs=table.successful_runs + int(success),
        failed_runs=table.failed_runs + int(not success),
        anchor_specific_gravity=density_anchor,
        anchor_thickness_mm=thickness_anchor,
        provenance_notes=tuple(notes),
    )
    return DensityRunUpdate(table=updated, applied=True, notes=tuple(notes))


def suggest_next_trial(
    table: DensityCoefficientTable,
    *,
    overall: str | None,
    defects: tuple[str, ...] = (),
    defects_reviewed: bool = False,
    gloss_comparison: str | None = None,
    transparency_comparison: str | None = None,
    texture_comparison: str | None = None,
    color: str | None = None,
    mean_thickness_mm: float | None = None,
    safe_thickness_mm: tuple[float, float] | None = None,
) -> NextTrialSuggestion | None:
    """평가 1건에서 "다음 시도 제안" 1건을 만든다. 평가가 완전하지 않으면 ``None``.

    어긋난 항목 중 우선순위(결함 > 광택 > 투명도 > 질감 > 색상)가 가장 높은 것
    하나만, 변수 하나만 바꾼다 — 한 번에 여러 변수를 바꾸면 원인을 분리할 수 없다.
    원인은 확정할 수 없으므로 모든 제안은 추정이며 조성은 자동으로 바꾸지 않는다.
    두께 제안은 위험 판정 안전 범위 안으로 제한한다.
    """
    if not defects_reviewed or overall not in {"close", "different"}:
        return None
    known_defects = tuple(d for d in defects if d in _DEFECTS)
    full = overall == "different"
    scale = 1.0 if full else 0.5
    magnitude = "full" if full else "half"
    lo, hi = safe_thickness_mm or _DEFAULT_SAFE_THICKNESS_MM

    # 두께 제안의 기준값: 이 레시피의 다음 시도 중심 → 이번 관측 두께 → 없음
    base = _center(table.next_trial_thickness_mm, mean_thickness_mm) if (
        table.next_trial_thickness_mm or _valid(mean_thickness_mm, 0.05, 5.0)
    ) else None

    def thickness(trigger: str, sign: int, reason: str) -> NextTrialSuggestion:
        pct = sign * _TRIAL_THICKNESS_PCT * scale
        target = None
        if base is not None:
            target = round(_clamp(base * (1 + pct / 100), lo, hi), 3)
        where = f" · 약 {target:.2f}mm" if target is not None else ""
        arrow = "+" if sign > 0 else "−"
        return NextTrialSuggestion(
            trigger=trigger, variable="thickness", magnitude=magnitude, change_pct=pct,
            thickness_mm=target,
            message=f"{reason} → 두께 {arrow}{abs(pct):g}%{where} (추정)",
        )

    def hold(trigger: str, sign: int, reason: str) -> NextTrialSuggestion:
        minutes = int(round(sign * _TRIAL_HOLD_MIN * scale))
        arrow = "+" if sign > 0 else "−"
        return NextTrialSuggestion(
            trigger=trigger, variable="hold", magnitude=magnitude, hold_delta_min=minutes,
            message=f"{reason} → 유지시간 {arrow}{abs(minutes)}분 (추정)",
        )

    if known_defects:
        names = {"pinholes": "핀홀", "crawling": "기어감", "crazing": "잔금", "running": "흘러내림"}
        label = "·".join(names[d] for d in known_defects)
        return thickness("defect", -1, label)
    if gloss_comparison in _RELATIVE_LESS:
        return hold("gloss", +1, "광택 덜함")
    if gloss_comparison in _RELATIVE_MORE:
        return hold("gloss", -1, "광택 강함")
    if transparency_comparison in _RELATIVE_LESS:
        return thickness("transparency", -1, "너무 불투명")
    if transparency_comparison in _RELATIVE_MORE:
        return thickness("transparency", +1, "너무 투명")
    if texture_comparison in _RELATIVE_MORE:
        return hold("texture", +1, "질감 거침")
    if color == "lighter":
        return thickness("color", +1, "색 밝음")
    if color == "darker":
        return thickness("color", -1, "색 어두움")
    if color == "different":
        return NextTrialSuggestion(
            trigger="color", variable="none", magnitude="none",
            message="다른 색 → 조정 없음 (기록만 남김)",
        )
    return NextTrialSuggestion(
        trigger="none", variable="none", magnitude="none",
        message=("어긋난 항목 없음 → 조정 없음" if full else "목표와 일치 → 현재 조건 유지"),
    )
