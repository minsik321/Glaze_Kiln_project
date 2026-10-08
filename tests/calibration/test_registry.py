"""kiln.calibration.registry — 레시피별 계수 계열 격리 (Phase 5 3항)."""

from __future__ import annotations

from datetime import datetime

from kiln.calibration.registry import CoefficientTableStore
from kiln.domain.enums import GlazingMethod
from kiln.domain.models import DensityMeasurement, GlazingRecord, Ware, WareShape
from kiln.thickness.geometry import surface_area_m2

_RHO_SLIP = 1.45  # g(ρ)=1.0 정규화 기준점


def _ware() -> Ware:
    shape = WareShape(
        shape_id="cyl", name="원통 머그", profile=((0.0, 30.0), (120.0, 30.0))
    )
    return Ware(
        ware_id="w1",
        shape=shape,
        clay_body="백자토",
        bisque_temperature=780.0,
        glaze_interior=True,
    )


def _record(ware: Ware, weight_g: float, dip_seconds: float = 60.0) -> GlazingRecord:
    return GlazingRecord(
        record_id="r1",
        ware_id=ware.ware_id,
        batch_id="b1",
        method=GlazingMethod.DIPPING,
        weight_before=500.0,
        weight_after=500.0 + weight_g,
        dip_seconds=dip_seconds,
        density=DensityMeasurement(
            batch_id="b1",
            measured_at=datetime(2026, 1, 1, 10, 0),
            specific_gravity=_RHO_SLIP,
            minutes_since_stirring=2.0,
        ),
    )


def test_never_seen_recipe_gets_a_fresh_all_undetermined_table():
    store = CoefficientTableStore()
    table = store.get("recipe-a")
    assert table.recipe_id == "recipe-a"
    assert table.k1 is None
    assert table.k2 is None
    assert table.rho_dry is None
    assert table.calibration_runs == 0


def test_same_recipe_id_returns_the_same_stored_table():
    store = CoefficientTableStore()
    first = store.get("recipe-a")
    second = store.get("recipe-a")
    assert first is second


def test_updating_one_recipe_does_not_move_another_recipes_table():
    """두 레시피가 서로 다른, 서로 간섭하지 않는 계수 계열을 갖는다."""
    store = CoefficientTableStore()
    ware = _ware()

    # recipe-a 를 여러 회차 갱신한다.
    for _ in range(3):
        store.apply_run_update("recipe-a", _record(ware, weight_g=90.0), ware)

    # recipe-b 는 한 번도 건드리지 않았다 — 조회 시점에 비로소 생겨야 한다.
    assert "recipe-b" not in store.recipe_ids()
    b_before = store.get("recipe-b")
    assert b_before.k1 is None
    assert b_before.calibration_runs == 0

    a_table = store.get("recipe-a")
    assert a_table.k1 is not None
    assert a_table.calibration_runs == 3

    # recipe-b 를 갱신해도 recipe-a 는 그대로다.
    store.apply_run_update("recipe-b", _record(ware, weight_g=40.0), ware)
    a_table_after = store.get("recipe-a")
    assert a_table_after.k1 == a_table.k1
    assert a_table_after.calibration_runs == 3

    b_table = store.get("recipe-b")
    assert b_table.k1 is not None
    assert b_table.calibration_runs == 1
    assert b_table.k1 != a_table.k1


def test_calibration_runs_reads_through_to_the_recipes_own_table():
    store = CoefficientTableStore()
    ware = _ware()
    assert store.calibration_runs("recipe-a") == 0
    store.apply_run_update("recipe-a", _record(ware, weight_g=90.0), ware)
    assert store.calibration_runs("recipe-a") == 1
    assert store.calibration_runs("recipe-b") == 0


def test_put_overwrites_only_that_recipes_slot():
    store = CoefficientTableStore()
    ware = _ware()
    store.apply_run_update("recipe-a", _record(ware, weight_g=90.0), ware)
    store.apply_run_update("recipe-b", _record(ware, weight_g=40.0), ware)

    replaced = store.get("recipe-a")
    from dataclasses import replace

    store.put(replace(replaced, k2=0.4))
    assert store.get("recipe-a").k2 == 0.4
    assert store.get("recipe-b").k2 is None
