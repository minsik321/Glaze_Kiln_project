"""kiln.batch.dip_time — 6-1절 담금시간 역산.

**비중을 고정하고 담금시간만 역산한다.** 미지수 둘에 목표 하나면 해가
무수히 많다 — 그 사실 자체가 이 모듈의 설계 근거다.
"""

from __future__ import annotations

import pytest

from kiln import constants
from kiln.batch.density import g_rho
from kiln.batch.dip_time import recommend_dip_time


def test_recommendation_round_trips_to_the_target():
    """역산한 담금시간을 다시 정방향으로 넣으면 목표 두께가 나온다."""
    rec = recommend_dip_time(1.10, rho=1.45, absorption=1.0, k1=0.55)
    assert rec.feasible is True
    assert rec.predicted_mean_mm == pytest.approx(1.10, rel=1e-9)


def test_formula_matches_the_plan():
    """6-1절: t_dip = [(t_목표 − t_flow) / (k1·흡수율·g(ρ))]²."""
    k1, rho, absorption, target = 0.55, 1.50, 0.9, 1.20
    rec = recommend_dip_time(target, rho=rho, absorption=absorption, k1=k1)
    expected = (target / (k1 * absorption * g_rho(rho))) ** 2
    assert rec.seconds == pytest.approx(expected, rel=1e-12)


def test_flow_layer_is_subtracted_before_inverting():
    """t_flow 는 담금시간과 무관한 항이라 먼저 빼고 역산한다 (6-1절)."""
    plain = recommend_dip_time(1.20, rho=1.45, absorption=1.0, k1=0.55)
    with_flow = recommend_dip_time(
        1.20, rho=1.45, absorption=1.0, k1=0.55, t_flow_mm=0.30
    )
    assert with_flow.seconds < plain.seconds
    assert with_flow.predicted_mean_mm == pytest.approx(1.20, rel=1e-9)


def test_dip_time_grows_quadratically():
    """√t 모델이므로 두께를 2배로 하려면 담금시간은 4배다."""
    one = recommend_dip_time(1.00, rho=1.45, absorption=1.0, k1=0.55)
    two = recommend_dip_time(2.00, rho=1.45, absorption=1.0, k1=0.55)
    assert two.seconds == pytest.approx(4.0 * one.seconds, rel=1e-9)


def test_higher_density_needs_less_time():
    """6-2절: 고형분이 오르면 같은 두께를 더 짧게 담가 얻는다."""
    thin = recommend_dip_time(1.10, rho=1.35, absorption=1.0, k1=0.55)
    thick = recommend_dip_time(1.10, rho=1.60, absorption=1.0, k1=0.55)
    assert thick.seconds < thin.seconds


def test_k1_defaults_to_the_registry():
    """00절: 계수는 대장을 통한다."""
    explicit = recommend_dip_time(
        1.10, rho=1.45, absorption=1.0, k1=constants.get("k1").value
    )
    default = recommend_dip_time(1.10, rho=1.45, absorption=1.0)
    assert default.seconds == pytest.approx(explicit.seconds, rel=1e-12)


# ─── 도메인 가드 ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize("target", [0.30, 0.29999, 0.20])
def test_target_at_or_below_flow_layer_is_infeasible(target):
    """음수를 제곱해 "해가 있는 것처럼" 보이는 함정을 막는다 (6-1절 도메인 가드)."""
    rec = recommend_dip_time(
        target, rho=1.45, absorption=1.0, k1=0.55, t_flow_mm=0.30
    )
    assert rec.feasible is False
    assert rec.seconds == 0.0
    assert "도달할 수 없다" in rec.reason


def test_infeasible_case_reports_the_flow_layer_thickness():
    rec = recommend_dip_time(0.20, rho=1.45, absorption=1.0, k1=0.55, t_flow_mm=0.30)
    assert "0.300mm" in rec.reason
    assert rec.predicted_mean_mm == pytest.approx(0.30)


@pytest.mark.parametrize(("k1", "absorption"), [(0.0, 1.0), (1.0, 0.0), (-0.5, 1.0)])
def test_non_positive_denominator_is_infeasible(k1, absorption):
    rec = recommend_dip_time(1.10, rho=1.45, absorption=absorption, k1=k1)
    assert rec.feasible is False
    assert "역산할 수 없다" in rec.reason


def test_feasible_recommendation_has_no_reason_text():
    rec = recommend_dip_time(1.10, rho=1.45, absorption=1.0, k1=0.55)
    assert rec.reason == ""
