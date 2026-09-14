"""kiln.firing.loading — 적재 점유율과 총량 이상 감지 (9-2절).

9-2절 수치로 회귀를 건다:

    30L 가마(내화물 45kg, 선반 6kg), 100℃/h
      기물  0kg → 1400 W   3kg → 1467 W (+4.8%)   10kg → 1622 W (+15.9%)
      10kg 등록 vs 12kg 실제 = 신호 차 2.7%
      계통 불확실 ≈ ±10% (공급전압 ±5% → 전력 ±10%)
"""

from __future__ import annotations

import pytest

from kiln.domain.models import Ware, WareShape
from kiln.firing.loading import (
    RESPONSE_PER_KG,
    SYSTEMATIC_UNCERTAINTY,
    check_loading,
    packing_ratio,
)

BASELINE_W = 1400.0


def _ware(footprint_m2: float, ware_id: str = "w") -> Ware:
    shape = WareShape(shape_id="s", name="원통", profile=((0.0, 30.0), (120.0, 30.0)))
    return Ware(
        ware_id=ware_id,
        shape=shape,
        clay_body="석기토",
        bisque_temperature=800.0,
        footprint_area=footprint_m2,
    )


# ─── 점유율 ─────────────────────────────────────────────────────────────────


def test_packing_ratio_is_footprint_sum_over_shelf_area():
    wares = [_ware(0.01, "a"), _ware(0.02, "b"), _ware(0.03, "c")]
    assert packing_ratio(wares, 0.24) == pytest.approx(0.25)


def test_packing_ratio_of_an_empty_kiln_is_zero():
    assert packing_ratio([], 0.24) == 0.0


def test_packing_ratio_rejects_nonpositive_shelf_area():
    """0으로 나누지 않는다 — 선반 면적은 점유율의 분모다."""
    with pytest.raises(ValueError):
        packing_ratio([_ware(0.01)], 0.0)
    with pytest.raises(ValueError):
        packing_ratio([_ware(0.01)], -0.1)


def test_packing_ratio_above_one_is_not_clipped():
    """다단 적재는 실제로 일어난다. 잘라 버리면 '선반이 넘쳤다'가 사라진다."""
    assert packing_ratio([_ware(0.30)], 0.24) == pytest.approx(1.25)


# ─── 9-2절 회귀: 승온 응답의 크기 ───────────────────────────────────────────


def test_9_2_response_per_kg_reproduces_the_worked_example():
    """9-2절 예제: 0kg→1400W, 3kg→1467W(+4.8%), 10kg→1622W(+15.9%)."""
    assert BASELINE_W * (1.0 + 3.0 * RESPONSE_PER_KG) == pytest.approx(1467.0, abs=2.0)
    assert BASELINE_W * (1.0 + 10.0 * RESPONSE_PER_KG) == pytest.approx(1622.0, abs=1.0)
    assert 3.0 * RESPONSE_PER_KG == pytest.approx(0.048, abs=0.001)
    assert 10.0 * RESPONSE_PER_KG == pytest.approx(0.159, abs=0.001)


def test_9_2_ten_kg_declared_versus_twelve_kg_actual_is_a_2_7_percent_signal():
    """9-2절: "10kg 등록 vs 12kg 실제 = 신호 차 2.7%" — 그리고 걸리지 않는다.

    이것이 이 모듈의 존재 이유이자 한계다. 신호(2.7%)가 계통 불확실(±10%)보다
    작으므로 **어떤 정직한 임계로도 잡히지 않는다.** 부록 E가 "승온 응답
    역산으로 적재량 검증"을 폐기한 이유가 이 한 줄이다.
    """
    observed = BASELINE_W * (1.0 + 12.0 * RESPONSE_PER_KG)
    check = check_loading(10.0, observed, BASELINE_W)
    expected = BASELINE_W * (1.0 + 10.0 * RESPONSE_PER_KG)
    assert (observed - expected) / expected == pytest.approx(0.027, abs=0.002)
    assert check.gross_error is False


# ─── 임계값 — 계통 불확실보다 커야 한다 ─────────────────────────────────────


def test_default_threshold_exceeds_the_systematic_uncertainty():
    """9-2절: 임계를 계통 불확실보다 크게 잡는다."""
    assert 0.20 > SYSTEMATIC_UNCERTAINTY
    check = check_loading(5.0, BASELINE_W * 1.08, BASELINE_W)
    assert check.threshold == 0.20


def test_threshold_below_systematic_uncertainty_is_refused():
    """임계를 계통 불확실 아래로 내리면 전압 변동을 적재 이상으로 오보한다."""
    with pytest.raises(ValueError) as exc:
        check_loading(10.0, 1600.0, BASELINE_W, threshold=0.05)
    assert "계통 불확실" in str(exc.value)


def test_threshold_exactly_at_the_systematic_uncertainty_is_refused():
    with pytest.raises(ValueError):
        check_loading(10.0, 1600.0, BASELINE_W, threshold=SYSTEMATIC_UNCERTAINTY)


# ─── 총량 이상 감지 ─────────────────────────────────────────────────────────


def test_gross_error_fires_on_a_large_mismatch():
    """등록 2kg인데 실제로 25kg이 들어가면 편차가 임계를 넘는다."""
    observed = BASELINE_W * (1.0 + 25.0 * RESPONSE_PER_KG)
    check = check_loading(2.0, observed, BASELINE_W)
    assert check.gross_error is True
    assert "총량 이상" in check.message


def test_gross_error_fires_when_the_kiln_is_far_emptier_than_declared():
    check = check_loading(30.0, BASELINE_W, BASELINE_W)
    assert check.gross_error is True


def test_message_never_claims_loading_misregistration():
    """9-2절·부록 A: "적재 오등록 판별"은 주장하지 않는다."""
    check = check_loading(10.0, 1650.0, BASELINE_W)
    assert "총량 이상 감지" in check.message
    assert "적재 오등록 판별이 아니다" in check.message
    assert "계통 불확실" in check.message


def test_packing_ratio_is_carried_through_into_the_check():
    check = check_loading(5.0, 1500.0, BASELINE_W, packing_ratio_value=0.42)
    assert check.packing_ratio == pytest.approx(0.42)


# ─── 도메인 가드 ────────────────────────────────────────────────────────────


def test_nonpositive_baseline_raises():
    with pytest.raises(ValueError):
        check_loading(10.0, 1600.0, 0.0)


def test_negative_declared_load_raises():
    with pytest.raises(ValueError):
        check_loading(-1.0, 1600.0, BASELINE_W)


def test_supply_voltage_swing_alone_does_not_trip_the_threshold():
    """공급전압 ±5% → 전력 ±10%. 이것만으로는 이상이 아니어야 한다 (9-2절)."""
    expected = BASELINE_W * (1.0 + 8.0 * RESPONSE_PER_KG)
    for swing in (0.90, 1.10):
        check = check_loading(8.0, expected * swing, BASELINE_W)
        assert check.gross_error is False
