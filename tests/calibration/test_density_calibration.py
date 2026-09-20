"""kiln.calibration.density — 회차 평가가 완전할 때만 레시피별 비중·두께 추천을 갱신한다.

update_after_evaluated_run의 실제 계약(src/kiln/calibration/density.py):
- 광택·투명도·전체 평가·결함 확인이 모두 채워져야만 갱신한다(평가 미완료 회차는 제외).
- 성공 회차는 중심을 최대 ±0.02(비중)/±10%(두께)만 이동한다(폭주 방지).
- running/crawling 결함은 더 얇은 시도를 제안하되 최초 관측 대비 -0.05(비중)/-25%(두께)를 넘지 않는다.
- 알 수 없는 결함 문자열이나 불완전한 평가는 표를 바꾸지 않고 applied=False를 반환한다.
"""

from __future__ import annotations

from kiln.calibration.density import DensityCoefficientTable, update_after_evaluated_run


def _table(**overrides) -> DensityCoefficientTable:
    base = dict(recipe_id="coastal-satin")
    base.update(overrides)
    return DensityCoefficientTable(**base)


def _success(**overrides) -> dict:
    base = dict(
        goal_gloss="satin",
        goal_transparency="translucent",
        result_gloss="satin",
        result_transparency="translucent",
        overall="close",
        defects=(),
        defects_reviewed=True,
    )
    base.update(overrides)
    return base


def _defect(**overrides) -> dict:
    base = dict(
        goal_gloss="satin",
        goal_transparency="translucent",
        result_gloss="matte",
        result_transparency="translucent",
        overall="different",
        defects=("running",),
        defects_reviewed=True,
    )
    base.update(overrides)
    return base


def test_first_observation_opens_a_margin_around_the_single_point() -> None:
    update = update_after_evaluated_run(_table(), specific_gravity=1.44, **_success())

    assert update.applied is True
    assert update.table.specific_gravity_range == (1.41, 1.47)
    assert update.table.calibration_runs == 1
    assert update.table.successful_runs == 1
    assert update.table.anchor_specific_gravity == 1.44


def test_second_success_observation_is_bounded_to_a_small_step() -> None:
    table = _table(
        specific_gravity_range=(1.41, 1.47),
        calibration_runs=1,
        successful_runs=1,
        anchor_specific_gravity=1.44,
    )

    update = update_after_evaluated_run(table, specific_gravity=1.50, **_success())

    assert update.applied is True
    # 관측이 0.06 벗어나 있어도 회차당 이동은 ±0.02로 제한된다 — 1.44 -> 1.46 중심.
    assert update.table.specific_gravity_range == (1.43, 1.49)
    assert update.table.calibration_runs == 2


def test_observation_at_existing_center_does_not_move_it() -> None:
    table = _table(
        specific_gravity_range=(1.43, 1.49),
        calibration_runs=2,
        successful_runs=2,
        anchor_specific_gravity=1.44,
    )

    update = update_after_evaluated_run(table, specific_gravity=1.46, **_success())

    assert update.applied is True
    assert update.table.specific_gravity_range == (1.43, 1.49)
    assert update.table.calibration_runs == 3


def test_running_defect_proposes_bounded_thinner_trial_but_not_below_anchor_floor() -> None:
    table = _table(
        specific_gravity_range=(1.43, 1.49),
        calibration_runs=3,
        successful_runs=3,
        anchor_specific_gravity=1.44,
    )

    update = update_after_evaluated_run(table, specific_gravity=1.30, **_defect())

    assert update.applied is True
    # 관측대로면 중심이 1.29까지 내려가지만, 최초 관측(1.44) 대비 -0.05 바닥에서 멈춘다.
    assert update.table.specific_gravity_range == (1.36, 1.42)
    assert update.table.calibration_runs == 4
    assert update.table.failed_runs == 1
    assert update.table.anchor_specific_gravity == 1.44


def test_incomplete_evaluation_is_rejected_even_with_valid_measurement() -> None:
    table = _table(specific_gravity_range=(1.41, 1.47), calibration_runs=1)

    update = update_after_evaluated_run(
        table, specific_gravity=1.44, **_success(defects_reviewed=False)
    )

    assert update.applied is False
    # 기존 범위·회차 수는 그대로 보존된다 — 불완전 기록을 학습에 쓰지 않는다.
    assert update.table.specific_gravity_range == (1.41, 1.47)
    assert update.table.calibration_runs == 1


def test_missing_measurements_are_rejected_once_evaluation_is_complete() -> None:
    table = _table(specific_gravity_range=(1.41, 1.47), calibration_runs=1)

    update = update_after_evaluated_run(
        table, specific_gravity=None, mean_thickness_mm=None, **_success()
    )

    assert update.applied is False
    assert update.table.specific_gravity_range == (1.41, 1.47)
    assert update.table.calibration_runs == 1


def test_unknown_defect_label_is_rejected() -> None:
    table = _table(specific_gravity_range=(1.41, 1.47), calibration_runs=1)

    update = update_after_evaluated_run(
        table, specific_gravity=1.44, **_defect(defects=("bloating",))
    )

    assert update.applied is False
    assert update.table.specific_gravity_range == (1.41, 1.47)
    assert update.table.calibration_runs == 1
