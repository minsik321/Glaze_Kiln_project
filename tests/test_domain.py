"""11절 데이터 모델과 4-1절 좌표계를 테스트한다."""

from datetime import datetime, timedelta

import pytest

from kiln.domain import (
    Batch,
    CoefficientTable,
    DensityMeasurement,
    FailureType,
    FiringResult,
    GlazeRecipe,
    GlazingMethod,
    GlazingRecord,
    Gloss,
    Grade,
    KilnProfile,
    RiskLevel,
    RiskType,
    TargetCoordinate,
    Transparency,
    Ware,
    WareShape,
)

NOW = datetime(2026, 9, 10, 11, 0, 0)


# ─── 4-1절 순서형 좌표축 ─────────────────────────────────────────────────────


def test_ordinal_axes_have_the_step_counts_the_plan_specifies():
    """광택도 5단계, 투명도 4단계 (4-1절)."""
    assert len(Gloss) == 5
    assert len(Transparency) == 4
    assert Gloss.span() == 4
    assert Transparency.span() == 3


def test_gloss_order_is_dry_to_gloss():
    """Dry — Matte — Satin — Semi-gloss — Gloss 순서."""
    assert [g.label for g in sorted(Gloss, key=lambda g: g.level)] == [
        "Dry", "Matte", "Satin", "Semi-gloss", "Gloss"
    ]


def test_distance_is_defined_because_the_axis_is_ordinal():
    """순서형이라 거리가 정의된다 (4-1절)."""
    assert Gloss.DRY.distance(Gloss.GLOSS) == 4
    assert Gloss.SATIN.distance(Gloss.MATTE) == 1
    assert Gloss.MATTE.distance(Gloss.MATTE) == 0


def test_the_two_axes_are_independent_so_cross_distance_is_undefined():
    """두 축은 독립이다 — 불투명 광택, 투명 매트가 모두 존재한다 (4-1절).

    독립인 축 사이의 거리를 계산하려 하면 자료형이 막는다.
    """
    with pytest.raises(TypeError):
        Gloss.MATTE.distance(Transparency.OPAQUE)  # type: ignore[arg-type]


def test_objective_function_matches_plan_formula():
    """5-4절: d = w1·|Δ광택도| + w2·|Δ투명도|."""
    target = TargetCoordinate(Gloss.MATTE, Transparency.OPAQUE)
    result = TargetCoordinate(Gloss.GLOSS, Transparency.TRANSPARENT)
    assert target.distance(result) == pytest.approx(3 + 3)
    assert target.distance(result, w_gloss=2.0) == pytest.approx(6 + 3)
    assert target.distance(result, w_transparency=0.0) == pytest.approx(3)


def test_a_coordinate_is_zero_distance_from_itself():
    coord = TargetCoordinate(Gloss.SATIN, Transparency.TRANSLUCENT)
    assert coord.distance(coord) == 0.0


# ─── 8-2절 시유 방법과 가용 판정 ─────────────────────────────────────────────


def test_only_dipping_has_a_distribution_model():
    """분포 모델은 담금 전용이다 (7-5, 8-2절)."""
    assert GlazingMethod.DIPPING.has_distribution_model
    for method in (GlazingMethod.POURING, GlazingMethod.SPRAYING, GlazingMethod.BRUSHING):
        assert not method.has_distribution_model


def test_distribution_dependent_risks_are_exactly_running_and_crazing():
    """8-2절: 담금이 아니면 흘러내림·응력 균열이 「판정 불가」다."""
    needs = {r for r in RiskType if r.needs_distribution}
    assert needs == {RiskType.RUNNING, RiskType.CRAZING}


def test_unavailable_is_below_none_so_it_is_not_false_reassurance():
    """「판정 불가」를 '없음'으로 내리면 거짓 안심이 된다 (8-2절)."""
    assert RiskLevel.UNAVAILABLE.level < RiskLevel.NONE.level
    assert not RiskLevel.UNAVAILABLE.is_actionable
    assert RiskLevel.HIGH.is_actionable
    assert RiskLevel.MEDIUM.is_actionable
    assert not RiskLevel.LOW.is_actionable


def test_risk_types_map_onto_failure_types():
    """사전 판정과 사후 라벨이 같은 어휘를 써야 10-2절 보정이 성립한다."""
    for risk in RiskType:
        assert isinstance(risk.to_failure(), FailureType)
    assert {r.name for r in RiskType} == {f.name for f in FailureType}


# ─── 11절 모델 불변식 ────────────────────────────────────────────────────────


def test_recipe_rejects_proportions_that_do_not_sum_to_100():
    with pytest.raises(ValueError, match="100%"):
        GlazeRecipe("r1", "테스트", {"규석": 40.0, "장석": 40.0})


def test_recipe_accepts_the_plan_reference_composition():
    """5-2절 후보 A: 규석40 장석40 석회20."""
    recipe = GlazeRecipe("A", "후보 A", {"규석": 40.0, "장석": 40.0, "석회석": 20.0})
    assert sum(recipe.materials.values()) == pytest.approx(100.0)


def test_density_measurement_carries_the_moment_not_the_batch():
    """6-3절: 비중은 배치가 아니라 순간에 귀속된다."""
    m = DensityMeasurement("b1", NOW, specific_gravity=1.45, minutes_since_stirring=3.0)
    assert m.measured_at == NOW
    assert m.minutes_since_stirring == 3.0
    # 배치에는 비중 필드가 없다
    batch = Batch("b1", "r1", NOW - timedelta(days=2))
    assert not hasattr(batch, "specific_gravity")


def test_density_below_water_is_rejected():
    with pytest.raises(ValueError, match="물"):
        DensityMeasurement("b1", NOW, specific_gravity=0.9, minutes_since_stirring=0.0)


def test_glaze_weight_is_the_total_mass_anchor():
    """7-2절 총량 제약의 앵커 W."""
    record = _record(weight_before=430.0, weight_after=526.0)
    assert record.glaze_weight == pytest.approx(96.0)


def test_reglaze_falls_outside_model_scope():
    """7-5절: 재습윤으로 흡수율이 변한다 → 모델 적용 범위 밖."""
    assert _record().within_model_scope
    assert not _record(is_reglaze=True).within_model_scope
    assert not _record(drying_complete=False).within_model_scope


def test_dipping_without_a_dip_time_is_rejected():
    with pytest.raises(ValueError, match="담금 시간"):
        GlazingRecord(
            "g1", "w1", "b1", GlazingMethod.DIPPING,
            weight_before=430.0, weight_after=526.0, dip_seconds=None,
        )


def test_weight_cannot_decrease_after_glazing():
    with pytest.raises(ValueError, match="가볍다"):
        GlazingRecord(
            "g1", "w1", "b1", GlazingMethod.SPRAYING,
            weight_before=526.0, weight_after=430.0,
        )


def test_shape_profile_must_be_monotonic_in_z():
    with pytest.raises(ValueError, match="단조증가"):
        WareShape("s1", "잘못된 형태", ((0.0, 40.0), (50.0, 45.0), (30.0, 44.0)))


def test_shape_exposes_h_max_for_the_flow_term():
    """t_flow의 (h_max − z)/h_max 항에 쓰인다 (7-1절)."""
    shape = WareShape("s1", "머그", ((0.0, 40.0), (90.0, 45.0)))
    assert shape.h_max == 90.0


# ─── 10-1절 결과 3축 ────────────────────────────────────────────────────────


def test_failure_grade_requires_a_failure_type():
    """등급=실패인데 유형이 비면 10-2절 안전 범위 보정에 쓸 신호가 없다."""
    with pytest.raises(ValueError, match="실패 유형이 비어"):
        FiringResult(
            "g1", TargetCoordinate(Gloss.MATTE, Transparency.OPAQUE), Grade.FAILED
        )


def test_non_failure_grade_rejects_failure_types():
    """실패 유형은 등급=실패일 때만 기록한다 (10-1절)."""
    with pytest.raises(ValueError, match="등급=실패일 때만"):
        FiringResult(
            "g1",
            TargetCoordinate(Gloss.MATTE, Transparency.OPAQUE),
            Grade.ACCEPTABLE,
            failures=frozenset({FailureType.RUNNING}),
        )


def test_grade_and_coordinate_are_separate_axes():
    """10-1절: 3단계 등급은 만족도이지 질감이 아니다."""
    result = FiringResult(
        "g1", TargetCoordinate(Gloss.SATIN, Transparency.OPAQUE), Grade.ACCEPTABLE
    )
    assert result.grade is Grade.ACCEPTABLE
    assert result.coordinate.gloss is Gloss.SATIN
    # 등급에서 좌표를 유도할 수 없다는 것이 요점이다
    assert not hasattr(result.grade, "gloss")


def test_fracture_thickness_is_optional_and_gates_diagnosis():
    """7-7절: 사후 진단은 파단면 실측이 있는 회차에만 활성화된다."""
    without = FiringResult(
        "g1", TargetCoordinate(Gloss.GLOSS, Transparency.TRANSPARENT), Grade.AS_INTENDED
    )
    assert without.fracture_thickness_mm is None


# ─── 9-6절 가마 프로필 ───────────────────────────────────────────────────────


def test_natural_cooling_matches_the_plan_reference_kiln():
    """9-6절 자연냉각률 표를 **반올림 자리까지** 재현한다.

    30L 가마, C=58 kJ/K, UA는 "1220℃ 유지전력 2.5kW에서 선형 역산" —
    대장의 값을 그대로 쓴다. UA를 2.1로 반올림하면 1220℃에서 156 ℃/h가
    나와 표와 한 칸 어긋나므로, 대장은 나눗셈(2500/1200)을 그대로 들고 있다.
    """
    from kiln import constants

    profile = KilnProfile(
        "p1",
        "30L 전기가마",
        heat_capacity=58_000.0,
        ua=constants.get("UA").value,
        max_power=3_000.0,
    )
    assert round(profile.natural_cooling_rate(1220.0)) == 155
    assert round(profile.natural_cooling_rate(1000.0)) == 127
    assert round(profile.natural_cooling_rate(800.0)) == 101
    assert round(profile.natural_cooling_rate(600.0)) == 75


def test_natural_cooling_is_monotonic_in_temperature():
    """뜨거울수록 빨리 식는다. 9-6절 제어 상한의 성질."""
    profile = KilnProfile("p1", "30L", heat_capacity=58_000.0, ua=2.1, max_power=3_000.0)
    rates = [profile.natural_cooling_rate(t) for t in (400, 600, 800, 1000, 1220)]
    assert rates == sorted(rates)


def test_registered_cooling_curve_is_interpolated():
    profile = KilnProfile(
        "p2", "곡선 등록됨", heat_capacity=58_000.0, ua=2.1, max_power=3_000.0,
        natural_cooling=((600.0, 75.0), (800.0, 101.0), (1000.0, 127.0), (1220.0, 155.0)),
    )
    assert profile.natural_cooling_rate(900.0) == pytest.approx(114.0)
    assert profile.natural_cooling_rate(2000.0) == pytest.approx(155.0)  # 상단 클램프
    assert profile.natural_cooling_rate(100.0) == pytest.approx(75.0)    # 하단 클램프


def test_sensor_offset_defaults_to_undetermined():
    """9-3절: 기물–센서 오프셋은 캘리브레이션 대상이며 값이 미정이다."""
    profile = KilnProfile("p1", "30L", heat_capacity=58_000.0, ua=2.1, max_power=3_000.0)
    assert profile.sensor_offset is None


def test_multiple_kiln_profiles_are_allowed_by_the_schema():
    """11절: '가마 1대'는 사용자 소유 대수이지 스키마 제약이 아니다.

    12-2절 처방 변환 검증에 프로필 2종이 필요하다.
    """
    a = KilnProfile("a", "실물", heat_capacity=58_000.0, ua=2.1, max_power=3_000.0)
    b = KilnProfile("b", "검증용 가상", heat_capacity=90_000.0, ua=3.4, max_power=5_000.0)
    assert a.profile_id != b.profile_id


def test_coefficient_table_defaults_to_uncalibrated():
    """None은 '아직 동정되지 않았으니 대장 초기값을 쓴다'는 뜻이다."""
    table = CoefficientTable("r1")
    assert table.k1 is None and table.rho_dry is None
    assert table.calibration_runs == 0
    assert table.safe_thickness_mm == (0.8, 1.3)  # 08절


# ─── 헬퍼 ───────────────────────────────────────────────────────────────────


def _record(**overrides) -> GlazingRecord:
    kwargs = dict(
        record_id="g1",
        ware_id="w1",
        batch_id="b1",
        method=GlazingMethod.DIPPING,
        weight_before=430.0,
        weight_after=526.0,
        dip_seconds=3.0,
    )
    kwargs.update(overrides)
    return GlazingRecord(**kwargs)  # type: ignore[arg-type]


def _ware() -> Ware:
    shape = WareShape("s1", "머그", ((0.0, 40.0), (10.0, 42.0), (90.0, 45.0)))
    return Ware("w1", shape, clay_body="백자토", bisque_temperature=800.0)
