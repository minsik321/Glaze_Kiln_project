from __future__ import annotations

import json
import base64
from uuid import UUID

import httpx
import pytest

from backend.app.aimlapi import AimlapiClient, AimlapiSettings
from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.supabase import SupabaseGateway

USER_ID = UUID("11111111-1111-1111-1111-111111111111")


def make_settings() -> Settings:
    return Settings(
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_test",
        aimlapi_api_key="test-key",
        aimlapi_text_model="test/text-model",
    )


def _auth_response(request: httpx.Request) -> httpx.Response | None:
    if request.url.path != "/auth/v1/user":
        return None
    if request.headers.get("authorization") != "Bearer valid-token":
        return httpx.Response(401, json={"message": "bad token"})
    return httpx.Response(200, json={"id": str(USER_ID)})


def _app_with_llm(llm_handler):
    auth_upstream = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: _auth_response(r) or httpx.Response(500))
    )
    gateway = SupabaseGateway(make_settings(), client=auth_upstream)
    llm_upstream = httpx.AsyncClient(transport=httpx.MockTransport(llm_handler))
    llm = AimlapiClient(
        AimlapiSettings(
            api_key="test-key", text_model="test/text-model", image_model="test/image-model"
        ),
        client=llm_upstream,
    )
    return create_app(make_settings(), gateway, llm), auth_upstream, llm_upstream


@pytest.mark.asyncio
async def test_suggest_recipe_candidates_returns_validated_candidates() -> None:
    llm_json = {
        "candidates": [
            {
                "id": "cand-1",
                "name": "해안 사틴",
                "materials": {"장석": 40.0, "석회석": 20.0, "규석": 25.0, "카올린": 15.0},
                "predicted_firing_range_c": [1180, 1230],
                "predicted_firing_note": "환원 소성",
            },
            {
                "id": "cand-2",
                "name": "존재하지 않는 원료",
                "materials": {"목회": 100.0},
            },
        ]
    }

    def llm_handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(llm_json)}}]},
        )

    app, auth_upstream, llm_upstream = _app_with_llm(llm_handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/aice/recipe-candidates",
            json={"prompt_text": "사발에 어울리는 청록색 사틴 유약"},
            headers={"Authorization": "Bearer valid-token"},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["candidates"]) == 1
    assert body["candidates"][0]["id"] == "cand-1"
    assert len(body["dropped"]) == 1
    assert "cand-2" in body["dropped"][0]
    await auth_upstream.aclose()
    await llm_upstream.aclose()


@pytest.mark.asyncio
async def test_suggest_recipe_candidates_requires_auth() -> None:
    app, auth_upstream, llm_upstream = _app_with_llm(lambda _: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/aice/recipe-candidates", json={"prompt_text": "유약"}
        )
    assert response.status_code == 401
    await auth_upstream.aclose()
    await llm_upstream.aclose()


@pytest.mark.asyncio
async def test_suggest_recipe_candidates_maps_llm_error() -> None:
    def llm_handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "invalid api key"}})

    app, auth_upstream, llm_upstream = _app_with_llm(llm_handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/aice/recipe-candidates",
            json={"prompt_text": "유약"},
            headers={"Authorization": "Bearer valid-token"},
        )
    assert response.status_code == 401
    assert response.json()["detail"]["message"] == "invalid api key"
    await auth_upstream.aclose()
    await llm_upstream.aclose()


@pytest.mark.asyncio
async def test_generate_recipe_candidate_image_returns_base64() -> None:
    raw = b"\x89PNG\r\n\x1a\nfake-png-bytes"

    def llm_handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/images/generations"
        return httpx.Response(
            200, json={"data": [{"b64_json": base64.b64encode(raw).decode()}]}
        )

    app, auth_upstream, llm_upstream = _app_with_llm(llm_handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/aice/recipe-candidates/image",
            json={
                "candidate_name": "해안 사틴",
                "materials": {"장석": 40.0, "석회석": 20.0, "규석": 25.0, "카올린": 15.0},
                "style_note": "청록색, 은은한 광택",
            },
            headers={"Authorization": "Bearer valid-token"},
        )
    assert response.status_code == 200, response.text
    assert base64.b64decode(response.json()["image_base64"]) == raw
    assert response.json()["media_type"] == "image/png"
    await auth_upstream.aclose()
    await llm_upstream.aclose()
