"""kiln.thickness.profile — 7-1 ~ 7-5절 두께 산출과 총량 제약.

기획서에 수치가 적힌 것은 그 수치로 회귀를 건다: 7-2절 `W=96g, A=0.060 m²`
예제(ρ_dry 1.3/1.5/1.7 → 1.23/1.07/0.94mm, 1.6 가정에 실제 1.35면 19% 과소평가).
"""

from __future__ import annotations

import math
from datetime import datetime

import pytest

from kiln import constants
from kiln.domain.enums import GlazingMethod
from kiln.domain.models import (
    CoefficientTable,
    DensityMeasurement,
    GlazingRecord,
    Ware,
    WareShape,
)
from kiln.thickness.geometry import surface_area_m2
from kiln.thickness.profile import compute_profile, fired_thickness

_NOW = datetime(2026, 9, 10, 12, 0, 0)


def _ware(profile=((0.0, 30.0), (60.0, 30.0)), *, glaze_interior=False) -> Ware:
    return Ware(
        ware_id="w1",
        shape=WareShape(shape_id="s1", name="원통", profile=tuple(profile)),
        clay_body="백자토",
        bisque_temperature=800.0,
        glaze_interior=glaze_interior,
    )


def _record(
    *,
    weight_before: float = 500.0,
    glaze_g: float = 96.0,
    method: GlazingMethod = GlazingMethod.DIPPING,
    dip_seconds: float | None = 4.0,
    rho: float | None = 1.45,
    waxed_area_m2: float = 0.0,
    is_reglaze: bool = False,
    drying_complete: bool = True,
) -> GlazingRecord:
    density = (
        None
        if rho is None
        else DensityMeasurement(
            batch_id="b1",
            measured_at=_NOW,
            specific_gravity=rho,
            minutes_since_stirring=1.0,
        )
    )
    return GlazingRecord(
        record_id="g1",
        ware_id="w1",
        batch_id="b1",
        method=method,
        weight_before=weight_before,
        weight_after=weight_before + glaze_g,
        dip_seconds=dip_seconds,
        density=density,
        waxed_area_m2=waxed_area_m2,
        is_reglaze=is_reglaze,
        drying_complete=drying_complete,
    )


def _mean_for(rho_dry: float, *, glaze_g: float = 96.0, area_m2: float = 0.060) -> float:
    """7-2절 총량 제약을 손으로 푼 값 [mm]: W/(A·ρ_dry)."""
    return glaze_g / (rho_dry * area_m2 * 1000.0)


# ─── 7-2절 총량 제약 ─────────────────────────────────────────────────────────


def test_mean_matches_total_mass_constraint():
    """mean_mm 은 정확히 W/(A·ρ_dry) 다 (7-2절).

    모델이 분포를 어떻게 그리든 이 값은 나눗셈으로 정해진다. 총량 제약이
    보장하는 것은 **내적 정합성**이지 실측과의 일치가 아니다.
    """
    ware = _ware()
    record = _record()
    coeffs = CoefficientTable(recipe_id="r1", rho_dry=1.5)

    profile = compute_profile(record, ware, coeffs)
    expected = record.glaze_weight / (1.5 * profile.area_m2 * 1000.0)

    assert profile.mean_mm == pytest.approx(expected, rel=1e-12)
    assert profile.rho_dry == 1.5


def test_area_weighted_mean_of_points_equals_mean_mm():
    """점별 두께를 면적가중 평균하면 mean_mm 으로 돌아온다 — 스케일이 맞았다는 뜻."""
    from kiln.thickness.profile import _point_area_weights_mm2

    ware = _ware(profile=((0.0, 20.0), (30.0, 35.0), (60.0, 30.0)))
    profile = compute_profile(_record(), ware, CoefficientTable(recipe_id="r1"))

    weights = _point_area_weights_mm2(ware.shape.profile)
    weighted = sum(w * p.total for w, p in zip(weights, profile.points)) / sum(weights)

    assert weighted == pytest.approx(profile.mean_mm, rel=1e-9)


def test_mean_is_independent_of_k2():
    """7-2절: 평균 두께는 k2 오차와 **무관**하다. k2를 50% 흔들어도 변하지 않는다."""
    ware = _ware()
    record = _record()

    lo = compute_profile(record, ware, CoefficientTable(recipe_id="r1", k2=0.05))
    hi = compute_profile(record, ware, CoefficientTable(recipe_id="r1", k2=0.50))

    assert lo.mean_mm == pytest.approx(hi.mean_mm, rel=1e-12)


def test_local_max_does_depend_on_k2():
    """7-2절 대비표: 국소 최대 두께는 k2에 의존한다 — 가장 불확실한 값이다."""
    ware = _ware()
    record = _record()

    lo = compute_profile(record, ware, CoefficientTable(recipe_id="r1", k2=0.05))
    hi = compute_profile(record, ware, CoefficientTable(recipe_id="r1", k2=0.50))

    assert hi.local_max_mm > lo.local_max_mm
    assert hi.spread_mm > lo.spread_mm


@pytest.mark.parametrize(
    ("rho_dry", "expected_mm"), [(1.3, 1.23), (1.5, 1.07), (1.7, 0.94)]
)
def test_plan_table_rho_dry_sensitivity(rho_dry, expected_mm):
    """7-2절 표: W=96g, A=0.060 m² 에서 ρ_dry 1.3/1.5/1.7 → 1.23/1.07/0.94mm."""
    assert _mean_for(rho_dry) == pytest.approx(expected_mm, abs=0.005)


def test_plan_table_rho_dry_error_is_19_percent():
    """7-2절: "1.6으로 가정했는데 실제 1.35면 19% 과소평가"."""
    assumed = _mean_for(1.6)
    actual = _mean_for(1.35)
    underestimate = actual / assumed - 1.0

    assert round(underestimate * 100) == 19


def test_rho_dry_error_moves_the_safety_window_by_a_whole_step():
    """08절 안전 범위 0.8–1.3mm가 ρ_dry 하나로 한 칸 통째로 이동한다 (7-2절)."""
    safe_lo, safe_hi = 0.8, 1.3
    assert safe_lo <= _mean_for(1.7) <= safe_hi  # 0.94mm — 창 안
    assert _mean_for(1.3) > safe_hi - 0.1  # 1.23mm — 창 상단에 붙는다
    # 같은 저울값·같은 면적인데 ρ_dry 가정 하나로 창 안 위치가 통째로 달라진다.
    assert _mean_for(1.3) - _mean_for(1.7) > (safe_hi - safe_lo) * 0.5


def test_mean_scales_with_area_not_with_shape_detail():
    """면적이 두 배면 평균 두께는 절반 — ρ_dry·A 의존을 직접 확인한다."""
    single = compute_profile(
        _record(), _ware(glaze_interior=False), CoefficientTable(recipe_id="r1")
    )
    doubled = compute_profile(
        _record(), _ware(glaze_interior=True), CoefficientTable(recipe_id="r1")
    )
    assert doubled.mean_mm == pytest.approx(single.mean_mm / 2.0, rel=1e-12)


def test_waxed_area_is_excluded_from_A():
    """7-5절: 왁스 부위 면적은 A에서 제외한다. 미처리 시 총량 앵커가 깨진다."""
    ware = _ware()
    full_area = surface_area_m2(ware.shape, include_interior=False)
    waxed = full_area * 0.1

    profile = compute_profile(
        _record(waxed_area_m2=waxed), ware, CoefficientTable(recipe_id="r1")
    )
    assert profile.area_m2 == pytest.approx(full_area - waxed, rel=1e-12)
    # 면적이 줄었으니 같은 W로 평균 두께는 올라간다.
    plain = compute_profile(_record(), ware, CoefficientTable(recipe_id="r1"))
    assert profile.mean_mm > plain.mean_mm


# ─── 7-5절 적용 조건 ─────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "method", [GlazingMethod.POURING, GlazingMethod.SPRAYING, GlazingMethod.BRUSHING]
)
def test_non_dipping_does_not_invent_a_distribution(method):
    """7-5절: 담금이 아니면 부위별 분포를 **지어내지 않는다**."""
    ware = _ware(profile=((0.0, 20.0), (30.0, 35.0), (60.0, 30.0)))
    profile = compute_profile(
        _record(method=method, dip_seconds=None), ware, CoefficientTable(recipe_id="r1")
    )

    assert profile.has_distribution is False
    assert all(p.total == pytest.approx(profile.mean_mm) for p in profile.points)
    assert profile.spread_mm == pytest.approx(0.0)
    assert profile.local_max_mm == pytest.approx(profile.mean_mm)


def test_reglaze_downgrades_confidence_in_notes():
    """7-5절: 재시유는 재습윤으로 흡수율이 변해 모델 적용 범위 밖이다."""
    profile = compute_profile(
        _record(is_reglaze=True), _ware(), CoefficientTable(recipe_id="r1")
    )
    assert profile.within_model_scope is False
    assert any("재시유" in n for n in profile.provenance_notes)


def test_incomplete_drying_is_flagged():
    """7-5절: 잔류 수분 2%면 두께 2% 과대. 건조 미완은 사유를 남긴다."""
    profile = compute_profile(
        _record(drying_complete=False), _ware(), CoefficientTable(recipe_id="r1")
    )
    assert profile.within_model_scope is False
    assert any("건조" in n for n in profile.provenance_notes)


def test_uncalibrated_coefficients_are_reported_in_provenance():
    """00절: 문헌 추정 초기값을 쓰면 그 사실이 결과에 실려 나가야 한다."""
    profile = compute_profile(_record(), _ware(), coeffs=None)
    joined = " ".join(profile.provenance_notes)

    assert "rho_dry" in joined
    assert "문헌 추정 초기값" in joined


def test_missing_density_falls_back_to_normalization_point_and_says_so():
    """비중 실측이 없으면 g(ρ)=m(ρ)=1.0이 되는 기준점으로 가정하고 명시한다."""
    profile = compute_profile(
        _record(rho=None), _ware(), CoefficientTable(recipe_id="r1")
    )
    assert any("비중 실측 없음" in n for n in profile.provenance_notes)


# ─── 7-1절 모양 항 ───────────────────────────────────────────────────────────


def test_flow_layer_is_thicker_near_the_foot():
    """7-1절: t_flow ∝ (h_max − z)/h_max — 굽쪽이 두껍다."""
    ware = _ware()
    profile = compute_profile(_record(), ware, CoefficientTable(recipe_id="r1", k2=0.3))

    foot, rim = profile.points[0], profile.points[-1]
    assert foot.t_flow > rim.t_flow
    assert rim.t_flow == pytest.approx(0.0, abs=1e-12)
    # 흡수층은 위치 무관이다.
    assert foot.t_abs == pytest.approx(rim.t_abs, rel=1e-12)


def test_longer_dip_does_not_change_mean_by_itself():
    """담금시간은 모양 항만 키운다 — 총량 제약이 다시 W/(A·ρ_dry)로 눌러 앉힌다.

    실제로 오래 담그면 W가 커지지만, W는 **저울이 주는 값**이지 모델이
    예측하는 값이 아니다. 같은 W로 담금시간만 바꾸면 평균은 그대로다.
    """
    ware = _ware()
    short = compute_profile(
        _record(dip_seconds=1.0), ware, CoefficientTable(recipe_id="r1")
    )
    long = compute_profile(
        _record(dip_seconds=16.0), ware, CoefficientTable(recipe_id="r1")
    )
    assert short.mean_mm == pytest.approx(long.mean_mm, rel=1e-12)
    # 담금시간이 길수록 흡수층 비중이 커져 분포는 평평해진다.
    assert long.spread_mm < short.spread_mm


def test_zero_dip_time_degenerates_to_uniform_with_a_note():
    """모양 항이 모두 0이면 분포를 지어내지 않고 균일로 대체하고 사유를 남긴다."""
    ware = _ware()
    profile = compute_profile(
        _record(dip_seconds=0.0), ware, CoefficientTable(recipe_id="r1", k2=0.0)
    )
    assert profile.spread_mm == pytest.approx(0.0)
    assert any("균일 분포" in n for n in profile.provenance_notes)


# ─── 7-4절 압밀 계수 ─────────────────────────────────────────────────────────


def test_fired_thickness_shrinks_green_thickness():
    """7-4절: 소성 후 = 생 × s, s < 1. 단위를 맞추지 않으면 k2가 반대로 수렴한다."""
    s = constants.get("s").value
    assert s < 1.0
    assert fired_thickness(1.20) == pytest.approx(1.20 * s, rel=1e-12)
    assert fired_thickness(1.20, s=0.5) == pytest.approx(0.60, rel=1e-12)


def test_fired_thickness_is_linear():
    """압밀은 두께에 비례한다 — 회귀에서 s와 k2가 곱으로 붙는 이유다(부록 A)."""
    assert fired_thickness(2.0) == pytest.approx(2.0 * fired_thickness(1.0), rel=1e-12)


def test_all_points_are_finite_and_positive():
    ware = _ware(profile=((0.0, 20.0), (30.0, 35.0), (60.0, 30.0)))
    profile = compute_profile(_record(), ware, CoefficientTable(recipe_id="r1"))
    for p in profile.points:
        assert math.isfinite(p.total)
        assert p.total > 0.0
