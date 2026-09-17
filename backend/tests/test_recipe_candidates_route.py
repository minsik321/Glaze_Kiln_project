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


def _two_stage_handler(description_json: dict):
    """v9: 1차 호출(목표 분류) → 2차 호출(고정 배합 서술)을 호출 순서로 구분한다."""

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        request_body = json.loads(request.content)
        system = request_body["messages"][0]["content"]
        if "target_gloss" in system:
            payload = {"target_gloss": "SATIN", "target_transparency": "OPAQUE"}
        else:
            payload = description_json
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(payload)}}]},
        )

    return handler


@pytest.mark.asyncio
async def test_suggest_recipe_candidates_returns_validated_candidates() -> None:
    description_json = {
        "candidates": [
            {
                "id": "cand-1",
                "name": "해안 사틴",
                "colorants": {"CuO": 2.0, "CoO": 0.2},
                "colorant_note": "청록색 참고값이며 실제 발색은 달라질 수 있음",
                "predicted_firing_range_c": [1180, 1230],
                "predicted_firing_note": "환원 소성",
            },
            {
                "id": "cand-2",
                "name": "허용되지 않은 착색제",
                "colorants": {"Unobtainium": 5.0},
            },
        ]
    }

    app, auth_upstream, llm_upstream = _app_with_llm(_two_stage_handler(description_json))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/aice/recipe-candidates",
            json={"prompt_text": "사발에 어울리는 청록색 사틴 유약", "candidate_count": 2},
            headers={"Authorization": "Bearer valid-token"},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    # v9: 배합비는 kiln.search가 냈다 — LLM은 materials를 아예 받지 않았다.
    assert body["candidates"][0]["materials"]
    assert body["candidates"][0]["colorants"] == {"CuO": 2.0, "CoO": 0.2}
    assert "청록색" in body["candidates"][0]["colorant_note"]
    assert body["candidates"][0]["composition_note"]
    assert any("cand-2" in dropped for dropped in body["dropped"])
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
        request_body = json.loads(request.content)
        assert "발색 산화물 외배합: CuO 2.0%" in request_body["prompt"]
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
                "colorants": {"CuO": 2.0},
                "style_note": "청록색, 은은한 광택",
            },
            headers={"Authorization": "Bearer valid-token"},
        )
    assert response.status_code == 200, response.text
    assert base64.b64decode(response.json()["image_base64"]) == raw
    assert response.json()["media_type"] == "image/png"
    await auth_upstream.aclose()
    await llm_upstream.aclose()
