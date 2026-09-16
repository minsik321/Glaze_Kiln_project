from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import UUID

import httpx
import pytest

from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.supabase import SupabaseGateway
from kiln.aice import sample_aice_run

USER_ID = UUID("11111111-1111-1111-1111-111111111111")
RECORD_ID = UUID("22222222-2222-2222-2222-222222222222")
NOW = datetime(2026, 9, 15, tzinfo=timezone.utc).isoformat()


def make_settings() -> Settings:
    return Settings(
        supabase_url="https://example.supabase.co",
        supabase_publishable_key="sb_publishable_test",
    )


def auth_response(request: httpx.Request) -> httpx.Response | None:
    if request.url.path != "/auth/v1/user":
        return None
    if request.headers.get("authorization") != "Bearer valid-token":
        return httpx.Response(401, json={"message": "bad token"})
    return httpx.Response(200, json={"id": str(USER_ID)})


def client_for(handler):
    async def dispatch(request: httpx.Request) -> httpx.Response:
        auth = auth_response(request)
        return auth if auth is not None else handler(request)

    upstream = httpx.AsyncClient(transport=httpx.MockTransport(dispatch))
    gateway = SupabaseGateway(make_settings(), client=upstream)
    return create_app(make_settings(), gateway), upstream


@pytest.mark.asyncio
async def test_health_and_readiness() -> None:
    app, upstream = client_for(lambda _: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        assert (await client.get("/api/v1/health")).json() == {"status": "ok"}
        assert (await client.get("/api/v1/readiness")).json() == {
            "status": "ready",
            "supabase_configured": True,
        }
    await upstream.aclose()


@pytest.mark.asyncio
async def test_missing_and_invalid_tokens_are_consistent() -> None:
    app, upstream = client_for(lambda _: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        missing = await client.get("/api/v1/work-records")
        invalid = await client.get(
            "/api/v1/work-records", headers={"Authorization": "Bearer expired"}
        )
    assert missing.status_code == 401
    assert missing.json()["detail"]["code"] == "authentication_required"
    assert invalid.status_code == 401
    assert invalid.json()["detail"]["code"] == "invalid_token"
    await upstream.aclose()


@pytest.mark.asyncio
async def test_create_record_forwards_token_and_verified_user() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/work_records"
        assert request.method == "POST"
        assert request.headers["apikey"] == "sb_publishable_test"
        assert request.headers["authorization"] == "Bearer valid-token"
        body = json.loads(request.content)
        assert body["user_id"] == str(USER_ID)
        assert body["title"] == "첫 소성"
        return httpx.Response(
            201,
            json=[{
                "id": str(RECORD_ID),
                "title": body["title"],
                "payload": body["payload"],
                "schema_version": 1,
                "is_public": False,
                "created_at": NOW,
                "updated_at": NOW,
            }],
        )

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/work-records",
            headers={"Authorization": "Bearer valid-token"},
            json={"title": "  첫 소성  ", "payload": {"cone": 6}},
        )
    assert response.status_code == 201
    assert response.json()["title"] == "첫 소성"
    assert "user_id" not in response.json()
    await upstream.aclose()


@pytest.mark.asyncio
async def test_owner_list_is_scoped_and_paginated() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["user_id"] == f"eq.{USER_ID}"
        assert request.url.params["limit"] == "10"
        assert request.url.params["offset"] == "5"
        return httpx.Response(200, json=[])

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/api/v1/work-records?limit=10&offset=5",
            headers={"Authorization": "Bearer valid-token"},
        )
    assert response.json() == {"items": [], "limit": 10, "offset": 5}
    await upstream.aclose()


@pytest.mark.asyncio
async def test_public_feed_filters_public_without_exposing_owner() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["is_public"] == "eq.true"
        assert "user_id" not in request.url.params["select"]
        return httpx.Response(
            200,
            json=[{
                "id": str(RECORD_ID),
                "title": "공개 기록",
                "payload": {},
                "schema_version": 1,
                "is_public": True,
                "created_at": NOW,
                "updated_at": NOW,
            }],
        )

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/api/v1/public/work-records",
            headers={"Authorization": "Bearer valid-token"},
        )
    assert response.status_code == 200
    assert "user_id" not in response.json()["items"][0]
    await upstream.aclose()


@pytest.mark.asyncio
async def test_validation_rejects_blank_title_and_large_page() -> None:
    app, upstream = client_for(lambda _: httpx.Response(500))
    headers = {"Authorization": "Bearer valid-token"}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        blank = await client.post(
            "/api/v1/work-records",
            headers=headers,
            json={"title": "  ", "payload": {}},
        )
        page = await client.get("/api/v1/work-records?limit=101", headers=headers)
    assert blank.status_code == 422
    assert blank.json()["detail"]["code"] == "validation_error"
    assert page.status_code == 422
    await upstream.aclose()


@pytest.mark.asyncio
async def test_aice_run_round_trip_preserves_provenance_and_versions() -> None:
    payload = sample_aice_run().to_dict()

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/aice_runs"
        if request.method == "POST":
            body = json.loads(request.content)
            assert body["user_id"] == str(USER_ID)
            assert body["schema_version"] == 2
            assert body["payload"]["sources"][0]["source_type"] == "literature"
            assert body["payload"]["versions"]["rule_model"] == "rule-rank-1"
            return httpx.Response(201, json=[{
                "id": str(RECORD_ID), **body, "created_at": NOW, "updated_at": NOW,
            }])
        assert request.url.params["user_id"] == f"eq.{USER_ID}"
        return httpx.Response(200, json=[{
            "id": str(RECORD_ID), "user_id": str(USER_ID), "title": "AICE sample",
            "payload": payload, "schema_version": 2, "status": payload["status"],
            "goal_gloss": payload["goal"]["gloss"], "goal_transparency": payload["goal"]["transparency"],
            "recipe_id": payload["recipe"]["id"], "ware_preset": payload["ware"]["preset"],
            "is_public": False, "created_at": NOW, "updated_at": NOW,
        }])

    app, upstream = client_for(handler)
    headers = {"Authorization": "Bearer valid-token"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        created = await client.post("/api/v1/aice-runs", headers=headers, json={"title": " AICE sample ", "run": payload})
        loaded = await client.get(f"/api/v1/aice-runs/{RECORD_ID}", headers=headers)
    assert created.status_code == 201
    assert loaded.status_code == 200
    assert created.json()["run"]["sources"] == loaded.json()["run"]["sources"]
    assert created.json()["run"]["versions"] == loaded.json()["run"]["versions"]
    assert created.json()["run"]["schema_version"] == 2
    await upstream.aclose()


@pytest.mark.asyncio
async def test_aice_run_rejects_unknown_source_and_public_without_consent() -> None:
    app, upstream = client_for(lambda _: httpx.Response(500))
    headers = {"Authorization": "Bearer valid-token"}
    invalid_source = sample_aice_run().to_dict()
    invalid_source["sources"][0]["source_type"] = "measured"
    private_consent = sample_aice_run().to_dict()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        bad_source = await client.post("/api/v1/aice-runs", headers=headers, json={"title": "Bad", "run": invalid_source})
        bad_public = await client.post("/api/v1/aice-runs", headers=headers, json={"title": "Public", "run": private_consent, "is_public": True})
    assert bad_source.status_code == 422
    assert bad_public.status_code == 422
    await upstream.aclose()
