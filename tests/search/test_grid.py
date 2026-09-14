"""5-2절 · 격자 회귀 테스트.

기획서에 수치가 박힌 것을 그대로 앵커로 쓴다(공통 규칙 5).

- 5-2절 격자 간격 10 → 5 → 2 %p
- 5-3절 격자 규모: 3원료 10%p = 66점, 4원료 10%p = 286점
- 5-2절 "석회석 10%p 하나가 후보 폭의 6~13배를 움직인다"
"""

from __future__ import annotations

import math

import pytest

from kiln.chem.umf import unity_formula_from_materials
from kiln.search.grid import refine, simplex_grid

TRIAD = ("규석", "장석", "석회석")
QUAD = ("규석", "장석", "석회석", "카올린")


# ─── 5-3절 격자 규모 앵커 ────────────────────────────────────────────────────


def test_three_component_ten_percent_grid_has_66_points() -> None:
    """5-3절: 조성 2차원(3원료) 10%p 격자 = 66점."""
    assert len(simplex_grid(10.0, TRIAD)) == 66


def test_four_component_ten_percent_grid_has_286_points() -> None:
    """5-3절: 조성 3차원(4원료) 10%p 격자 = 286점."""
    assert len(simplex_grid(10.0, QUAD)) == 286


@pytest.mark.parametrize(
    "step_pct,expected",
    [(10.0, 66), (5.0, 231), (2.0, 1326)],
)
def test_plan_step_sequence_10_5_2(step_pct: float, expected: int) -> None:
    """5-2절 1차 10%p → 2차 5%p → 3차 2%p.

    3원료 단체 격자의 점 수는 C(k+2, 2), k = 100/step. 10 → 66, 5 → 231,
    2 → 1326. 간격이 작아질수록 점이 폭증하는 것이 5-2절이 전면 2%p 격자를
    1차 탐색에 쓰지 말라고 한 이유(회차 예산)이기도 하다.
    """
    assert len(simplex_grid(step_pct, TRIAD)) == expected


# ─── 단체 격자 불변량 ────────────────────────────────────────────────────────


@pytest.mark.parametrize("step_pct", [10.0, 5.0, 2.0])
def test_every_grid_point_sums_to_100(step_pct: float) -> None:
    """단체 격자 불변량: 모든 점의 합이 100%."""
    for point in simplex_grid(step_pct, TRIAD):
        assert sum(point.values()) == pytest.approx(100.0, abs=1e-6)


@pytest.mark.parametrize("step_pct", [10.0, 5.0, 2.0])
def test_every_grid_point_is_non_negative(step_pct: float) -> None:
    for point in simplex_grid(step_pct, TRIAD):
        assert all(pct >= 0.0 for pct in point.values())


def test_grid_points_are_unique() -> None:
    points = simplex_grid(10.0, TRIAD)
    keys = {tuple(sorted(p.items())) for p in points}
    assert len(keys) == len(points)


@pytest.mark.parametrize("step_pct", [10.0, 5.0, 2.0])
def test_axis_spacing_equals_step(step_pct: float) -> None:
    """격자 간격은 모든 축에서 정확히 step_pct다 (5-2절)."""
    points = simplex_grid(step_pct, TRIAD)
    for component in TRIAD:
        values = sorted({round(p[component], 6) for p in points})
        gaps = {round(b - a, 6) for a, b in zip(values, values[1:])}
        assert gaps == {round(step_pct, 6)}


def test_grid_contains_pure_vertices() -> None:
    """고정 성분이 없으면 꼭짓점(한 원료 100%)이 격자에 있어야 한다."""
    points = simplex_grid(10.0, TRIAD)
    for component in TRIAD:
        assert any(
            p[component] == pytest.approx(100.0)
            and all(v == pytest.approx(0.0) for k, v in p.items() if k != component)
            for p in points
        )


# ─── 5-1절 고정 성분 ─────────────────────────────────────────────────────────


def test_fixed_components_are_carried_into_every_point() -> None:
    """5-1절: 벤토나이트는 현탁제로 고정, 탐색 변수가 아니다."""
    points = simplex_grid(10.0, TRIAD, fixed={"벤토나이트": 2.0})
    assert points
    for point in points:
        assert point["벤토나이트"] == pytest.approx(2.0)
        assert sum(point.values()) == pytest.approx(100.0, abs=1e-6)


def test_fixed_components_shrink_the_free_simplex() -> None:
    """고정분을 뺀 나머지에서 격자를 만든다 — 탐색 축의 합은 100−고정분."""
    fixed = {"카올린": 12.5, "벤토나이트": 2.0}
    for point in simplex_grid(10.0, TRIAD, fixed=fixed):
        free_total = sum(point[c] for c in TRIAD)
        assert free_total == pytest.approx(85.5, abs=1e-6)
        assert sum(point.values()) == pytest.approx(100.0, abs=1e-6)


def test_non_divisible_free_total_keeps_step_spacing() -> None:
    """자유 총합이 간격의 정수배가 아니어도 간격 자체는 유지된다.

    카올린 12.5% + 벤토나이트 2.0% 고정이면 자유 총합 85.5%로 10%p로
    나누어떨어지지 않는다. 마지막 성분이 잔차를 흡수하되, 각 축의 값들은
    여전히 10%p씩 떨어져 있어야 한다(모듈 docstring).
    """
    points = simplex_grid(10.0, TRIAD, fixed={"카올린": 12.5, "벤토나이트": 2.0})
    for component in TRIAD:
        values = sorted({round(p[component], 6) for p in points})
        gaps = {round(b - a, 6) for a, b in zip(values, values[1:])}
        assert gaps == {10.0}


def test_fixed_and_search_components_may_not_overlap() -> None:
    """5-1절은 고정과 탐색을 분리한다 — 겹치면 격자가 정의되지 않는다."""
    with pytest.raises(ValueError):
        simplex_grid(10.0, TRIAD, fixed={"석회석": 20.0})


@pytest.mark.parametrize(
    "kwargs",
    [
        {"step_pct": 0.0, "components": TRIAD},
        {"step_pct": -5.0, "components": TRIAD},
        {"step_pct": 10.0, "components": ()},
        {"step_pct": 10.0, "components": ("규석", "규석")},
    ],
)
def test_invalid_arguments_raise(kwargs: dict) -> None:
    with pytest.raises(ValueError):
        simplex_grid(**kwargs)


def test_fixed_total_over_100_raises() -> None:
    with pytest.raises(ValueError):
        simplex_grid(10.0, TRIAD, fixed={"카올린": 90.0, "벤토나이트": 20.0})


def test_step_larger_than_free_total_raises() -> None:
    """간격이 자유 총합보다 크면 격자점이 꼭짓점뿐이라 탐색이 성립하지 않는다."""
    with pytest.raises(ValueError):
        simplex_grid(10.0, TRIAD, fixed={"카올린": 95.0})


# ─── 5-2절 정량 근거: 석회석 축 ──────────────────────────────────────────────


def _sio2(silica: float, feldspar: float, whiting: float) -> float:
    return unity_formula_from_materials(
        {"규석": silica, "장석": feldspar, "석회석": whiting}
    ).sio2


def test_limestone_10pp_moves_6_to_13_times_the_fine_grid_span() -> None:
    """5-2절: "석회석 10%p 하나가 위 전체 폭의 6~13배를 움직인다".

    "위 전체 폭"은 ±2%p 격자 후보 A~D의 SiO₂ UMF 최대 차이(0.403)다.
    석회석 10%p 이동 중 가장 큰 것(10→20%)이 6.93배, 10~40% 전 구간이
    12.46배 — 이 두 값이 기획서의 "6~13배"다.
    """
    fine = [_sio2(40, 40, 20), _sio2(42, 38, 20), _sio2(40, 38, 22), _sio2(38, 42, 20)]
    fine_span = max(fine) - min(fine)
    assert fine_span == pytest.approx(0.403, abs=0.01)

    sweep = [_sio2((100 - w) / 2, (100 - w) / 2, w) for w in (10, 20, 30, 40)]
    largest_single_step = max(a - b for a, b in zip(sweep, sweep[1:]))
    full_span = sweep[0] - sweep[-1]

    assert 6.0 <= largest_single_step / fine_span <= 13.0
    assert 6.0 <= full_span / fine_span <= 13.0
    assert largest_single_step / fine_span == pytest.approx(6.93, abs=0.05)
    assert full_span / fine_span == pytest.approx(12.46, abs=0.05)


def test_ten_percent_grid_neighbours_differ_more_than_two_percent_grid() -> None:
    """5-2절 격자 간격 선택의 근거: 간격이 크면 후보 간 화학 차이도 크다.

    10%p 격자에서 석회석만 한 칸 다른 이웃 쌍의 SiO₂ 차이는, ±2%p 격자
    후보들의 전체 폭보다 훨씬 크다 — 관측 노이즈보다 큰 간격을 쓴다는
    5-2절 요구가 조성 화학 수준에서 만족되는지 확인한다.
    """
    fine = [_sio2(40, 40, 20), _sio2(42, 38, 20), _sio2(40, 38, 22), _sio2(38, 42, 20)]
    fine_span = max(fine) - min(fine)
    coarse_gap = abs(_sio2(45, 45, 10) - _sio2(40, 40, 20))
    assert coarse_gap > fine_span


# ─── refine (5-2절 2·3차 탐색) ───────────────────────────────────────────────


CENTER = {"규석": 40.0, "장석": 35.5, "석회석": 10.0, "카올린": 12.5, "벤토나이트": 2.0}


@pytest.mark.parametrize("step_pct", [5.0, 2.0])
def test_refine_preserves_total(step_pct: float) -> None:
    """세분은 한 성분에서 빼 다른 성분에 주므로 합이 정확히 보존된다."""
    for point in refine(CENTER, step_pct, TRIAD):
        assert sum(point.values()) == pytest.approx(100.0, abs=1e-9)


@pytest.mark.parametrize("step_pct", [5.0, 2.0])
def test_refine_never_produces_negative(step_pct: float) -> None:
    for point in refine(CENTER, step_pct, TRIAD):
        assert all(pct >= 0.0 for pct in point.values())


def test_refine_includes_the_center() -> None:
    """중심점은 세분 후에도 유효한 후보다."""
    points = refine(CENTER, 5.0, TRIAD)
    assert any(
        all(point.get(k) == pytest.approx(v) for k, v in CENTER.items())
        for point in points
    )


def test_refine_leaves_fixed_components_untouched() -> None:
    """5-1절 고정 성분은 세분 대상이 아니다."""
    for point in refine(CENTER, 5.0, TRIAD):
        assert point["카올린"] == pytest.approx(12.5)
        assert point["벤토나이트"] == pytest.approx(2.0)


def test_refine_interior_center_gives_center_plus_all_transfers() -> None:
    """내부 중심에서는 중심 1점 + 이동 n(n−1)점 = 7점 (n=3)."""
    points = refine(CENTER, 5.0, TRIAD)
    assert len(points) == 1 + 3 * 2


def test_refine_step_is_exactly_the_requested_size() -> None:
    """이동량은 정확히 step_pct다 — 5-2절 2차 5%p, 3차 2%p."""
    for step_pct in (5.0, 2.0):
        for point in refine(CENTER, step_pct, TRIAD):
            for component in TRIAD:
                delta = round(abs(point[component] - CENTER[component]), 6)
                assert delta in (0.0, round(step_pct, 6))


def test_refine_drops_moves_that_would_go_negative() -> None:
    """석회석이 2%p뿐인 중심에서 5%p를 빼는 이동은 만들어지지 않는다."""
    center = {"규석": 45.5, "장석": 38.0, "석회석": 2.0, "카올린": 12.5, "벤토나이트": 2.0}
    points = refine(center, 5.0, TRIAD)
    assert all(p["석회석"] >= 0.0 for p in points)
    assert not any(p["석회석"] == pytest.approx(-3.0) for p in points)
    # 석회석에서 빼는 이동 2개가 빠지므로 7 − 2 = 5점
    assert len(points) == 5


def test_refine_can_open_a_new_axis_from_zero() -> None:
    """5-1절 "탐색 확장: 카올린 비율을 목표 미달 시에만 추가 차원으로 연다".

    중심에 없는 이름을 components에 넣으면 0%에서 출발하는 새 축이 된다.
    """
    center = {"규석": 45.0, "장석": 35.0, "석회석": 20.0}
    points = refine(center, 5.0, ("규석", "장석", "석회석", "카올린"))
    assert any(p.get("카올린", 0.0) == pytest.approx(5.0) for p in points)
    for point in points:
        assert sum(point.values()) == pytest.approx(100.0, abs=1e-9)


def test_refine_rejects_center_that_does_not_sum_to_100() -> None:
    with pytest.raises(ValueError):
        refine({"규석": 40.0, "장석": 40.0}, 5.0, TRIAD)


def test_refine_rejects_non_positive_step() -> None:
    with pytest.raises(ValueError):
        refine(CENTER, 0.0, TRIAD)


def test_refine_is_deterministic() -> None:
    """난수를 쓰지 않는다(부록 D: 규칙/최적화 알고리즘으로 명시)."""
    assert refine(CENTER, 5.0, TRIAD) == refine(CENTER, 5.0, TRIAD)


def test_simplex_grid_is_deterministic() -> None:
    assert simplex_grid(10.0, TRIAD) == simplex_grid(10.0, TRIAD)


def test_single_component_grid_is_the_remainder() -> None:
    """탐색 축이 하나면 격자점은 하나뿐 — 자유 총합 전부를 그 성분이 갖는다."""
    points = simplex_grid(10.0, ("규석",), fixed={"벤토나이트": 2.0})
    assert len(points) == 1
    assert points[0]["규석"] == pytest.approx(98.0)
    assert math.isclose(sum(points[0].values()), 100.0)
