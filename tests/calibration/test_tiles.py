"""kiln.calibration.tiles — 7-3절 타일 캘리브레이션 (저울 + 캘리퍼)."""

from __future__ import annotations

import math

import pytest

from kiln import constants
from kiln.calibration.tiles import (
    DASHED_TARGETS,
    CalibrationResult,
    TileSample,
    calibrate_from_tiles,
    mean_thickness_from_weight,
    rho_dry_from_caliper,
)


def _tiles(
    k1: float,
    rho_dry: float,
    dips=(30.0, 60.0, 120.0, 240.0),
    area_m2: float = 0.02,
    with_caliper: bool = True,
) -> list[TileSample]:
    """k1·ρ_dry를 심어 만든 합성 타일 (비중 1.45 → g(ρ)=1.0, 흡수율 1.0).

    ``t = k1·√(담금시간)`` , ``W = t·A·ρ_dry·1000``.
    """
    out = []
    for d in dips:
        t_mm = k1 * math.sqrt(d)
        w_g = t_mm * area_m2 * rho_dry * 1000.0
        out.append(
            TileSample(
                dip_seconds=d,
                area_m2=area_m2,
                glaze_weight_g=w_g,
                caliper_mm=t_mm if with_caliper else None,
            )
        )
    return out


# ─── 7-2절 회귀: W=96g, A=0.060 m² 예제 ──────────────────────────────────────


@pytest.mark.parametrize(
    "rho_dry, expected_mm",
    [(1.3, 1.23), (1.5, 1.07), (1.7, 0.94)],
)
def test_mean_thickness_matches_plan_7_2_table(rho_dry, expected_mm):
    """7-2절 표: W=96g, A=0.060 m² → ρ_dry 1.3/1.5/1.7 에서 1.23/1.07/0.94mm."""
    got = mean_thickness_from_weight(96.0, 0.060, rho_dry)
    assert round(got, 2) == expected_mm


def test_rho_dry_assumption_error_is_19_percent_underestimate():
    """7-2절: "1.6으로 가정했는데 실제 1.35면 19% 과소평가".

    같은 저울 눈금(W=96g, A=0.060)이 ρ_dry 가정 하나로 1.00mm와 1.19mm가
    된다. 과소평가율은 (실제−가정)/가정 = 1.6/1.35 − 1 ≈ 18.5% → 19%.
    """
    assumed = mean_thickness_from_weight(96.0, 0.060, 1.6)
    actual = mean_thickness_from_weight(96.0, 0.060, 1.35)
    assert assumed == pytest.approx(1.0, rel=1e-12)
    assert actual == pytest.approx(1.1851851851, rel=1e-9)
    underestimate = (actual - assumed) / assumed
    assert round(underestimate * 100) == 19


def test_rho_dry_alone_moves_the_safe_window_one_notch():
    """08절 안전 범위 0.8–1.3mm가 ρ_dry 하나로 한 칸 통째로 이동한다 (7-2절).

    같은 W=102g·A=0.060 m² 가 ρ_dry=1.3에서는 상한 초과(두꺼움 경고)이고
    ρ_dry=1.7에서는 안전창 한가운데다. 저울은 똑같은 값을 보여준다.
    """
    low, high = 0.8, 1.3
    thick_side = mean_thickness_from_weight(102.0, 0.060, 1.3)
    thin_side = mean_thickness_from_weight(102.0, 0.060, 1.7)
    assert thick_side > high  # 안전 상한 초과
    assert low < thin_side < high  # 안전창 안
    assert thin_side == pytest.approx(1.0, rel=1e-12)


def test_rho_dry_from_caliper_inverts_the_7_2_example():
    """7-3절 ρ_dry = W/(A·t) — 7-2절 예제를 거꾸로 풀면 1.3이 나온다."""
    t_mm = mean_thickness_from_weight(96.0, 0.060, 1.3)
    assert rho_dry_from_caliper(96.0, 0.060, t_mm) == pytest.approx(1.3, rel=1e-12)


# ─── 7-3절: 캘리퍼가 없으면 ρ_dry는 None ────────────────────────────────────


def test_no_caliper_leaves_rho_dry_none_with_reason():
    """저울만으로는 ρ_dry를 식별할 수 없다 (7-3절). 조용한 기본값 금지."""
    result = calibrate_from_tiles(
        _tiles(0.55, 1.4, with_caliper=False), rho=1.45
    )
    assert result.rho_dry is None
    joined = " ".join(result.notes)
    assert "저울만으로는 ρ_dry를 식별할 수 없다" in joined
    assert "곱으로 붙어" in joined
    # 그럼에도 k1은 나온다 — 다만 ρ_dry를 가정했다는 사실이 실려 있어야 한다.
    assert result.k1 is not None
    assert "가정했다" in joined


def test_caliper_present_identifies_rho_dry():
    """캘리퍼 1회가 축퇴를 연다 (7-3절 3단계)."""
    result = calibrate_from_tiles(_tiles(0.55, 1.4), rho=1.45)
    assert result.rho_dry == pytest.approx(1.4, rel=1e-9)
    assert "파괴·소성 불필요" in " ".join(result.notes)


def test_weight_only_identifies_the_product_not_the_factors():
    """7-3절 축퇴의 정량 확인 — 저울이 주는 것은 기울기 C 하나뿐이다.

    같은 무게 자료에서 ρ_dry 가정만 2배로 바꾸면 k1은 정확히 1/2이 되고
    ``C = 1000·ρ_dry·k1·흡수율·g(ρ)`` 는 그대로다. 둘은 곱으로만 식별된다.
    """
    weights_only = calibrate_from_tiles(
        _tiles(0.55, 1.4, with_caliper=False), rho=1.45
    )
    lit_rho = constants.get("rho_dry").value

    doubled = [
        TileSample(
            dip_seconds=t.dip_seconds,
            area_m2=t.area_m2,
            glaze_weight_g=t.glaze_weight_g,
            caliper_mm=t.glaze_weight_g / (t.area_m2 * (2 * lit_rho) * 1000.0),
        )
        for t in _tiles(0.55, 1.4, with_caliper=False)
    ]
    with_caliper = calibrate_from_tiles(doubled, rho=1.45)

    assert with_caliper.rho_dry == pytest.approx(2 * lit_rho, rel=1e-9)
    assert with_caliper.areal_slope == pytest.approx(weights_only.areal_slope, rel=1e-12)
    assert with_caliper.k1 == pytest.approx(weights_only.k1 / 2.0, rel=1e-9)


# ─── 합성 데이터 왕복 ────────────────────────────────────────────────────────


def test_planted_k1_is_recovered_from_synthetic_tiles():
    """심어둔 k1·ρ_dry가 그대로 되돌아온다.

    **12-2절 주의**: 생성기(``_tiles``)와 추정식(``calibrate_from_tiles``)이
    같은 모델이므로 이 복원은 **자명하다**. 이 테스트가 확인하는 것은
    "모델이 맞다"가 아니라 회귀 산술·단위 환산(g/m²/mm ↔ g/cm³)에 실수가
    없다는 것뿐이다. 모델의 타당성은 실측 없이는 닫히지 않는다(부록 A).
    """
    k1_true, rho_true = 0.055, 1.42
    result = calibrate_from_tiles(_tiles(k1_true, rho_true), rho=1.45)
    assert result.k1 == pytest.approx(k1_true, rel=1e-9)
    assert result.rho_dry == pytest.approx(rho_true, rel=1e-9)
    assert result.residual_rms == pytest.approx(0.0, abs=1e-12)
    assert result.n_samples == 4


def test_noise_shows_up_in_residual_rms():
    """잔차 RMS는 두께 단위[mm]로 나와 08절 안전 범위와 같은 축에 놓인다."""
    tiles = _tiles(0.055, 1.42)
    noisy = list(tiles)
    noisy[0] = TileSample(
        dip_seconds=noisy[0].dip_seconds,
        area_m2=noisy[0].area_m2,
        glaze_weight_g=noisy[0].glaze_weight_g * 1.15,
        caliper_mm=noisy[0].caliper_mm,
    )
    result = calibrate_from_tiles(noisy, rho=1.45)
    assert result.residual_rms > 0.0
    assert result.residual_rms < 1.0  # mm 단위임을 확인 (g/m²라면 수백 단위가 된다)


def test_g_rho_enters_the_regression():
    """비중이 다르면 같은 무게라도 다른 k1이 나온다 (6-2절 g(ρ) 경로)."""
    tiles = _tiles(0.055, 1.42)
    at_ref = calibrate_from_tiles(tiles, rho=1.45)
    thicker = calibrate_from_tiles(tiles, rho=1.60)
    assert thicker.k1 < at_ref.k1  # g(ρ)가 커진 만큼 k1이 작아진다
    assert "g(ρ=1.6)" in " ".join(thicker.notes)


# ─── 10-2절 실선 / 점선 ──────────────────────────────────────────────────────


def test_solid_and_dashed_follow_plan_10_2():
    """10-2절: 실선은 k1·ρ_dry뿐. k2·Stull·안전범위·위험우선순위는 점선."""
    result = calibrate_from_tiles(_tiles(0.55, 1.4), rho=1.45)
    assert result.solid == ("k1", "rho_dry")
    assert result.dashed == ("k2", "stull_boundary", "safe_thickness_mm", "risk_priority")
    assert set(result.solid).isdisjoint(result.dashed)


def test_uncalibrated_rho_dry_drops_out_of_solid():
    """동정되지 않은 것은 실선이 아니다 — 캘리퍼가 없으면 ρ_dry는 빠진다."""
    result = calibrate_from_tiles(
        _tiles(0.55, 1.4, with_caliper=False), rho=1.45
    )
    assert result.solid == ("k1",)
    assert "rho_dry" not in result.solid
    assert result.dashed == DASHED_TARGETS


def test_dashed_reasons_are_carried_in_notes():
    """점선인 이유(파괴 필요·이항 사건 등)가 결과에 실려 나간다 (10-2절)."""
    joined = " ".join(calibrate_from_tiles(_tiles(0.55, 1.4), rho=1.45).notes)
    assert "파단면 관찰" in joined
    assert "이항 사건" in joined


def test_never_claims_k1_absorption_separation():
    """부록 A: k1과 흡수율은 곱으로만 식별된다 — 분리를 주장하지 않는다."""
    joined = " ".join(calibrate_from_tiles(_tiles(0.55, 1.4), rho=1.45).notes)
    assert "곱으로만 식별" in joined
    assert "분리 동정했다고 주장하지 않는다" in joined


# ─── 퇴화 입력 ───────────────────────────────────────────────────────────────


def test_empty_samples_identify_nothing():
    result = calibrate_from_tiles([], rho=1.45)
    assert isinstance(result, CalibrationResult)
    assert result.k1 is None
    assert result.rho_dry is None
    assert result.solid == ()
    assert result.n_samples == 0


def test_zero_dip_tiles_are_excluded_from_regression():
    """√0=0이라 기울기에 정보를 주지 않는다 — 사유를 남기고 제외한다."""
    tiles = _tiles(0.055, 1.42) + [
        TileSample(dip_seconds=0.0, area_m2=0.02, glaze_weight_g=0.0, caliper_mm=None)
    ]
    result = calibrate_from_tiles(tiles, rho=1.45)
    assert result.k1 == pytest.approx(0.055, rel=1e-9)
    assert result.n_samples == 5
    assert "담금시간 0인 타일" in " ".join(result.notes)


def test_too_few_tiles_is_flagged():
    """7-3절은 3~4장을 요구한다 — 1~2장이면 잔차가 0이라 신뢰도를 못 잰다."""
    result = calibrate_from_tiles(_tiles(0.055, 1.42, dips=(60.0,)), rho=1.45)
    assert "7-3절은 3~4장을 요구한다" in " ".join(result.notes)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"dip_seconds": -1.0, "area_m2": 0.02, "glaze_weight_g": 1.0},
        {"dip_seconds": 10.0, "area_m2": 0.0, "glaze_weight_g": 1.0},
        {"dip_seconds": 10.0, "area_m2": 0.02, "glaze_weight_g": -1.0},
        {"dip_seconds": 10.0, "area_m2": 0.02, "glaze_weight_g": 1.0, "caliper_mm": 0.0},
    ],
)
def test_tile_sample_rejects_impossible_inputs(kwargs):
    with pytest.raises(ValueError):
        TileSample(**kwargs)
