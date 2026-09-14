"""11절 데이터 모델이 **출처와 조건**을 잃지 않는지.

값만 나르는 스키마는 00절 약속을 되먹임 경로에서 조용히 깬다. 여기 걸린
회귀들은 전부 "그 값이 어디서 왔는가"를 데이터 모델이 들고 있게 하는 것이다.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from kiln.domain.enums import FailureType, Gloss, Grade, GlazingMethod, Transparency
from kiln.domain.models import (
    QUARTZ_INVERSION_C,
    CoefficientTable,
    CoolingSegment,
    FiringResult,
    FiringRun,
    GlazingRecord,
    KilnProfile,
    TargetCoordinate,
    Ware,
    WareShape,
)

_NOW = datetime(2026, 9, 13, 10, 0, 0)


def _ware(bisque_c: float = 800.0) -> Ware:
    return Ware(
        ware_id="w1",
        shape=WareShape(shape_id="s1", name="원통", profile=((0.0, 30.0), (60.0, 30.0))),
        clay_body="백자토",
        bisque_temperature=bisque_c,
        glaze_interior=False,
    )


def _record(glaze_g: float = 96.0) -> GlazingRecord:
    return GlazingRecord(
        record_id="g1",
        ware_id="w1",
        batch_id="b1",
        method=GlazingMethod.DIPPING,
        weight_before=500.0,
        weight_after=500.0 + glaze_g,
        dip_seconds=4.0,
    )


# ─── 9-4 · 10-3절 · 냉각은 회차에 귀속되는 자료다 ────────────────────────────


def test_firing_run_carries_its_cooling_plan():
    """냉각은 H로 접히지 않으므로(9-4절) 회차가 온도–시간 그대로 들고 있어야 한다."""
    cooling = (
        CoolingSegment(1100.0, 900.0, 50.0, "결정 성장"),
        CoolingSegment(700.0, QUARTZ_INVERSION_C, 40.0, "석영 전이 진입 전"),
    )
    run = FiringRun(
        run_id="r1", kiln_profile_id="p1", started_at=_NOW, cooling=cooling
    )
    assert run.cooling == cooling
    # 설정 스케줄과 **따로** 있다. 하나로 합치면 급냉/서냉 구분이 사라진다.
    assert run.schedule == ()


def test_cooling_segment_is_the_same_type_in_domain_and_firing():
    """`kiln.firing.cooling` 은 도메인 자료형을 재수출한다 — 두 개가 아니다."""
    from kiln.firing.cooling import CoolingSegment as FiringCoolingSegment

    assert FiringCoolingSegment is CoolingSegment


def test_quartz_inversion_is_not_crossed_inside_a_segment():
    """9-6절: 573℃ 석영 전이는 별도 세그먼트여야 한다."""
    assert CoolingSegment(700.0, 400.0, 40.0).crosses_quartz_inversion is True
    assert CoolingSegment(700.0, 573.0, 40.0).crosses_quartz_inversion is False
    assert CoolingSegment(573.0, 400.0, 40.0).crosses_quartz_inversion is False


def test_firing_run_carries_loading_inputs():
    """9-2절 총량 이상 감지가 회차에서 입력을 꺼낼 수 있어야 한다."""
    run = FiringRun(
        run_id="r1",
        kiln_profile_id="p1",
        started_at=_NOW,
        declared_kg=10.0,
        shelf_area_m2=0.18,
    )
    assert run.declared_kg == 10.0
    assert run.shelf_area_m2 == 0.18


# ─── 7-7절 · 파단면은 어디서 쟀는가 ──────────────────────────────────────────


def test_fracture_measurement_can_record_where_it_was_taken():
    """두께만 있고 위치가 없으면 국소 최대인지 알 수 없다 — k₂ 신호가 흐려진다."""
    result = FiringResult(
        record_id="g1",
        coordinate=TargetCoordinate(Gloss.SATIN, Transparency.OPAQUE),
        grade=Grade.AS_INTENDED,
        fracture_thickness_mm=1.05,
        fracture_z_mm=12.0,
    )
    assert result.fracture_z_mm == 12.0


def test_position_without_a_thickness_is_rejected():
    """위치는 두께의 해석을 돕는 부가 정보이지 그 자체로 관측이 아니다."""
    with pytest.raises(ValueError, match="두께가 없다"):
        FiringResult(
            record_id="g1",
            coordinate=TargetCoordinate(Gloss.SATIN, Transparency.OPAQUE),
            grade=Grade.AS_INTENDED,
            fracture_z_mm=12.0,
        )


def test_fracture_position_stays_optional():
    """캘리퍼 1점만 있는 기존 기록도 그대로 성립한다."""
    result = FiringResult(
        record_id="g1",
        coordinate=TargetCoordinate(Gloss.SATIN, Transparency.OPAQUE),
        grade=Grade.FAILED,
        failures=frozenset({FailureType.RUNNING}),
        fracture_thickness_mm=1.72,
    )
    assert result.fracture_z_mm is None


# ─── 9-6절 · 주위 온도는 프로필에 있다 ───────────────────────────────────────


def test_ambient_temperature_belongs_to_the_profile():
    """자연냉각률 역산과 서냉 비용이 **같은** 주위 온도를 써야 표와 어긋나지 않는다."""
    warm = KilnProfile(
        "p1", "더운 작업실", heat_capacity=58_000.0, ua=2.0, max_power=3_000.0,
        ambient_c=30.0,
    )
    cold = KilnProfile(
        "p2", "추운 작업실", heat_capacity=58_000.0, ua=2.0, max_power=3_000.0,
        ambient_c=10.0,
    )
    # 주위가 따뜻하면 온도차가 작아 천천히 식는다.
    assert warm.natural_cooling_rate(600.0) < cold.natural_cooling_rate(600.0)


def test_ambient_default_matches_the_plan_reference_kiln():
    """9-6절 표를 재현하는 기본값은 20℃다."""
    p = KilnProfile("p1", "30L", heat_capacity=58_000.0, ua=2500.0 / 1200.0, max_power=3_000.0)
    assert p.ambient_c == 20.0
    assert round(p.natural_cooling_rate(1220.0)) == 155


def test_cooling_cost_uses_the_profile_ambient():
    """서냉 비용도 프로필의 주위 온도를 쓴다 — 두 곳이 갈라지면 안 된다."""
    from kiln.firing.cooling import plan_cooling

    segs = (CoolingSegment(1100.0, 900.0, 50.0, "결정 성장"),)
    warm = plan_cooling(
        KilnProfile("p1", "더움", heat_capacity=58_000.0, ua=2.0, max_power=6_000.0, ambient_c=30.0),
        segs,
    )
    cold = plan_cooling(
        KilnProfile("p2", "추움", heat_capacity=58_000.0, ua=2.0, max_power=6_000.0, ambient_c=10.0),
        segs,
    )
    assert warm.feasible and cold.feasible
    # 추운 쪽이 더 많이 새므로 같은 냉각률을 유지하는 데 전력이 더 든다.
    assert cold.extra_kwh > warm.extra_kwh


def test_baseline_power_has_a_home():
    """9-2절 총량 이상 감지는 빈 가마 기준 유지전력을 회차마다 필요로 한다."""
    p = KilnProfile(
        "p1", "30L", heat_capacity=58_000.0, ua=2.0, max_power=3_000.0,
        baseline_power_w=1_400.0,
    )
    assert p.baseline_power_w == 1_400.0


# ─── 7-5 · 10-2절 · 계수 표가 출처와 조건을 들고 다닌다 ──────────────────────


def test_coefficient_table_carries_provenance():
    """00절: "가정한 ρ_dry 위에서 낸 k1"인지가 표만 봐서 구분되어야 한다."""
    from kiln.calibration.update import update_after_run

    table = update_after_run(CoefficientTable(recipe_id="r1"), _record(), _ware())
    assert table.k1 is not None
    assert table.provenance_notes
    assert any("ρ_dry" in n for n in table.provenance_notes)


def test_calibration_records_the_bisque_condition():
    """7-5절: **어떤 초벌 조건에서** 동정했는가가 표에 남아야 한다."""
    from kiln.calibration.update import update_after_run

    table = update_after_run(CoefficientTable(recipe_id="r1"), _record(), _ware(800.0))
    assert table.calibrated_bisque_c == 800.0


def test_bisque_change_stops_the_update_instead_of_absorbing_it():
    """7-5절: 초벌 온도 변경은 흡수가 아니라 **재캘리브레이션 트리거**다.

    흡수율은 k1과 곱으로만 식별되므로(부록 A) 초벌 변화를 그대로 먹이면
    k1이 그것을 대신 삼킨다 — 회귀는 수렴하는 것처럼 보이는데 값이 다른
    물리량을 가리키게 된다. 그래서 흡수하지 않고 멈춘다.
    """
    from kiln.calibration.update import run_update, update_after_run

    first = update_after_run(CoefficientTable(recipe_id="r1"), _record(), _ware(800.0))
    k1_after_first = first.k1

    # 같은 초벌 조건이면 계속 갱신된다.
    same = run_update(first, _record(glaze_g=104.0), _ware(800.0))
    assert same.applied is True
    assert same.table.calibration_runs == 2

    # 초벌 온도가 바뀌면 멈춘다.
    changed = run_update(first, _record(glaze_g=104.0), _ware(900.0))
    assert changed.applied is False
    assert changed.table.k1 == k1_after_first
    assert changed.table.calibration_runs == first.calibration_runs
    assert any("초벌" in n for n in changed.notes)


def test_first_calibration_is_not_blocked_by_a_missing_bisque_record():
    """비교할 이전 조건이 없으면 트리거하지 않는다 — 첫 회차가 막히면 안 된다."""
    from kiln.calibration.update import run_update

    fresh = run_update(CoefficientTable(recipe_id="r1"), _record(), _ware(800.0))
    assert fresh.applied is True
