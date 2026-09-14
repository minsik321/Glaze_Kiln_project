"""kiln.webapp.bridge — UI 경계가 출처를 떨어뜨리지 않는지.

이 파일이 지키는 것은 화면 기능이 아니라 **00절 약속이 경계를 넘어가는지**다.
계산이 아무리 정확해도 UI로 나가는 dict에서 `provenance_notes` 가 빠지면
사용자는 문헌 추정값을 실측값으로 읽는다.
"""

from __future__ import annotations

import json

import pytest

from kiln import constants
from kiln.webapp import PRESET_KILNS, PRESET_RECIPES, PRESET_SHAPES, KilnApp


@pytest.fixture()
def app() -> KilnApp:
    return KilnApp()


def _json_safe(value) -> bool:
    """브라우저로 넘어갈 수 있는가 — dict/list/스칼라만."""
    try:
        json.dumps(value, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError):
        return False
    return True


def _dipped(app: KilnApp, *, glaze_g: float = 12.0, **kw) -> dict:
    ware = app.register_ware("cylinder", "백자토", 800.0, glaze_interior=False)
    return app.glaze(
        ware["ware_id"], "lime_matte", "담금", 500.0, 500.0 + glaze_g,
        dip_seconds=4.0, rho=1.45, **kw,
    )


# ─── 부록 C · 미정 계수는 값을 내지 않는다 ───────────────────────────────────


def test_registry_never_leaks_a_value_for_undetermined_coefficients(app):
    """E·α·β·Kh·sensor_offset은 값 칸이 비어 있어야 한다 (부록 C)."""
    rows = {r["symbol"]: r for r in app.registry()}
    for symbol in ("E", "alpha", "beta", "Kh", "sensor_offset"):
        row = rows[symbol]
        assert row["determined"] is False
        assert row["value"] is None
        assert row["annotation"] == "(미정 — 값 없음)"
        # 값이 없어도 **동정 절차는 있다** — 그것이 부록 C의 요점이다.
        assert row["identification"].strip()


def test_registry_covers_the_whole_ledger(app):
    assert len(app.registry()) == len(constants.REGISTRY)


def test_registry_is_json_serialisable(app):
    assert _json_safe(app.registry())


# ─── 00절 · 출처가 경계를 넘어간다 ───────────────────────────────────────────


def test_thickness_carries_its_provenance(app):
    """문헌 추정 계수를 썼으면 화면까지 그 사실이 간다."""
    payload = _dipped(app)
    assert payload["ok"] is True
    assert payload["provenance_notes"]
    assert any("문헌 추정 초기값" in n for n in payload["provenance_notes"])


def test_density_advice_carries_its_annotation(app):
    advice = app.check_density(1.55, 2.0)
    assert advice["annotation"] == "(문헌 추정 초기값 · 캘리브레이션 전)"


def test_dip_time_states_which_k1_it_used(app):
    """동정 전에는 대장 초기값을 썼다는 사실이 실려 나간다."""
    out = app.suggest_dip_time(1.10, 1.45, "lime_matte")
    assert out["feasible"] is True
    assert "문헌 추정 초기값" in out["annotation"]
    assert "곱으로만 식별" in out["annotation"]


def test_stull_reading_carries_the_reference_disclaimer(app):
    """4-3절: Stull은 판정이 아니라 참조다."""
    out = app.inspect_composition(PRESET_RECIPES["clear"]["materials"])
    assert out["ok"] is True
    assert out["provenance_note"].strip()
    assert "문헌" in out["provenance_note"]


def test_simulation_says_E_was_assumed(app):
    out = app.simulate("ref30l", 1220.0, 100.0, 15.0, 300.0, seed=1)
    assert "미정" in out["E_note"]


def test_coefficient_table_exposes_its_notes(app):
    payload = _dipped(app)
    run = app.record_run("ref30l", [payload["record_id"]], [], [], [])
    app.record_result(run["run_id"], payload["record_id"], "lime_matte", 1, 0, "허용")
    coeffs = app.coefficients("lime_matte")
    assert coeffs["provenance_notes"]


# ─── 8-2절 · 「판정 불가」가 「없음」으로 접히지 않는다 ────────────────────────


def test_risk_marks_distribution_judgements_unavailable_for_spraying(app):
    ware = app.register_ware("bowl", "백자토", 800.0)
    payload = app.glaze(ware["ware_id"], "lime_matte", "분무", 500.0, 512.0)
    out = app.risk(payload["record_id"], "lime_matte")

    unavailable = [f for f in out["findings"] if not f["available"]]
    assert {f["risk"] for f in unavailable} == {"흘러내림", "응력 균열"}
    for f in unavailable:
        assert f["level"] == "판정 불가"
        assert f["level"] != "없음"
        assert f["actionable"] is False


def test_worst_does_not_collapse_unavailable_into_none(app):
    """요약이 「없음」으로 접히면 거짓 안심이다 — 경계에서도 마찬가지다."""
    ware = app.register_ware("bowl", "백자토", 800.0)
    # 안전창 안쪽 무게를 골라 총량 기반 판정은 전부 「없음」이 되게 한다.
    payload = app.glaze(ware["ware_id"], "lime_matte", "분무", 500.0, 500.0 + 30.0)
    out = app.risk(payload["record_id"], "lime_matte")
    mean = out["profile"]["mean_mm"]
    if 0.8 <= mean <= 1.3:
        assert out["worst"] == "판정 불가"
        assert out["worst_level"] == -1


def test_all_five_risks_are_always_reported(app):
    for method in ("담금", "부기", "분무", "붓칠"):
        ware = app.register_ware("cylinder", "백자토", 800.0, glaze_interior=False)
        payload = app.glaze(
            ware["ware_id"], "lime_matte", method, 500.0, 512.0,
            dip_seconds=4.0 if method == "담금" else None,
        )
        out = app.risk(payload["record_id"], "lime_matte")
        assert len(out["findings"]) == 5


# ─── 8-4절 · 선택지에는 비용이 붙어 있고 확정 기호가 없다 ────────────────────


def test_every_option_carries_its_cost_and_no_certainty_marker(app):
    payload = _dipped(app, glaze_g=60.0)  # 일부러 두껍게
    out = app.risk(payload["record_id"], "lime_matte")
    assert out["options"], "위험이 높은데 선택지가 비어 있다"
    for option in out["options"]:
        assert option["cost"].strip()
        assert "✓" not in option["name"] and "✓" not in option["effect"]


def test_reglaze_option_is_marked_as_downgrading_confidence(app):
    payload = _dipped(app, glaze_g=60.0)
    out = app.risk(payload["record_id"], "lime_matte")
    reglaze = next(o for o in out["options"] if o["name"] == "재시유")
    assert reglaze["confidence_downgrade"] is True


# ─── 6-4절 · 경고가 진행을 막지 않는다 ───────────────────────────────────────


@pytest.mark.parametrize("rho", [1.05, 1.25, 1.45, 1.55, 1.95])
def test_density_warning_never_blocks_progress(app, rho):
    out = app.check_density(rho, 2.0)
    assert out["ok"] is True
    assert out["blocks_progress"] is False


def test_impossible_density_is_reported_not_raised(app):
    """UI 경계에서 예외를 던지면 화면이 죽는다 — 사유를 돌려준다."""
    out = app.check_density(0.9, 2.0)
    assert out["ok"] is False
    assert "물" in out["reason"]


def test_invalid_glazing_record_is_reported_not_raised(app):
    ware = app.register_ware("cylinder", "백자토", 800.0)
    out = app.glaze(ware["ware_id"], "lime_matte", "담금", 500.0, 480.0, dip_seconds=4.0)
    assert out["ok"] is False
    assert out["reason"]


# ─── 9-6절 · 자연냉각률이 상한이다 ───────────────────────────────────────────


def test_cooling_rejects_a_rate_above_natural(app):
    out = app.cooling(
        "ref30l", [{"from_c": 1100, "to_c": 900, "rate_c_per_h": 400, "purpose": "급냉"}]
    )
    assert out["feasible"] is False
    assert any("자연냉각률" in r for r in out["rejections"])


def test_cooling_rejects_a_segment_crossing_the_quartz_inversion(app):
    out = app.cooling(
        "ref30l", [{"from_c": 700, "to_c": 400, "rate_c_per_h": 40, "purpose": "통과"}]
    )
    assert out["feasible"] is False
    assert any("573" in r for r in out["rejections"])


def test_cooling_supplies_the_natural_curve_for_the_background(app):
    """9-6절: UI는 자연냉각률 곡선을 배경으로 깔고 그 아래만 고르게 한다."""
    out = app.cooling(
        "ref30l", [{"from_c": 1100, "to_c": 900, "rate_c_per_h": 50, "purpose": "결정"}]
    )
    assert out["feasible"] is True
    curve = out["natural_curve"]
    assert len(curve) > 10
    rates = [p["natural_rate"] for p in curve]
    assert all(a >= b for a, b in zip(rates, rates[1:]))  # 뜨거울수록 빨리 식는다
    assert out["extra_hours"] > 0 and out["extra_kwh"] > 0  # 되돌림 비용 병기


# ─── 9-2절 · 총량 이상 감지이지 오등록 판별이 아니다 ─────────────────────────


def test_loading_message_refuses_to_overclaim(app):
    ware = app.register_ware("cylinder", "백자토", 800.0)
    out = app.loading("ref30l", [ware["ware_id"]], 0.18, 10.0, 1650.0)
    assert "적재 오등록" in out["message"]


# ─── 5-4 · 5-5절 · 필터와 축적 ───────────────────────────────────────────────


def test_side_observation_filters_without_entering_the_objective(app):
    """5-4절: 부수 관측은 d에 넣지 않고 필터로만 쓴다."""
    payload = _dipped(app)
    run = app.record_run("ref30l", [payload["record_id"]], [], [], [])
    out = app.record_result(
        run["run_id"], payload["record_id"], "lime_matte", 1, 0, "허용",
        observations={"흐름": "발생"},
    )
    assert out["ok"] is True
    assert out["passes_filter"] is False
    # 거리는 여전히 좌표만으로 계산된다 — 필터가 d를 건드리지 않는다.
    assert out["distance_to_target"] >= 0


def test_personal_weight_never_decreases_with_runs(app):
    """5-5절: 회차가 쌓일수록 개인 데이터 가중이 커진다 — 줄어들지 않는다.

    앱은 **사전분포 코퍼스 없이** 출발한다. 문헌 조성→결과 데이터를 심으려면
    그 데이터를 주장해야 하는데, 00절은 "조성으로 결과를 예측한다고 주장하지
    않는다 — 실험 데이터가 없다"고 못 박았다. 그래서 콜드 스타트에서는 개인
    관측이 하나라도 생기는 순간 가중이 1.0이 된다(개인 데이터 외에 근거가
    없으므로 옳다). 가중이 **깎이는 일이 없다는 것**이 여기서 지킬 성질이다.
    """
    weights = [app.export_state()["personal_weight"]]
    for _ in range(3):
        payload = _dipped(app)
        run = app.record_run("ref30l", [payload["record_id"]], [], [], [])
        app.record_result(
            run["run_id"], payload["record_id"], "lime_matte", 1, 0, "허용"
        )
        weights.append(app.export_state()["personal_weight"])

    assert weights[0] == 0.0
    assert all(a <= b for a, b in zip(weights, weights[1:]))
    assert weights[-1] == 1.0


def test_personal_weight_grows_strictly_against_a_prior_corpus():
    """사전분포가 있으면 회차마다 **강증가**한다 (5-5절 w(n)=n/(n+n₀))."""
    from kiln.domain.enums import Gloss, Transparency
    from kiln.domain.models import TargetCoordinate
    from kiln.search.prior import Prior

    seeded = Prior(
        observations=[
            ({"장석": 50.0, "규석": 30.0, "석회석": 20.0},
             TargetCoordinate(Gloss.GLOSS, Transparency.TRANSPARENT)),
        ]
    )
    weights = [seeded.weight_of_personal_data()]
    for i in range(3):
        seeded.update(
            {"장석": 45.0 + i, "규석": 35.0 - i, "석회석": 20.0},
            TargetCoordinate(Gloss.MATTE, Transparency.OPAQUE),
        )
        weights.append(seeded.weight_of_personal_data())

    assert all(a < b for a, b in zip(weights, weights[1:]))
    assert all(0.0 <= w < 1.0 for w in weights)


def test_proposal_does_not_invent_a_distance_without_evidence(app):
    """근거가 없으면 예상 거리를 지어내지 않는다 (콜드 스타트)."""
    out = app.propose(n=4)
    assert out["candidates"]
    assert all(c["umf_note"].strip() for c in out["candidates"])
    assert _json_safe(out)  # inf가 그대로 나가면 JSON이 깨진다


# ─── 7-3 · 7-5절 · 캘리브레이션 ──────────────────────────────────────────────


def test_tile_calibration_refuses_rho_dry_without_a_caliper(app):
    """7-3절: 저울만으로는 ρ_dry를 식별할 수 없다."""
    out = app.calibrate_tiles(
        [
            {"dip_seconds": 2, "area_m2": 0.01, "glaze_weight_g": 4.0},
            {"dip_seconds": 4, "area_m2": 0.01, "glaze_weight_g": 5.7},
            {"dip_seconds": 8, "area_m2": 0.01, "glaze_weight_g": 8.0},
        ],
        rho=1.45,
    )
    assert out["rho_dry"] is None
    assert any("캘리퍼" in n for n in out["notes"])
    assert out["solid"] and "rho_dry" not in out["solid"]


def test_bisque_change_stops_calibration_through_the_bridge(app):
    """7-5절 재캘리브레이션 트리거가 UI 경로에서도 걸린다."""
    first = _dipped(app)
    run = app.record_run("ref30l", [first["record_id"]], [], [], [])
    app.record_result(run["run_id"], first["record_id"], "lime_matte", 1, 0, "허용")
    assert app.coefficients("lime_matte")["calibrated_bisque_c"] == 800.0

    hotter = app.register_ware("cylinder", "백자토", 950.0, glaze_interior=False)
    payload = app.glaze(
        hotter["ware_id"], "lime_matte", "담금", 500.0, 512.0, dip_seconds=4.0, rho=1.45
    )
    run2 = app.record_run("ref30l", [payload["record_id"]], [], [], [])
    out = app.record_result(
        run2["run_id"], payload["record_id"], "lime_matte", 1, 0, "허용"
    )
    assert out["calibration"]["applied"] is False
    assert any("초벌" in n for n in out["calibration"]["notes"])


# ─── 10-3절 · 처방 ───────────────────────────────────────────────────────────


def test_prescription_round_trips_through_json(app):
    payload = _dipped(app)
    sim = app.simulate("ref30l", 1220.0, 100.0, 15.0, 300.0, seed=3)
    run = app.record_run(
        "ref30l", [payload["record_id"]], sim["schedule"],
        [{"t": s["t"], "temp_c": s["sensor_c"]} for s in sim["steps"]],
        [{"from_c": 1100, "to_c": 900, "rate_c_per_h": 50, "purpose": "결정 성장"}],
    )
    p = app.issue_prescription(run["run_id"], 300.0, 1220.0)
    assert _json_safe(p)
    # 냉각이 H에 접히지 않고 곡선 그대로 실려 나간다.
    assert p["cooling"] and p["cooling"][0]["rate_c_per_h"] == 50
    assert any("냉각은 H에 합산하지 않았다" in n for n in p["provenance_notes"])

    round_tripped = json.loads(json.dumps(p, ensure_ascii=False))
    out = app.transform_prescription(round_tripped, "large")
    assert isinstance(out["feasible"], bool)
    assert out["reasons"]
    if not out["feasible"]:
        assert out["schedule"] is None


# ─── 프리셋 ──────────────────────────────────────────────────────────────────


def test_presets_are_json_safe_and_usable(app):
    presets = app.presets()
    assert _json_safe(presets)
    assert set(presets["shapes"]) == set(PRESET_SHAPES)
    assert set(presets["kilns"]) == set(PRESET_KILNS)
    assert len(presets["gloss"]) == 5 and len(presets["transparency"]) == 4


def test_preset_kiln_reproduces_the_plan_cooling_table(app):
    """9-6절 예제 가마 프리셋이 표를 그대로 낸다."""
    profile = app._kiln_profile("ref30l")
    assert round(profile.natural_cooling_rate(1220.0)) == 155
    assert round(profile.natural_cooling_rate(600.0)) == 75


def test_every_payload_is_json_safe(app):
    """경계를 넘는 것은 전부 직렬화 가능해야 한다."""
    payload = _dipped(app)
    assert _json_safe(payload)
    assert _json_safe(app.risk(payload["record_id"], "lime_matte"))
    assert _json_safe(app.materials())
    assert _json_safe(app.export_state())


# ─── 경계가 조용히 값을 버리지 않는다 ────────────────────────────────────────


def test_unknown_method_label_is_reported(app):
    ware = app.register_ware("cylinder", "백자토", 800.0)
    out = app.glaze(ware["ware_id"], "lime_matte", "스프레이", 500.0, 512.0)
    assert out["ok"] is False
    assert "담금" in out["reason"]  # 가능한 값을 알려준다


def test_unknown_failure_label_is_rejected_not_dropped(app):
    """모르는 실패 유형을 버리면 "실패인데 유형이 비었다"로 저장된다.

    도메인 불변식(`FiringResult`: 등급=실패 ⟺ 실패 유형 존재)과 어긋난 채
    기록이 남고, 사용자는 화면에서 그 사실을 확인할 방법이 없다.
    """
    payload = _dipped(app)
    run = app.record_run("ref30l", [payload["record_id"]], [], [], [])
    out = app.record_result(
        run["run_id"], payload["record_id"], "lime_matte", 1, 0, "실패",
        failures=["흐름"],  # 오타 — 실제 라벨은 "흘러내림"
    )
    assert out["ok"] is False
    assert "흘러내림" in out["reason"]


def test_unknown_grade_label_is_reported(app):
    payload = _dipped(app)
    run = app.record_run("ref30l", [payload["record_id"]], [], [], [])
    out = app.record_result(
        run["run_id"], payload["record_id"], "lime_matte", 1, 0, "좋음"
    )
    assert out["ok"] is False


# ─── 9-2절 점유율이 실제 값을 낸다 ───────────────────────────────────────────


def test_packing_ratio_is_not_silently_zero(app):
    """투영 면적이 0이면 점유율이 늘 0이라 9-2절 사슬이 끊긴다."""
    ware = app.register_ware("bowl", "백자토", 800.0)
    assert ware["footprint_area_m2"] > 0
    out = app.loading("ref30l", [ware["ware_id"]], 0.18, 10.0, 1650.0)
    assert out["packing_ratio"] > 0


def test_footprint_uses_the_widest_point(app):
    """선반에서 서로 닿지 않으려면 배가 부른 부분이 기준이다."""
    import math

    bowl = app.register_ware("bowl", "백자토", 800.0)  # r_max = 75mm
    assert bowl["footprint_area_m2"] == pytest.approx(
        math.pi * 75.0**2 / 1e6, rel=1e-9
    )


# ─── 화면이 두 번 묻지 않아도 되게 ───────────────────────────────────────────


def test_glaze_payload_carries_the_safe_band(app):
    """두께 그래프의 안전 범위 밴드가 두께와 같은 응답에 실려 온다."""
    payload = _dipped(app)
    assert payload["safe_thickness_mm"] == [0.8, 1.3]


def test_recipe_listing_reports_calibration_progress(app):
    rows = {r["recipe_id"]: r for r in app.list_recipes()}
    assert set(rows) == set(PRESET_RECIPES)
    assert rows["lime_matte"]["k1_identified"] is False

    payload = _dipped(app)
    run = app.record_run("ref30l", [payload["record_id"]], [], [], [])
    app.record_result(run["run_id"], payload["record_id"], "lime_matte", 1, 0, "허용")

    rows = {r["recipe_id"]: r for r in app.list_recipes()}
    assert rows["lime_matte"]["k1_identified"] is True
    assert rows["lime_matte"]["calibration_runs"] == 1
    # ρ_dry는 저울만으로는 식별되지 않는다 (7-3절).
    assert rows["lime_matte"]["rho_dry_identified"] is False


# ─── 새로고침에서 살아남는다 ─────────────────────────────────────────────────


def test_state_round_trips_through_json(app):
    """export → JSON → import 가 목표·레시피·계수·축적을 되돌린다."""
    app.set_target(1, 2)
    payload = _dipped(app)
    run = app.record_run("ref30l", [payload["record_id"]], [], [], [])
    app.record_result(run["run_id"], payload["record_id"], "lime_matte", 1, 0, "허용")

    blob = json.dumps(app.export_state(), ensure_ascii=False)
    restored = KilnApp()
    out = restored.import_state(json.loads(blob))

    assert out["ok"] is True
    assert restored.target.gloss.level == 1
    assert restored.target.transparency.level == 2
    assert out["observation_count"] == 1
    assert restored.coefficients("lime_matte")["k1"] == app.coefficients("lime_matte")["k1"]


def test_restore_keeps_the_provenance_of_calibrated_coefficients(app):
    """00절: 새로고침 한 번으로 k₁이 출처 없는 숫자가 되면 안 된다."""
    payload = _dipped(app)
    run = app.record_run("ref30l", [payload["record_id"]], [], [], [])
    app.record_result(run["run_id"], payload["record_id"], "lime_matte", 1, 0, "허용")

    restored = KilnApp()
    restored.import_state(json.loads(json.dumps(app.export_state(), ensure_ascii=False)))

    notes = restored.coefficients("lime_matte")["provenance_notes"]
    assert notes
    assert any("ρ_dry" in n for n in notes)
    assert restored.coefficients("lime_matte")["calibrated_bisque_c"] == 800.0


def test_restore_does_not_resurrect_in_flight_work(app):
    """기물·시유 기록·회차는 복원하지 않는다 — 진행 중인 한 회차의 작업 상태다."""
    payload = _dipped(app)
    app.record_run("ref30l", [payload["record_id"]], [], [], [])

    restored = KilnApp()
    restored.import_state(json.loads(json.dumps(app.export_state(), ensure_ascii=False)))
    assert restored.wares == {}
    assert restored.records == {}
    assert restored.runs == {}


def test_accumulation_survives_a_target_change(app):
    """5-5절: 축적은 조성→결과 매핑이다. 목표를 바꿔도 리셋되지 않는다."""
    payload = _dipped(app)
    run = app.record_run("ref30l", [payload["record_id"]], [], [], [])
    app.record_result(run["run_id"], payload["record_id"], "lime_matte", 1, 0, "허용")
    before = app.export_state()["observation_count"]

    app.set_target(4, 3)
    assert app.export_state()["observation_count"] == before


@pytest.mark.parametrize("bad", [{}, {"version": 99}, {"version": 1}, "nope"])
def test_bad_saved_state_is_reported_not_raised(app, bad):
    out = app.import_state(bad)
    assert out["ok"] is False
    assert out["reason"]


# ─── 4-4-a절 · 착색 산화물 참고 색상표는 예측이 아니라 열람이다 ──────────────


def test_color_reference_lists_the_six_oxides(app):
    rows = app.color_reference()
    assert {r["symbol"] for r in rows} == {"Fe2O3", "CoO", "CuO", "Cr2O3", "MnO2", "NiO"}
    for r in rows:
        assert "문헌 참고값" in r["note"]
        lo, hi = r["typical_pct"]
        assert 0 <= lo < hi


def test_color_reference_is_json_safe(app):
    assert _json_safe(app.color_reference())


def test_mix_color_carries_provenance(app):
    out = app.mix_color("Fe2O3", "CoO", blend_t=0.3, saturation_delta=0.1)
    assert out["ok"] is True
    assert out["hex"]
    assert out["provenance_notes"]
    assert any("문헌 참고값" in n for n in out["provenance_notes"])


def test_mix_color_does_not_touch_composition_or_search_state(app):
    """참고 색상은 kiln.search 의 입력이 아니다 — 05절 탐색 상태에 영향이 없다."""
    before = app.export_state()
    app.mix_color("Fe2O3", "CoO", blend_t=0.7)
    after = app.export_state()
    assert before["observations"] == after["observations"]
    assert before["grid_step"] == after["grid_step"]


def test_mix_color_without_amount_pct_still_reports_implied_dosing(app):
    """첨가량을 안 줘도(그냥 색만 봐도) 화면 색을 되짚어 첨가량·그램을 낸다."""
    from kiln.chem.colorants import COLORANTS

    out = app.mix_color("Fe2O3", blend_t=0.0)
    hi = COLORANTS["Fe2O3"].typical_pct[1]
    assert out["implied_amount_pct"] == pytest.approx(hi)
    assert out["match_quality"] == pytest.approx(1.0)
    assert out["grams_for_batch"] == pytest.approx(hi / 100.0 * 500.0)


def test_mix_color_saturation_and_brightness_change_the_implied_dose(app):
    """채도·명도를 조절하면 되짚은 첨가량(그램)도 그에 따라 바뀐다."""
    plain = app.mix_color("Fe2O3", amount_pct=3.0)
    adjusted = app.mix_color("Fe2O3", amount_pct=3.0, saturation_delta=0.6, brightness_delta=-0.6)
    assert adjusted["implied_amount_pct"] != pytest.approx(plain["implied_amount_pct"])
    assert adjusted["grams_for_batch"] != pytest.approx(plain["grams_for_batch"])
    assert adjusted["match_quality"] <= plain["match_quality"] + 1e-9


def test_mix_color_with_amount_pct_reports_grams_for_the_default_batch(app):
    out = app.mix_color("Fe2O3", amount_pct=2.0)
    assert out["ok"] is True
    assert out["batch_dry_g"] == 500.0
    assert out["grams_for_batch"] == pytest.approx(10.0)


def test_mix_color_with_amount_pct_and_custom_batch_size(app):
    out = app.mix_color("Fe2O3", amount_pct=2.0, batch_dry_g=1000.0)
    assert out["batch_dry_g"] == 1000.0
    assert out["grams_for_batch"] == pytest.approx(20.0)


def test_mix_color_amount_pct_zero_still_reports_zero_grams(app):
    out = app.mix_color("Fe2O3", amount_pct=0.0, batch_dry_g=500.0)
    assert out["grams_for_batch"] == 0.0


def test_mix_color_unknown_oxide_is_reported_not_raised(app):
    out = app.mix_color("존재하지않는산화물")
    assert out["ok"] is False
    assert out["reason"]
