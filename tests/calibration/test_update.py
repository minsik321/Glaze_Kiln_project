"""kiln.calibration.update — 10-2절 회차 되먹임 · 7-5절 재캘리브레이션 트리거."""

from __future__ import annotations

import math
from datetime import datetime

import pytest

from kiln.calibration.tiles import mean_thickness_from_weight
from kiln.calibration.update import (
    check_bisque_change,
    run_update,
    update_after_run,
)
from kiln.domain.enums import GlazingMethod
from kiln.domain.models import (
    CoefficientTable,
    DensityMeasurement,
    GlazingRecord,
    Ware,
    WareShape,
)
from kiln.thickness.geometry import surface_area_m2

_RHO_DRY = 1.40
_RHO_SLIP = 1.45  # g(ρ)=1.0이 되는 정규화 기준점


def _ware(bisque_c: float = 780.0) -> Ware:
    shape = WareShape(
        shape_id="cyl", name="원통 머그", profile=((0.0, 30.0), (120.0, 30.0))
    )
    return Ware(
        ware_id="w1",
        shape=shape,
        clay_body="백자토",
        bisque_temperature=bisque_c,
        glaze_interior=True,
    )


def _record_for_k1(
    k1: float,
    ware: Ware,
    *,
    dip_seconds: float = 100.0,
    method: GlazingMethod = GlazingMethod.DIPPING,
    is_reglaze: bool = False,
    drying_complete: bool = True,
) -> GlazingRecord:
    """k1을 심어 저울 눈금(W)을 거꾸로 만든 시유 기록."""
    area = surface_area_m2(ware.shape, include_interior=ware.glaze_interior)
    mean_mm = k1 * math.sqrt(dip_seconds)  # 흡수율 1.0, g(1.45)=1.0
    w_g = mean_mm * _RHO_DRY * area * 1000.0
    return GlazingRecord(
        record_id="r1",
        ware_id=ware.ware_id,
        batch_id="b1",
        method=method,
        weight_before=500.0,
        weight_after=500.0 + w_g,
        dip_seconds=dip_seconds if method is GlazingMethod.DIPPING else None,
        density=DensityMeasurement(
            batch_id="b1",
            measured_at=datetime(2026, 1, 1, 10, 0),
            specific_gravity=_RHO_SLIP,
            minutes_since_stirring=2.0,
        ),
        is_reglaze=is_reglaze,
        drying_complete=drying_complete,
    )


def _table(**kw) -> CoefficientTable:
    base = {"recipe_id": "g1", "rho_dry": _RHO_DRY}
    base.update(kw)
    return CoefficientTable(**base)


# ─── k1 갱신 ─────────────────────────────────────────────────────────────────


def test_planted_k1_is_recovered_from_one_run():
    """회차 1건의 저울 눈금에서 k1이 되돌아온다 (10-2절: 매 회차·저울만).

    **12-2절 주의**: 무게를 만들 때 쓴 식과 되뽑는 식이 같으므로 이 복원은
    **자명하다.** 확인하는 것은 표면적·왁스·단위 환산 경로에 실수가 없다는
    것뿐이며, 모델 자체의 타당성이 아니다.
    """
    ware = _ware()
    table = _table()
    result = run_update(table, _record_for_k1(0.11, ware), ware)
    assert result.applied is True
    assert result.k1_estimate == pytest.approx(0.11, rel=1e-9)
    assert result.table.k1 == pytest.approx(0.11, rel=1e-9)
    assert result.table.calibration_runs == 1


def test_update_returns_a_new_frozen_table():
    """frozen dataclass — 제자리 수정이 아니라 새 테이블을 돌려준다."""
    ware = _ware()
    table = _table()
    new = update_after_run(table, _record_for_k1(0.11, ware), ware)
    assert new is not table
    assert isinstance(new, CoefficientTable)
    assert table.k1 is None  # 원본 불변
    assert new.recipe_id == table.recipe_id


def test_repeated_runs_average_and_count_up():
    """회차 수 가중 평균 — 회차가 쌓일수록 한 회차의 흔들림이 줄어든다."""
    ware = _ware()
    table = _table(k1=0.10, calibration_runs=3)
    new = update_after_run(table, _record_for_k1(0.14, ware), ware)
    assert new.k1 == pytest.approx((0.10 * 3 + 0.14) / 4, rel=1e-9)
    assert new.calibration_runs == 4


def test_unidentified_coefficients_stay_none():
    """10-2절 점선: k2·s는 저울 신호로 동정되지 않으므로 None으로 남는다."""
    ware = _ware()
    new = update_after_run(_table(), _record_for_k1(0.11, ware), ware)
    assert new.k2 is None
    assert new.s is None


def test_run_never_identifies_rho_dry():
    """7-3절: 회차 데이터는 저울뿐 — ρ_dry는 캘리퍼 경로에서만 움직인다."""
    ware = _ware()
    table = CoefficientTable(recipe_id="g1")  # ρ_dry 미동정
    result = run_update(table, _record_for_k1(0.11, ware), ware)
    assert result.table.rho_dry is None
    joined = " ".join(result.notes)
    assert "가정했다" in joined
    assert "캘리퍼 1회로 닫아야 한다" in joined
    assert result.solid == ("k1",)


def test_assumed_rho_dry_scales_k1_inversely():
    """ρ_dry 가정이 X배면 k1은 1/X배 — 곱으로만 식별되기 때문이다 (7-3절)."""
    ware = _ware()
    record = _record_for_k1(0.11, ware)
    a = run_update(_table(rho_dry=1.4), record, ware)
    b = run_update(_table(rho_dry=2.8), record, ware)
    assert b.k1_estimate == pytest.approx(a.k1_estimate / 2.0, rel=1e-9)


# ─── 갱신하지 않는 회차 ──────────────────────────────────────────────────────


def test_non_dipping_run_does_not_touch_k1():
    """7-5절: 담금이 아니면 t_abs 모델이 서지 않는다 — 분포도 k1도 없다."""
    ware = _ware()
    table = _table(k1=0.10, calibration_runs=2)
    record = _record_for_k1(0.11, ware, method=GlazingMethod.SPRAYING)
    result = run_update(table, record, ware)
    assert result.applied is False
    assert result.k1_estimate is None
    assert result.table.k1 == 0.10
    assert result.table.calibration_runs == 2
    assert result.solid == ()
    assert "담금의 t_abs 모델에서만" in " ".join(result.notes)


def test_reglaze_run_is_refused_to_protect_k1():
    """7-5절·부록 A: 재습윤으로 흡수율이 변한 회차를 먹이면 k1이 조용히 틀어진다."""
    ware = _ware()
    table = _table(k1=0.10, calibration_runs=2)
    record = _record_for_k1(0.11, ware, is_reglaze=True)
    result = run_update(table, record, ware)
    assert result.applied is False
    assert result.table.k1 == 0.10
    assert result.table.calibration_runs == 2
    joined = " ".join(result.notes)
    assert "재시유" in joined
    assert "흡수율 변화를 대신 삼킨다" in joined


def test_incomplete_drying_is_refused():
    """7-5절: 잔류 수분 2%면 두께 2% 과대 — 유약 무게가 아니다."""
    ware = _ware()
    result = run_update(
        _table(), _record_for_k1(0.11, ware, drying_complete=False), ware
    )
    assert result.applied is False
    assert "건조 종료 판정" in " ".join(result.notes)


def test_zero_glaze_weight_is_refused():
    ware = _ware()
    record = GlazingRecord(
        record_id="r0",
        ware_id=ware.ware_id,
        batch_id="b1",
        method=GlazingMethod.DIPPING,
        weight_before=500.0,
        weight_after=500.0,
        dip_seconds=100.0,
    )
    result = run_update(_table(), record, ware)
    assert result.applied is False
    assert "방정식이 서지 않는다" in " ".join(result.notes)


def test_waxed_area_is_excluded_from_the_anchor():
    """7-5절: 왁스 부위 면적은 A에서 제외한다. 미처리 시 총량 앵커가 깨진다."""
    ware = _ware()
    plain = _record_for_k1(0.11, ware)
    waxed = GlazingRecord(
        record_id="r2",
        ware_id=ware.ware_id,
        batch_id="b1",
        method=GlazingMethod.DIPPING,
        weight_before=plain.weight_before,
        weight_after=plain.weight_after,
        dip_seconds=plain.dip_seconds,
        density=plain.density,
        waxed_area_m2=0.004,
    )
    a = run_update(_table(), plain, ware)
    b = run_update(_table(), waxed, ware)
    # 같은 무게가 더 좁은 면적에 붙었으므로 두께가 두껍고 k1도 커진다.
    assert b.k1_estimate > a.k1_estimate


def test_estimate_matches_the_hand_computation():
    """산식 그대로 손계산과 일치하는지 — mean = W/(A·ρ_dry·1000)."""
    ware = _ware()
    record = _record_for_k1(0.11, ware, dip_seconds=64.0)
    area = surface_area_m2(ware.shape, include_interior=True)
    mean_mm = mean_thickness_from_weight(record.glaze_weight, area, _RHO_DRY)
    result = run_update(_table(), record, ware)
    assert result.k1_estimate == pytest.approx(mean_mm / math.sqrt(64.0), rel=1e-12)


# ─── 7-5절 재캘리브레이션 트리거 ─────────────────────────────────────────────


def test_same_bisque_temperature_does_not_trigger():
    assert check_bisque_change(780.0, _ware(780.0)).triggered is False


def test_bisque_change_triggers_recalibration_not_absorption():
    """7-5절: 초벌 온도 변경은 흡수율로 흡수하지 말고 재캘리브레이션한다."""
    trigger = check_bisque_change(780.0, _ware(900.0))
    assert trigger.triggered is True
    assert "재캘리브레이션" in trigger.reason
    assert "곱으로만 식별" in trigger.reason


def test_no_previous_bisque_record_does_not_trigger():
    trigger = check_bisque_change(None, _ware(900.0))
    assert trigger.triggered is False
    assert "비교할 대상이 없" in trigger.reason


def test_small_bisque_drift_within_tolerance():
    assert check_bisque_change(780.0, _ware(785.0), tolerance_c=10.0).triggered is False
    assert check_bisque_change(780.0, _ware(785.0), tolerance_c=1.0).triggered is True
