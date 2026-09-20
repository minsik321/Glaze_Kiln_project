"""`POST /aice-runs`가 평가 완료 회차를 저장할 때 그 레시피의 적정 비중
범위(`kiln.calibration.density`)를 자동으로 갱신하는지 검증한다.

사용자 요구사항: "비중 역시 해당 레시피의 비중이어야" — 소성조건 개인화
편향(`gloss_bias_level`)이 평가 완료 회차 저장 시점에 자동으로 갱신되는
것과 같은 패턴으로, 비중도 별도 제출 화면 없이 자동으로 좁혀져야 한다.
"""

from __future__ import annotations

import json
from uuid import UUID

import httpx
import pytest

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.supabase import SupabaseGateway
from kiln.aice import sample_aice_run
from kiln.aice.identity import canonical_recipe_id

USER_ID = UUID("11111111-1111-1111-1111-111111111111")
NOW = "2026-09-20T00:00:00+00:00"


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


def _evaluated_payload(*, specific_gravity: float | None, defects: list[str] | None = None) -> dict:
    payload = sample_aice_run(NOW).to_dict()
    payload["status"] = "evaluated"
    payload["application"]["density"]["value"] = specific_gravity
    payload["result"]["gloss"] = "satin"
    payload["result"]["transparency"] = "opaque"
    payload["result"]["defects"] = list(defects or ())
    payload["result"]["defects_reviewed"] = True
    payload["result"]["match"] = "different" if defects else "close"
    return payload


@pytest.mark.asyncio
async def test_create_aice_run_updates_recipe_specific_gravity_range() -> None:
    calibration_upserts: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/rest/v1/rpc/save_aice_run" and request.method == "POST":
            body = json.loads(request.content)
            values = body["p_values"]
            return httpx.Response(201, json=[{
                "id": "33333333-3333-3333-3333-333333333333", **values,
                "request_id": body["p_request_id"], "feedback_status": "pending",
                "created_at": NOW, "updated_at": NOW,
            }])
        if request.url.path == "/rest/v1/personal_calibrations" and request.method == "GET":
            return httpx.Response(200, json=[])
        if request.url.path == "/rest/v1/rpc/commit_aice_feedback" and request.method == "POST":
            body = json.loads(request.content)
            calibration_upserts.append(body)
            return httpx.Response(200, json=[{"applied": True}])
        return httpx.Response(500)

    async def dispatch(request: httpx.Request) -> httpx.Response:
        auth = _auth_response(request)
        return auth if auth is not None else handler(request)

    upstream = httpx.AsyncClient(transport=httpx.MockTransport(dispatch))
    gateway = SupabaseGateway(make_settings(), client=upstream)
    app = create_app(make_settings(), gateway)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/aice-runs",
            headers={"Authorization": "Bearer valid-token"},
            json={"title": "비중 캘리브레이션 테스트", "run": _evaluated_payload(specific_gravity=1.46)},
        )
    assert response.status_code == 201, response.text

    density_upserts = [body for body in calibration_upserts if "density" in body.get("p_coefficients", {})]
    assert len(density_upserts) == 1
    density = density_upserts[0]["p_coefficients"]["density"]
    assert density["specific_gravity_range"] == [1.43, 1.49]
    assert density["calibration_runs"] == 1
    expected_recipe_id = canonical_recipe_id(
        {"장석": 40.0, "석회석": 20.0, "규석": 25.0, "카올린": 15.0}, {}
    )
    assert density_upserts[0]["p_recipe_id"] == expected_recipe_id
    await upstream.aclose()


@pytest.mark.asyncio
async def test_create_aice_run_skips_density_update_without_measurement() -> None:
    calibration_upserts: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/rest/v1/rpc/save_aice_run" and request.method == "POST":
            body = json.loads(request.content)
            values = body["p_values"]
            return httpx.Response(201, json=[{
                "id": "33333333-3333-3333-3333-333333333333", **values,
                "request_id": body["p_request_id"], "feedback_status": "pending",
                "created_at": NOW, "updated_at": NOW,
            }])
        if request.url.path == "/rest/v1/personal_calibrations" and request.method == "GET":
            return httpx.Response(200, json=[])
        if request.url.path == "/rest/v1/rpc/commit_aice_feedback" and request.method == "POST":
            body = json.loads(request.content)
            calibration_upserts.append(body)
            return httpx.Response(200, json=[{"applied": True}])
        return httpx.Response(500)

    async def dispatch(request: httpx.Request) -> httpx.Response:
        auth = _auth_response(request)
        return auth if auth is not None else handler(request)

    upstream = httpx.AsyncClient(transport=httpx.MockTransport(dispatch))
    gateway = SupabaseGateway(make_settings(), client=upstream)
    app = create_app(make_settings(), gateway)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/aice-runs",
            headers={"Authorization": "Bearer valid-token"},
            json={"title": "비중 미기록", "run": _evaluated_payload(specific_gravity=None)},
        )
    assert response.status_code == 201, response.text
    assert not any("density" in body.get("p_coefficients", {}) for body in calibration_upserts)
    await upstream.aclose()


@pytest.mark.asyncio
async def test_create_aice_run_applies_bounded_thinner_trial_for_running_defect_runs() -> None:
    """`running`/`crawling`은 `kiln.calibration.density`가 "결함이라 무시"가
    아니라 "제한된 다음 시험(더 얇게) 후보"로 다루는 신호다 — 완전히
    무시하지 않고 비중을 한정된 폭만큼 낮춘다(`_DENSITY_STEP`/앵커 하한)."""
    calibration_upserts: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/rest/v1/rpc/save_aice_run" and request.method == "POST":
            body = json.loads(request.content)
            values = body["p_values"]
            return httpx.Response(201, json=[{
                "id": "33333333-3333-3333-3333-333333333333", **values,
                "request_id": body["p_request_id"], "feedback_status": "pending",
                "created_at": NOW, "updated_at": NOW,
            }])
        if request.url.path == "/rest/v1/personal_calibrations" and request.method == "GET":
            return httpx.Response(200, json=[])
        if request.url.path == "/rest/v1/rpc/commit_aice_feedback" and request.method == "POST":
            body = json.loads(request.content)
            calibration_upserts.append(body)
            return httpx.Response(200, json=[{"applied": True}])
        return httpx.Response(500)

    async def dispatch(request: httpx.Request) -> httpx.Response:
        auth = _auth_response(request)
        return auth if auth is not None else handler(request)

    upstream = httpx.AsyncClient(transport=httpx.MockTransport(dispatch))
    gateway = SupabaseGateway(make_settings(), client=upstream)
    app = create_app(make_settings(), gateway)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/v1/aice-runs",
            headers={"Authorization": "Bearer valid-token"},
            json={"title": "흘러내림 결함", "run": _evaluated_payload(specific_gravity=1.55, defects=["running"])},
        )
    assert response.status_code == 201, response.text
    density_upserts = [body for body in calibration_upserts if "density" in body.get("p_coefficients", {})]
    assert len(density_upserts) == 1
    density = density_upserts[0]["p_coefficients"]["density"]
    assert density["specific_gravity_range"] == [1.51, 1.57]
    assert density["calibration_runs"] == 1
    await upstream.aclose()
