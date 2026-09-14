"""kiln.batch.density — 6-2 · 6-3 · 6-4절 비중의 두 경로와 경고 분기."""

from __future__ import annotations

from datetime import datetime

import pytest

from kiln import constants
from kiln.batch.density import DensityStatus, assess_density, g_rho, m_rho
from kiln.domain.models import DensityMeasurement

_NOW = datetime(2026, 9, 10, 12, 0, 0)
TARGET = (1.40, 1.50)


def _m(rho: float, minutes: float = 1.0) -> DensityMeasurement:
    return DensityMeasurement(
        batch_id="b1",
        measured_at=_NOW,
        specific_gravity=rho,
        minutes_since_stirring=minutes,
    )


# ─── 6-2절 · 비중의 두 경로 ──────────────────────────────────────────────────


def test_both_paths_are_normalized_at_the_reference_density():
    """g(ρ)·m(ρ)는 ρ=1.45에서 1.0이다 — 정규화 기준점(부록 C)."""
    assert g_rho(1.45) == pytest.approx(1.0, rel=1e-12)
    assert m_rho(1.45) == pytest.approx(1.0, rel=1e-12)


@pytest.mark.parametrize("fn", [g_rho, m_rho])
def test_both_paths_are_monotone_increasing(fn):
    """고형분이 오르면 두 경로 모두 커진다 (6-2절)."""
    values = [fn(rho) for rho in (1.20, 1.35, 1.45, 1.55, 1.70)]
    assert all(a < b for a, b in zip(values, values[1:]))


def test_flow_path_exists_at_all():
    """6-2절 수정의 핵심: v5는 비중을 흡수층에만 넣었다. m(ρ)가 그 수정이다.

    되직하면 항복응력이 올라 흘러내리는 막 자체가 두꺼워진다 — 비중이
    t_flow 에도 들어가야 본문 서술("되직 → 두껍게 붙어 흘러내림 위험")과
    수식이 맞는다.
    """
    assert m_rho(1.60) > m_rho(1.45) > m_rho(1.30)


def test_exponents_come_from_the_registry_not_from_literals():
    """00절: 계수 값을 코드에 직접 쓰지 않는다. 대장을 통한다."""
    g_exp = constants.get("g_rho").value
    m_exp = constants.get("m_rho").value
    assert g_rho(1.60) == pytest.approx((1.60 / 1.45) ** g_exp, rel=1e-12)
    assert m_rho(1.60) == pytest.approx((1.60 / 1.45) ** m_exp, rel=1e-12)


def test_explicit_exponent_overrides_the_registry():
    assert g_rho(1.45 * 2, exponent=1.0) == pytest.approx(2.0, rel=1e-12)
    assert m_rho(1.45 * 2, exponent=2.0) == pytest.approx(4.0, rel=1e-12)


# ─── 6-4절 · 경고 분기 ───────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("rho", "status"),
    [
        (1.40, DensityStatus.OK),
        (1.45, DensityStatus.OK),
        (1.50, DensityStatus.OK),
        (1.35, DensityStatus.TOO_THIN),
        (1.31, DensityStatus.TOO_THIN),
        (1.55, DensityStatus.TOO_THICK),
        (1.60, DensityStatus.TOO_THICK),
        (1.25, DensityStatus.OUT_OF_RANGE),
        (1.75, DensityStatus.OUT_OF_RANGE),
    ],
)
def test_status_bands(rho, status):
    """6-4절 표의 네 행. 극단 경계는 권장 범위 폭의 두 배 바깥이다."""
    assert assess_density(_m(rho), target=TARGET).status is status


@pytest.mark.parametrize("rho", [1.05, 1.25, 1.45, 1.55, 1.90])
def test_warning_never_blocks_progress(rho):
    """6-4절: **경고가 떠도 진행을 막지 않는다.** 어떤 분기에서도 False다."""
    assert assess_density(_m(rho), target=TARGET).blocks_progress is False


@pytest.mark.parametrize("rho", [1.05, 1.35, 1.45, 1.55, 1.90])
def test_every_advice_carries_its_provenance(rho):
    """6-4절: 화면의 권장 범위 수치에는 출처를 병기한다."""
    advice = assess_density(_m(rho), target=TARGET)
    assert advice.annotation == "(문헌 추정 초기값 · 캘리브레이션 전)"
    assert advice.message.strip()


def test_out_of_range_says_the_model_no_longer_applies():
    advice = assess_density(_m(1.90), target=TARGET)
    assert advice.status is DensityStatus.OUT_OF_RANGE
    assert "예측 신뢰도" in advice.message
    assert advice.remeasure_recommended is True


def test_thick_and_thin_advise_opposite_corrections():
    thick = assess_density(_m(1.55), target=TARGET).message
    thin = assess_density(_m(1.35), target=TARGET).message
    assert "물을 소량 추가" in thick
    assert "따라내고" in thin


# ─── 6-3절 · 측정은 순간에 귀속된다 ──────────────────────────────────────────


def test_settling_triggers_remeasure_even_when_the_value_is_fine():
    """6-3절: 비중은 배치가 아니라 순간에 귀속된다. 침강이 진행 중이면 재측정."""
    advice = assess_density(_m(1.45, minutes=25.0), target=TARGET)
    assert advice.status is DensityStatus.OK
    assert advice.remeasure_recommended is True
    assert "25분 경과" in advice.message


def test_fresh_measurement_in_range_needs_no_remeasure():
    advice = assess_density(_m(1.45, minutes=2.0), target=TARGET)
    assert advice.remeasure_recommended is False


def test_settling_limit_is_configurable():
    fast_settling = assess_density(_m(1.45, minutes=6.0), target=TARGET, settling_limit_min=5.0)
    assert fast_settling.remeasure_recommended is True
