"""kiln.calibration.diagnosis — 7-4절 단위 일치 잔차 · 7-7절 사후 진단."""

from __future__ import annotations

from datetime import datetime

import pytest

from kiln import constants
from kiln.calibration.diagnosis import diagnose_deviation, residual_mm
from kiln.domain.enums import GlazingMethod
from kiln.domain.models import (
    DensityMeasurement,
    GlazingRecord,
    Ware,
    WareShape,
)
from kiln.thickness.profile import (
    ThicknessPoint,
    ThicknessProfile,
    compute_profile,
    fired_thickness,
)


def _profile(
    mean_mm: float = 1.0,
    local_max_mm: float = 1.3,
    *,
    has_distribution: bool = True,
    within_model_scope: bool = True,
) -> ThicknessProfile:
    return ThicknessProfile(
        points=(
            ThicknessPoint(z=0.0, radius=30.0, t_abs=mean_mm, t_flow=local_max_mm - mean_mm),
            ThicknessPoint(z=100.0, radius=30.0, t_abs=mean_mm, t_flow=0.0),
        ),
        area_m2=0.02,
        mean_mm=mean_mm,
        glaze_weight_g=28.0,
        rho_dry=1.4,
        has_distribution=has_distribution,
        within_model_scope=within_model_scope,
        provenance_notes=(),
    )


# ─── 7-4절 단위 일치 가드 ────────────────────────────────────────────────────


def test_mixing_green_and_fired_flips_the_residual_sign():
    """7-4절: 생두께와 소성후 두께를 그대로 빼면 잔차 부호가 뒤집힌다.

    예측 생두께 1.40mm, s=0.75, 파단면(소성후) 실측 1.20mm.
      순진한 차 : 1.40 − 1.20 = +0.20  → "예측이 두꺼웠다" → 계수를 낮춘다
      단위 일치 : 1.05 − 1.20 = −0.15  → "예측이 얇았다"   → 계수를 올린다
    부호가 반대이므로 계수가 **반대 방향으로 수렴한다.**
    """
    green, fired_measured, s = 1.40, 1.20, 0.75
    naive = green - fired_measured
    correct = residual_mm(green, fired_measured, s=s)
    assert naive == pytest.approx(0.20, rel=1e-9)
    assert correct == pytest.approx(-0.15, rel=1e-9)
    assert naive * correct < 0  # 부호가 서로 반대


def test_residual_uses_fired_thickness_and_ledger_s_by_default():
    """s를 생략하면 부록 C 대장의 압밀 계수를 쓴다 — 코드에 숫자를 박지 않는다."""
    s_default = constants.get("s").value
    assert residual_mm(1.40, 1.20) == pytest.approx(
        fired_thickness(1.40, s_default) - 1.20, rel=1e-12
    )


def test_residual_is_zero_when_prediction_matches_after_shrinkage():
    assert residual_mm(1.60, fired_thickness(1.60, 0.75), s=0.75) == pytest.approx(
        0.0, abs=1e-12
    )


# ─── 7-7절: 파단면이 없으면 진단하지 않는다 ─────────────────────────────────


def test_without_fracture_the_diagnosis_stays_closed():
    """7-7절: 예측 편차비로 진단하면 자기 입력을 되돌려줄 뿐이다."""
    d = diagnose_deviation(_profile(), None)
    assert d.available is False
    assert d.predicted_ratio is None
    assert d.observed_ratio is None
    assert d.residual is None
    assert "당신이 낮은 비중을 입력했습니다" in d.reason


def test_without_distribution_model_the_diagnosis_stays_closed():
    """분포가 없으면 편차비가 항상 1이다 — 관측이 아니라 표시일 뿐 (7-5·8-2절)."""
    d = diagnose_deviation(_profile(has_distribution=False), 0.9)
    assert d.available is False
    assert "판정 불가" in d.reason


def test_nonpositive_fracture_is_rejected():
    assert diagnose_deviation(_profile(), 0.0).available is False


# ─── 7-7절: 파단면이 있으면 열린다 ──────────────────────────────────────────


def test_with_fracture_both_ratios_are_reported_in_fired_units():
    """실측 편차비 = 파단면 / (평균·s) — 분자·분모가 같은 단위여야 한다 (7-4절)."""
    s = 0.75
    profile = _profile(mean_mm=1.0, local_max_mm=1.3)
    fracture = 0.90  # 소성 후 실측 [mm]
    d = diagnose_deviation(profile, fracture, s=s)

    assert d.available is True
    assert d.predicted_ratio == pytest.approx(1.3, rel=1e-9)
    assert d.observed_ratio == pytest.approx(0.90 / (1.0 * 0.75), rel=1e-9)
    assert d.residual == pytest.approx(1.3 * 0.75 - 0.90, rel=1e-9)


def test_diagnosis_refuses_to_blame_k2_or_s():
    """부록 A: k2와 s는 분리 동정되지 않는다 — 차이를 한쪽 탓으로 돌리지 않는다."""
    d = diagnose_deviation(_profile(), 0.90, s=0.75)
    joined = " ".join(d.notes)
    assert "분리 동정되지" in joined
    assert "인출 속도" in joined


def test_out_of_scope_run_is_downgraded():
    d = diagnose_deviation(_profile(within_model_scope=False), 0.90, s=0.75)
    assert any("신뢰도 하향" in n for n in d.notes)


def test_integration_with_compute_profile():
    """실제 :func:`compute_profile` 출력으로도 진단이 열린다 (경계 자료형 확인)."""
    shape = WareShape(
        shape_id="cone", name="사발", profile=((0.0, 20.0), (100.0, 40.0))
    )
    ware = Ware(
        ware_id="w2",
        shape=shape,
        clay_body="백자토",
        bisque_temperature=780.0,
        glaze_interior=True,
    )
    record = GlazingRecord(
        record_id="r3",
        ware_id="w2",
        batch_id="b1",
        method=GlazingMethod.DIPPING,
        weight_before=400.0,
        weight_after=430.0,
        dip_seconds=100.0,
        density=DensityMeasurement(
            batch_id="b1",
            measured_at=datetime(2026, 1, 1, 10, 0),
            specific_gravity=1.45,
            minutes_since_stirring=1.0,
        ),
    )
    profile = compute_profile(record, ware)
    assert profile.has_distribution is True
    assert profile.local_max_mm > profile.mean_mm  # 굽쪽이 두껍다 (t_flow)

    d = diagnose_deviation(profile, fired_thickness(profile.local_max_mm), s=None)
    assert d.available is True
    assert d.residual == pytest.approx(0.0, abs=1e-12)
    assert d.predicted_ratio > 1.0
