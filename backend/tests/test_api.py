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
    return httpx.Response(200, json={
        "id": str(USER_ID),
        "email": "kiln@example.com",
        "role": "authenticated",
        "user_metadata": {"display_name": "Kiln tester"},
        "identities": [],
    })


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
        if request.method == "POST":
            assert request.url.path == "/rest/v1/rpc/save_aice_run"
            body = json.loads(request.content)
            values = body["p_values"]
            assert values["user_id"] == str(USER_ID)
            assert values["schema_version"] == 3
            assert values["payload"]["sources"][0]["source_type"] == "literature"
            assert values["payload"]["versions"]["rule_model"] == "rule-rank-1"
            return httpx.Response(201, json=[{
                "id": str(RECORD_ID), **values, "created_at": NOW, "updated_at": NOW,
            }])
        assert request.url.path == "/rest/v1/aice_runs"
        assert request.url.params["user_id"] == f"eq.{USER_ID}"
        return httpx.Response(200, json=[{
            "id": str(RECORD_ID), "user_id": str(USER_ID), "title": "AICE sample",
            "payload": payload, "schema_version": 3, "status": payload["status"],
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
    assert created.json()["run"]["schema_version"] == 3
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


@pytest.mark.asyncio
async def test_aice_publish_requires_all_consent_and_withdraws_from_public_read() -> None:
    payload = sample_aice_run().to_dict()
    calls: list[tuple[str, str]] = []

    def row(is_public: bool, run: dict) -> dict:
        return {"id": str(RECORD_ID), "user_id": str(USER_ID), "title": "AICE sample", "payload": run,
                "schema_version": 3, "status": run["status"], "goal_gloss": run["goal"]["gloss"],
                "goal_transparency": run["goal"]["transparency"], "recipe_id": run["recipe"]["id"],
                "ware_preset": run["ware"]["preset"], "is_public": is_public, "created_at": NOW, "updated_at": NOW}

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path))
        if request.method == "GET":
            return httpx.Response(200, json=[row(False, payload)])
        body = json.loads(request.content)
        if request.url.path == "/rest/v1/aice_consents":
            assert request.url.params["on_conflict"] == "run_id"
            assert body["photo_rights_confirmed"] and body["pii_reviewed"] and body["location_removed"]
            return httpx.Response(201, json=[body])
        assert request.url.path == "/rest/v1/aice_runs"
        assert body["is_public"] is True
        assert body["payload"]["consent"]["share_allowed"] is True
        return httpx.Response(200, json=[row(True, body["payload"])])

    app, upstream = client_for(handler)
    headers = {"Authorization": "Bearer valid-token"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        incomplete = await client.post(f"/api/v1/aice-runs/{RECORD_ID}/publish", headers=headers, json={"photo_rights_confirmed": True, "pii_reviewed": True, "location_removed": True, "withdrawal_understood": False})
        published = await client.post(f"/api/v1/aice-runs/{RECORD_ID}/publish", headers=headers, json={"photo_rights_confirmed": True, "pii_reviewed": True, "location_removed": True, "withdrawal_understood": True})
    assert incomplete.status_code == 422
    assert published.status_code == 200
    assert published.json()["is_public"] is True
    assert ("POST", "/rest/v1/aice_consents") in calls
    await upstream.aclose()


@pytest.mark.asyncio
async def test_aice_withdraw_sets_timestamp_before_private_transition() -> None:
    payload = sample_aice_run().to_dict()
    payload["consent"] = {"share_allowed": True, "photo_rights_confirmed": True, "pii_reviewed": True, "location_removed": True, "withdrawn_at": None}
    consent_withdrawn = False

    def row(is_public: bool, run: dict) -> dict:
        return {"id": str(RECORD_ID), "user_id": str(USER_ID), "title": "AICE sample", "payload": run,
                "schema_version": 3, "status": run["status"], "goal_gloss": run["goal"]["gloss"],
                "goal_transparency": run["goal"]["transparency"], "recipe_id": run["recipe"]["id"],
                "ware_preset": run["ware"]["preset"], "is_public": is_public, "created_at": NOW, "updated_at": NOW}

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal consent_withdrawn
        if request.method == "GET":
            return httpx.Response(200, json=[row(True, payload)])
        body = json.loads(request.content)
        if request.url.path == "/rest/v1/aice_consents":
            consent_withdrawn = bool(body["withdrawn_at"] and body["share_allowed"] is False)
            return httpx.Response(200, json=[body])
        assert consent_withdrawn
        assert body["is_public"] is False
        assert body["payload"]["consent"]["withdrawn_at"]
        return httpx.Response(200, json=[row(False, body["payload"])])

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        withdrawn = await client.delete(f"/api/v1/aice-runs/{RECORD_ID}/publication", headers={"Authorization": "Bearer valid-token"})
    assert withdrawn.status_code == 200
    assert withdrawn.json()["is_public"] is False
    assert withdrawn.json()["run"]["consent"]["share_allowed"] is False
    await upstream.aclose()
