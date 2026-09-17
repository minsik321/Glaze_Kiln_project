from __future__ import annotations

import json
from uuid import UUID

import httpx
import pytest

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.supabase import SupabaseGateway

USER_ID = UUID("11111111-1111-1111-1111-111111111111")


def make_settings() -> Settings:
    return Settings(
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_test",
    )


def _auth_response(request: httpx.Request) -> httpx.Response | None:
    if request.url.path != "/auth/v1/user":
        return None
    if request.headers.get("authorization") != "Bearer valid-token":
        return httpx.Response(401, json={"message": "bad token"})
    return httpx.Response(200, json={"id": str(USER_ID)})


def client_for(handler):
    async def dispatch(request: httpx.Request) -> httpx.Response:
        auth = _auth_response(request)
        return auth if auth is not None else handler(request)

    upstream = httpx.AsyncClient(transport=httpx.MockTransport(dispatch))
    gateway = SupabaseGateway(make_settings(), client=upstream)
    return create_app(make_settings(), gateway), upstream


@pytest.mark.asyncio
async def test_thickness_profile_endpoint_needs_no_auth() -> None:
    app, upstream = client_for(lambda _: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/kiln/thickness/profile",
            json={
                "ware_preset": "bowl",
                "weight_before_g": 200.0,
                "weight_after_g": 296.0,
                "method": "담금",
                "dip_seconds": 9.0,
                "specific_gravity": 1.45,
            },
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_distribution"] is True
    assert body["mean_mm"] > 0
    assert len(body["points"]) > 2
    await upstream.aclose()


@pytest.mark.asyncio
async def test_thickness_profile_rejects_lighter_after_weight() -> None:
    app, upstream = client_for(lambda _: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/kiln/thickness/profile",
            json={"ware_preset": "bowl", "weight_before_g": 300.0, "weight_after_g": 200.0, "method": "담금", "dip_seconds": 9.0},
        )
    assert response.status_code == 422
    await upstream.aclose()


@pytest.mark.asyncio
async def test_dip_time_endpoint_needs_no_auth() -> None:
    app, upstream = client_for(lambda _: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/kiln/batch/dip-time",
            json={"target_mm": 1.0, "specific_gravity": 1.45},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["feasible"] is True
    assert body["seconds"] > 0
    await upstream.aclose()


@pytest.mark.asyncio
async def test_get_calibration_defaults_to_undetermined_when_no_row() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/personal_calibrations"
        assert request.method == "GET"
        return httpx.Response(200, json=[])

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/api/v1/aice/calibration/coastal-satin",
            headers={"Authorization": "Bearer valid-token"},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["recipe_id"] == "coastal-satin"
    assert body["k1"] is None
    assert body["calibration_runs"] == 0
    await upstream.aclose()


@pytest.mark.asyncio
async def test_submit_calibration_run_upserts_and_returns_updated_table() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            assert request.url.path == "/rest/v1/personal_calibrations"
            return httpx.Response(200, json=[])
        assert request.method == "POST"
        body = json.loads(request.content)
        assert body["recipe_id"] == "coastal-satin"
        assert body["user_id"] == str(USER_ID)
        assert body["coefficients"]["calibration_runs"] == 1
        assert request.url.params.get("on_conflict") == "user_id,recipe_id,version"
        return httpx.Response(200, json=[{**body, "id": "row-1"}])

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/aice/calibration/coastal-satin/runs",
            json={
                "ware_preset": "bowl",
                "bisque_temperature_c": 950.0,
                "weight_before_g": 200.0,
                "weight_after_g": 296.0,
                "method": "담금",
                "dip_seconds": 9.0,
                "specific_gravity": 1.45,
            },
            headers={"Authorization": "Bearer valid-token"},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["applied"] is True
    assert body["table"]["calibration_runs"] == 1
    assert body["table"]["k1"] is not None
    await upstream.aclose()


@pytest.mark.asyncio
async def test_calibration_routes_require_auth() -> None:
    app, upstream = client_for(lambda _: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/v1/aice/calibration/coastal-satin")
    assert response.status_code == 401
    await upstream.aclose()


@pytest.mark.asyncio
async def test_get_calibration_reports_firing_bias_when_present() -> None:
    """GET 응답에 소성조건 개인화 편향(gloss_bias_level)이 실려 나가야
    predictionModel.ts가 다음 회차 제안에 반영할 수 있다."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/personal_calibrations"
        assert request.method == "GET"
        return httpx.Response(200, json=[{
            "coefficients": {
                "recipe_id": "coastal-satin", "k1": 0.55, "calibration_runs": 3,
                "firing": {"recipe_id": "coastal-satin", "gloss_bias_level": 1.25, "calibration_runs": 4, "provenance_notes": []},
            }
        }])

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/api/v1/aice/calibration/coastal-satin",
            headers={"Authorization": "Bearer valid-token"},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["k1"] == 0.55
    assert body["gloss_bias_level"] == 1.25
    assert body["firing_calibration_runs"] == 4
    await upstream.aclose()


@pytest.mark.asyncio
async def test_submit_calibration_run_preserves_existing_firing_bias() -> None:
    """두께 계수(k1) 갱신이 같은 행의 소성조건 개인화 편향("firing" 키)을
    지워버리면 안 된다 — 두 신호가 같은 jsonb 컬럼을 공유하기 때문."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json=[{
                "coefficients": {
                    "firing": {"recipe_id": "coastal-satin", "gloss_bias_level": 2.0, "calibration_runs": 1, "provenance_notes": ["기존 편향"]},
                },
            }])
        assert request.method == "POST"
        body = json.loads(request.content)
        # 두께 계수는 새로 갱신되면서도, 기존 firing 편향은 그대로 남아 있어야 한다.
        assert body["coefficients"]["calibration_runs"] == 1
        assert body["coefficients"]["firing"]["gloss_bias_level"] == 2.0
        return httpx.Response(200, json=[{**body, "id": "row-1"}])

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/aice/calibration/coastal-satin/runs",
            json={
                "ware_preset": "bowl",
                "bisque_temperature_c": 950.0,
                "weight_before_g": 200.0,
                "weight_after_g": 296.0,
                "method": "담금",
                "dip_seconds": 9.0,
                "specific_gravity": 1.45,
            },
            headers={"Authorization": "Bearer valid-token"},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    # 응답에도 보존된 firing 편향이 함께 실려 나가야 한다.
    assert body["table"]["gloss_bias_level"] == 2.0
    assert body["table"]["firing_calibration_runs"] == 1
    await upstream.aclose()
