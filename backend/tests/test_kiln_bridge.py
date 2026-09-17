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
