"""kiln.thickness.geometry — 파푸스·굴딘 표면적과 벽면 경사각 (7-1절)."""

from __future__ import annotations

import math

import pytest

from kiln.domain.models import WareShape
from kiln.thickness.geometry import surface_area_m2, wall_angle


def _shape(profile, shape_id="s1", name="test") -> WareShape:
    return WareShape(shape_id=shape_id, name=name, profile=tuple(profile))


# ─── surface_area_m2 ────────────────────────────────────────────────────────


def test_cylinder_matches_analytic_lateral_area():
    """반지름 r, 높이 h인 원기둥의 측면적은 2πrh다 (단일 면)."""
    r, h = 30.0, 120.0
    shape = _shape([(0.0, r), (h, r)])
    area_m2 = surface_area_m2(shape, include_interior=False)
    expected_mm2 = 2 * math.pi * r * h
    assert area_m2 == pytest.approx(expected_mm2 / 1e6, rel=1e-12)


def test_include_interior_doubles_area():
    r, h = 30.0, 120.0
    shape = _shape([(0.0, r), (h, r)])
    single = surface_area_m2(shape, include_interior=False)
    doubled = surface_area_m2(shape, include_interior=True)
    assert doubled == pytest.approx(single * 2.0, rel=1e-12)


def test_cone_frustum_matches_closed_form():
    """원추대 측면적 = π(r0+r1)·√((r1−r0)²+(z1−z0)²) — 3-4-5 직각삼각형으로 검산."""
    r0, r1 = 10.0, 40.0  # dr = 30
    z0, z1 = 0.0, 40.0  # dz = 40 → slant = 50 (3-4-5 삼각형의 배수)
    shape = _shape([(z0, r0), (z1, r1)])
    area_m2 = surface_area_m2(shape, include_interior=False)
    slant = 50.0
    expected_mm2 = math.pi * (r0 + r1) * slant
    assert expected_mm2 == pytest.approx(7853.981633974483, rel=1e-9)
    assert area_m2 == pytest.approx(expected_mm2 / 1e6, rel=1e-12)


def test_multi_segment_area_is_sum_of_segments():
    """여러 구간의 표면적은 구간별 원추대 면적의 합과 같다(선형성)."""
    shape = _shape([(0.0, 20.0), (50.0, 40.0), (100.0, 40.0), (150.0, 10.0)])
    total = surface_area_m2(shape, include_interior=False)

    seg1 = _shape([(0.0, 20.0), (50.0, 40.0)])
    seg2 = _shape([(50.0, 40.0), (100.0, 40.0)])
    seg3 = _shape([(100.0, 40.0), (150.0, 10.0)])
    parts_sum = sum(
        surface_area_m2(s, include_interior=False) for s in (seg1, seg2, seg3)
    )
    assert total == pytest.approx(parts_sum, rel=1e-12)


def test_exclude_waxed_area_subtracts_and_floors():
    shape = _shape([(0.0, 30.0), (120.0, 30.0)])
    full = surface_area_m2(shape, include_interior=False)
    reduced = surface_area_m2(shape, include_interior=False, exclude_waxed_m2=full * 0.3)
    assert reduced == pytest.approx(full * 0.7, rel=1e-9)


def test_exclude_waxed_area_exceeding_total_raises():
    shape = _shape([(0.0, 30.0), (120.0, 30.0)])
    full = surface_area_m2(shape, include_interior=False)
    with pytest.raises(ValueError):
        surface_area_m2(shape, include_interior=False, exclude_waxed_m2=full * 1.5)


def test_exclude_waxed_area_floors_at_small_positive():
    shape = _shape([(0.0, 30.0), (120.0, 30.0)])
    full = surface_area_m2(shape, include_interior=False)
    nearly_all = surface_area_m2(
        shape, include_interior=False, exclude_waxed_m2=full * 0.999999999
    )
    assert nearly_all > 0.0


# ─── wall_angle ─────────────────────────────────────────────────────────────


def test_vertical_wall_is_pi_over_2():
    """수직벽(dr=0)이면 θ=π/2 — ZeroDivisionError 없이."""
    shape = _shape([(0.0, 30.0), (100.0, 30.0)])
    assert wall_angle(shape, 50.0) == pytest.approx(math.pi / 2)


def test_near_flat_wall_is_near_zero():
    """dz가 dr에 비해 아주 작으면(거의 수평면) θ가 0에 가깝다."""
    shape = _shape([(0.0, 10.0), (0.01, 200.0)])
    theta = wall_angle(shape, 0.005)
    assert theta < 0.01


def test_inward_taper_uses_magnitude_not_sign():
    """반지름이 줄어드는(안으로 휘는) 구간도 늘어나는 구간과 같은 크기의 θ를 낸다."""
    outward = _shape([(0.0, 10.0), (40.0, 40.0)])  # dr=+30, dz=40
    inward = _shape([(0.0, 40.0), (40.0, 10.0)])  # dr=-30, dz=40
    assert wall_angle(outward, 20.0) == pytest.approx(wall_angle(inward, 20.0))


def test_wall_angle_clamps_outside_range():
    shape = _shape([(0.0, 10.0), (100.0, 10.0)])
    below = wall_angle(shape, -50.0)
    at_zero = wall_angle(shape, 0.0)
    above = wall_angle(shape, 500.0)
    at_end = wall_angle(shape, 100.0)
    assert below == pytest.approx(at_zero)
    assert above == pytest.approx(at_end)


def test_wall_angle_picks_correct_segment():
    """여러 구간 중 z가 속한 구간의 각도를 찾는다."""
    shape = _shape([(0.0, 10.0), (50.0, 10.0), (100.0, 60.0)])
    vertical_part = wall_angle(shape, 25.0)
    sloped_part = wall_angle(shape, 75.0)
    assert vertical_part == pytest.approx(math.pi / 2)
    assert 0.0 < sloped_part < math.pi / 2
