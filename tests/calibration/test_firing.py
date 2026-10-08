"""kiln.calibration.firing — 소성조건 개인화 보정(목표-실제 광택 오차 누적)."""

from __future__ import annotations

from kiln.calibration.firing import FiringCoefficientTable, update_after_evaluated_run


def _table(**overrides) -> FiringCoefficientTable:
    base = dict(recipe_id="coastal-satin")
    base.update(overrides)
    return FiringCoefficientTable(**base)


def test_first_observation_becomes_the_initial_bias() -> None:
    update = update_after_evaluated_run(_table(), goal_gloss="satin", result_gloss="gloss")

    assert update.applied is True
    # SATIN(레벨 2) 목표에 GLOSS(레벨 4) 결과 — 오차 +2 (더 유광/과용융).
    assert update.observed_error_level == 2
    assert update.table.gloss_bias_level == 2.0
    assert update.table.calibration_runs == 1


def test_bias_accumulates_as_run_count_weighted_average() -> None:
    table = _table(gloss_bias_level=2.0, calibration_runs=1)

    # 두 번째 회차: 목표 SATIN(2), 실제 MATTE(1) — 이 회차 오차 -1.
    update = update_after_evaluated_run(table, goal_gloss="satin", result_gloss="matte")

    assert update.applied is True
    assert update.observed_error_level == -1
    # (2.0*1 + (-1)) / 2 = 0.5
    assert update.table.gloss_bias_level == 0.5
    assert update.table.calibration_runs == 2


def test_matching_target_and_result_yields_zero_error() -> None:
    update = update_after_evaluated_run(_table(), goal_gloss="satin", result_gloss="satin")

    assert update.applied is True
    assert update.observed_error_level == 0
    assert update.table.gloss_bias_level == 0.0


def test_missing_result_gloss_does_not_update() -> None:
    table = _table(gloss_bias_level=1.5, calibration_runs=3)

    update = update_after_evaluated_run(table, goal_gloss="satin", result_gloss=None)

    assert update.applied is False
    assert update.observed_error_level is None
    # 기존 누적치·회차 수는 그대로 보존된다 — 판정 불가를 지어내지 않는다.
    assert update.table.gloss_bias_level == 1.5
    assert update.table.calibration_runs == 3


def test_unknown_goal_label_does_not_update() -> None:
    update = update_after_evaluated_run(_table(), goal_gloss="", result_gloss="satin")

    assert update.applied is False
    assert update.observed_error_level is None


def test_unknown_result_label_does_not_update() -> None:
    update = update_after_evaluated_run(_table(), goal_gloss="satin", result_gloss="totally-unknown-label")

    assert update.applied is False
    assert update.observed_error_level is None


def test_running_defect_is_noted_but_not_folded_into_the_accumulator() -> None:
    """'흘러내림'은 과소성의 참고 신호로 notes에만 남고, 광택 오차 누적
    계산 자체(부호 있는 순서형 거리)는 바뀌지 않는다 — 서로 다른 신호를
    억지로 하나의 척도로 합치지 않는다(부록 A와 같은 태도)."""
    without_defect = update_after_evaluated_run(_table(), goal_gloss="satin", result_gloss="gloss")
    with_defect = update_after_evaluated_run(
        _table(), goal_gloss="satin", result_gloss="gloss", defects=("running",)
    )

    assert with_defect.table.gloss_bias_level == without_defect.table.gloss_bias_level
    assert any("흘러내림" in note for note in with_defect.notes)
    assert not any("흘러내림" in note for note in without_defect.notes)


def test_transparency_is_never_read_or_used() -> None:
    """이 모듈의 시그니처에 transparency 인자가 아예 없다는 것 자체가
    "투명도는 다루지 않는다"는 설계를 강제한다 — 실수로 섞여 들어갈
    길이 없다."""
    import inspect

    from kiln.calibration import firing

    params = inspect.signature(firing.update_after_evaluated_run).parameters
    assert "transparency" not in params
    assert "result_transparency" not in params
