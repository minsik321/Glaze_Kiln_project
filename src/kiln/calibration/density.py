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

__all__ = ["DensityCoefficientTable", "DensityRunUpdate", "update_after_evaluated_run"]

_GLOSS = {"matte", "satin", "gloss"}
_TRANSPARENCY = {"opaque", "translucent", "transparent"}
_DEFECTS = {"pinholes", "crawling", "crazing", "running"}
_DENSITY_MARGIN = 0.03
_DENSITY_STEP = 0.01
_THICKNESS_FACTOR = 0.90


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
