from __future__ import annotations

import httpx
import pytest

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.supabase import SupabaseGateway
from backend.app import kiln_bridge
from kiln.firing.controller import Phase
from kiln.firing.simulator import Disturbance

SCHEDULE = [(0.0, 20.0), (60.0, 110.0), (300.0, 980.0), (360.0, 1199.0), (400.0, 1199.0), (480.0, 631.0)]


def make_settings() -> Settings:
    return Settings(
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_test",
    )


def make_app() -> tuple[object, httpx.AsyncClient]:
    # 이 엔드포인트는 로그인·Supabase를 쓰지 않는다 — upstream 호출이 오면
    # 즉시 실패하게 해서 그 사실을 테스트로 못 박는다.
    upstream = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(500))
    )
    gateway = SupabaseGateway(make_settings(), client=upstream)
    return create_app(make_settings(), gateway), upstream


@pytest.mark.asyncio
async def test_simulate_endpoint_needs_no_auth_and_reports_provenance() -> None:
    app, upstream = make_app()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/kiln/firing/simulate",
            json={"schedule": SCHEDULE, "dt_s": 300.0},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["samples"]
        assert "가정" in body["e_note"]
        assert any("오지정" in note for note in body["provenance_notes"])
    await upstream.aclose()


@pytest.mark.asyncio
async def test_phases_move_ramp_hold_cool_in_order() -> None:
    app, upstream = make_app()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/kiln/firing/simulate",
            json={"schedule": SCHEDULE, "dt_s": 300.0},
        )
        phases = [sample["phase"] for sample in response.json()["samples"]]
        first_hold = phases.index(Phase.HOLD.value)
        first_cool = phases.index(Phase.COOL.value)
        assert phases[0] == Phase.RAMP.value
        assert first_hold < first_cool
        assert phases[-1] == Phase.COOL.value
    await upstream.aclose()


@pytest.mark.asyncio
async def test_rejects_non_increasing_schedule() -> None:
    app, upstream = make_app()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/kiln/firing/simulate",
            json={"schedule": [(0.0, 20.0), (0.0, 100.0)]},
        )
        assert response.status_code == 422
    await upstream.aclose()


def test_same_seed_is_reproducible() -> None:
    """12-2절: 같은 seed면 재현된다 — provenance_notes의 주장 그대로."""
    disturbance = Disturbance(thermocouple_noise_c=1.5, seed=7)
    first = kiln_bridge.simulate(SCHEDULE, disturbance, dt_s=300.0)
    second = kiln_bridge.simulate(SCHEDULE, disturbance, dt_s=300.0)
    assert [s.sensor_c for s in first.samples] == [s.sensor_c for s in second.samples]


def test_bridge_result_carries_e_assumption_note() -> None:
    result = kiln_bridge.simulate(SCHEDULE, Disturbance(), dt_s=300.0)
    assert kiln_bridge.E_ASSUMPTION_REASON in result.e_note
    assert result.target_heat_work > 0
    assert result.peak_c == 1199.0


def test_compute_thickness_dipping_produces_real_distribution() -> None:
    """07절: 담금 + 담금시간이 있으면 t_abs/t_flow 분포가 실제로 계산된다."""
    profile = kiln_bridge.compute_thickness(
        ware_preset="bowl",
        weight_before_g=200.0,
        weight_after_g=296.0,
        method="담금",
        dip_seconds=9.0,
        specific_gravity=1.45,
    )
    assert profile.has_distribution is True
    assert profile.mean_mm == pytest.approx(profile.glaze_weight_g / (profile.rho_dry * profile.area_m2 * 1000.0))
    # 위치별 값이 전부 같은 상수가 아니다 — 정적 조회표가 아니라 형상 적분이다.
    totals = {round(p.total, 6) for p in profile.points}
    assert len(totals) > 1


def test_compute_thickness_non_dipping_has_no_distribution() -> None:
    """7-5절: 담금이 아니면 부위별 분포를 지어내지 않는다."""
    profile = kiln_bridge.compute_thickness(
        ware_preset="tile", weight_before_g=100.0, weight_after_g=110.0, method="붓칠",
    )
    assert profile.has_distribution is False
    assert all(p.total == pytest.approx(profile.mean_mm) for p in profile.points)


def test_compute_thickness_unknown_preset_raises() -> None:
    with pytest.raises(ValueError, match="기물 프리셋"):
        kiln_bridge.compute_thickness(
            ware_preset="not-a-shape", weight_before_g=1.0, weight_after_g=2.0, method="담금", dip_seconds=1.0,
        )


def test_recommend_dip_time_round_trips_through_predicted_mean() -> None:
    result = kiln_bridge.recommend_dip_time(target_mm=1.0, specific_gravity=1.45)
    assert result.feasible is True
    assert result.predicted_mean_mm == pytest.approx(1.0, abs=1e-6)


def test_coefficient_table_round_trip_through_dict() -> None:
    from kiln.domain.models import CoefficientTable

    table = CoefficientTable(recipe_id="coastal-satin", k1=0.5, calibration_runs=3)
    data = kiln_bridge.coefficient_table_to_dict(table)
    restored = kiln_bridge.coefficient_table_from_dict("coastal-satin", data)
    assert restored.k1 == 0.5
    assert restored.calibration_runs == 3


def test_coefficient_table_from_empty_dict_is_undetermined() -> None:
    table = kiln_bridge.coefficient_table_from_dict("new-recipe", None)
    assert table.k1 is None
    assert table.calibration_runs == 0


def test_apply_calibration_run_advances_calibration_runs() -> None:
    from kiln.domain.models import CoefficientTable

    table = CoefficientTable(recipe_id="coastal-satin")
    result = kiln_bridge.apply_calibration_run(
        table,
        ware_preset="bowl",
        bisque_temperature_c=950.0,
        weight_before_g=200.0,
        weight_after_g=296.0,
        method="담금",
        dip_seconds=9.0,
        specific_gravity=1.45,
    )
    assert result.applied is True
    assert result.table.calibration_runs == 1
    assert result.table.k1 is not None
