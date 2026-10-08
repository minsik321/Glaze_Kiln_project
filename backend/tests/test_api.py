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
        missing = await client.get("/api/v1/aice-runs")
        invalid = await client.get(
            "/api/v1/aice-runs", headers={"Authorization": "Bearer expired"}
        )
    assert missing.status_code == 401
    assert missing.json()["detail"]["code"] == "authentication_required"
    assert invalid.status_code == 401
    assert invalid.json()["detail"]["code"] == "invalid_token"
    await upstream.aclose()


@pytest.mark.asyncio
async def test_delete_aice_run_is_scoped_to_owner() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "DELETE"
        assert request.url.path == "/rest/v1/aice_runs"
        assert request.url.params["id"] == f"eq.{RECORD_ID}"
        assert request.url.params["user_id"] == f"eq.{USER_ID}"
        return httpx.Response(200, json=[{"id": str(RECORD_ID)}])

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.delete(
            f"/api/v1/aice-runs/{RECORD_ID}",
            headers={"Authorization": "Bearer valid-token"},
        )

    assert response.status_code == 204
    await upstream.aclose()


@pytest.mark.asyncio
async def test_owner_list_forwards_token_and_is_scoped_and_paginated() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/aice_runs"
        assert request.headers["apikey"] == "sb_publishable_test"
        assert request.headers["authorization"] == "Bearer valid-token"
        assert request.url.params["user_id"] == f"eq.{USER_ID}"
        assert request.url.params["limit"] == "10"
        assert request.url.params["offset"] == "5"
        return httpx.Response(200, json=[])

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/api/v1/aice-runs?limit=10&offset=5",
            headers={"Authorization": "Bearer valid-token"},
        )
    assert response.json() == {"items": [], "limit": 10, "offset": 5}
    await upstream.aclose()


@pytest.mark.asyncio
async def test_owner_summaries_select_only_list_fields_and_derive_peak_and_origin() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/aice_runs"
        assert request.url.params["user_id"] == f"eq.{USER_ID}"
        assert request.url.params["limit"] == "20"
        assert request.url.params["offset"] == "0"
        select = request.url.params["select"]
        assert "payload," not in select and not select.endswith(",payload")
        return httpx.Response(200, json=[
            {
                "id": str(RECORD_ID), "title": "청록 유약", "status": "evaluated", "created_at": NOW,
                "recipe_name": "청록", "sources": [{"reference": "x"}],
                "points": [{"minute": 0, "temperature_c": 20}, {"minute": 60, "temperature_c": 1230.5}],
            },
            {
                "id": str(USER_ID), "title": "가져옴", "status": "draft", "created_at": NOW,
                "recipe_name": None, "points": None,
                "sources": [{"reference": "aice-feed-post-import"}],
            },
        ])

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/v1/aice-runs/summaries", headers={"Authorization": "Bearer valid-token"})

    assert response.status_code == 200
    first, second = response.json()["items"]
    assert first["origin"] == "mine" and first["peak_c"] == 1230.5 and first["recipe_name"] == "청록"
    assert "run" not in first and "payload" not in first
    assert second["origin"] == "imported" and second["peak_c"] is None and second["recipe_name"] == ""
    await upstream.aclose()


@pytest.mark.asyncio
async def test_public_feed_filters_public_without_exposing_owner() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["is_public"] == "eq.true"
        assert "user_id" not in request.url.params["select"]
        return httpx.Response(200, json=[])

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(
            "/api/v1/public/aice-runs",
            headers={"Authorization": "Bearer valid-token"},
        )
    assert response.status_code == 200
    assert response.json()["items"] == []
    await upstream.aclose()


@pytest.mark.asyncio
async def test_validation_rejects_large_page() -> None:
    app, upstream = client_for(lambda _: httpx.Response(500))
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        page = await client.get(
            "/api/v1/aice-runs?limit=101", headers={"Authorization": "Bearer valid-token"}
        )
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
async def test_aice_run_falls_back_to_rls_insert_when_atomic_rpc_is_not_migrated() -> None:
    payload = sample_aice_run().to_dict()
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/rest/v1/rpc/save_aice_run":
            return httpx.Response(404, json={
                "code": "PGRST202",
                "message": "Could not find the function public.save_aice_run",
            })
        assert request.url.path == "/rest/v1/aice_runs"
        values = json.loads(request.content)
        assert values["user_id"] == str(USER_ID)
        # The DB derives the title column from the payload, so both must agree here.
        assert values["title"] == values["payload"]["title"] == "이전 질문 저장"
        return httpx.Response(201, json=[{
            "id": str(RECORD_ID), **values, "created_at": NOW, "updated_at": NOW,
        }])

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert payload["title"] != "이전 질문 저장"  # the run itself carries a different title
        created = await client.post(
            "/api/v1/aice-runs",
            headers={"Authorization": "Bearer valid-token"},
            json={"title": "이전 질문 저장", "run": payload},
        )

    assert created.status_code == 201
    assert created.json()["title"] == "이전 질문 저장"
    assert created.json()["run"]["title"] == "이전 질문 저장"
    assert calls == ["/rest/v1/rpc/save_aice_run", "/rest/v1/aice_runs"]
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
            # aice_consents CHECK: share_allowed requires granted_at.
            assert body["share_allowed"] is True and body["granted_at"]
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


@pytest.mark.asyncio
async def test_profile_upsert_ignores_extra_profile_columns() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/profiles"
        body = json.loads(request.content)
        return httpx.Response(200, json=[{**body, "created_at": NOW, "avatar_url": None, "bio": "", "kiln_sensor_plan": "three"}])

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.put(
            "/api/v1/me/profile", headers={"Authorization": "Bearer valid-token"}, json={"display_name": " 도예가 "}
        )
    assert response.status_code == 200, response.text
    data = response.json()
    assert set(data) == {"id", "display_name", "created_at"}
    assert data["display_name"] == "도예가"
    await upstream.aclose()


RECIPE_ID = UUID("33333333-3333-3333-3333-333333333333")
PARENT_ID = UUID("44444444-4444-4444-4444-444444444444")
OTHER_USER = "55555555-5555-5555-5555-555555555555"


def recipe_row(recipe_id: UUID, owner: str, **extra) -> dict:
    return {"id": str(recipe_id), "owner_id": owner, "forked_from_id": None, "name": "해안 사틴",
            "materials": {"장석": 40, "규석": 60}, "colorants": {}, "composition_key": "glaze-v1-abc",
            "is_public": True, "created_at": NOW, "updated_at": NOW, **extra}


@pytest.mark.asyncio
async def test_create_run_forwards_recipe_reference_to_rpc() -> None:
    payload = sample_aice_run().to_dict()
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/rest/v1/rpc/save_aice_run":
            values = json.loads(request.content)["p_values"]
            seen.update(values)
            return httpx.Response(200, json=[{
                "id": str(RECORD_ID), "title": values["title"], "payload": values["payload"], "schema_version": 3,
                "status": values["status"], "goal_gloss": values["goal_gloss"], "goal_transparency": values["goal_transparency"],
                "recipe_id": values["recipe_id"], "recipe_ref_id": str(RECIPE_ID), "ware_preset": values["ware_preset"],
                "is_public": False, "created_at": NOW, "updated_at": NOW, "feedback_status": "skipped",
            }])
        return httpx.Response(200, json=[])

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/v1/aice-runs", headers={"Authorization": "Bearer valid-token"},
                                     json={"title": "남의 레시피로", "run": payload, "recipe_ref_id": str(PARENT_ID)})
    assert response.status_code == 201, response.text
    assert seen["recipe_ref_id"] == str(PARENT_ID)
    assert response.json()["recipe_ref_id"] == str(RECIPE_ID)
    await upstream.aclose()


@pytest.mark.asyncio
async def test_publish_makes_the_owners_recipe_public() -> None:
    payload = sample_aice_run().to_dict()
    updates: list[tuple[str, dict, dict]] = []

    def run_row(is_public: bool) -> dict:
        return {"id": str(RECORD_ID), "title": "t", "payload": payload, "schema_version": 3, "status": payload["status"],
                "goal_gloss": "satin", "goal_transparency": "opaque", "recipe_id": payload["recipe"]["id"],
                "recipe_ref_id": str(RECIPE_ID), "ware_preset": "bowl", "is_public": is_public,
                "created_at": NOW, "updated_at": NOW}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "GET":
            if request.url.params.get("is_public") == "eq.true":
                return httpx.Response(200, json=[{"id": str(RECORD_ID)}])
            return httpx.Response(200, json=[run_row(False)])
        body = json.loads(request.content)
        if request.method == "PATCH":
            updates.append((path, body, dict(request.url.params)))
        if path == "/rest/v1/aice_runs":
            return httpx.Response(200, json=[run_row(True)])
        return httpx.Response(200, json=[body])

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(f"/api/v1/aice-runs/{RECORD_ID}/publish", headers={"Authorization": "Bearer valid-token"},
                                     json={"photo_rights_confirmed": True, "pii_reviewed": True, "location_removed": True, "withdrawal_understood": True})
    assert response.status_code == 200, response.text
    recipe_updates = [u for u in updates if u[0] == "/rest/v1/recipes"]
    assert recipe_updates == [("/rest/v1/recipes", {"is_public": True}, {"id": f"eq.{RECIPE_ID}", "owner_id": f"eq.{USER_ID}"})]
    await upstream.aclose()


@pytest.mark.asyncio
async def test_get_recipe_hides_owner_and_shows_fork_parent() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/recipes"
        if request.url.params["id"] == f"eq.{RECIPE_ID}":
            return httpx.Response(200, json=[recipe_row(RECIPE_ID, str(USER_ID), forked_from_id=str(PARENT_ID))])
        return httpx.Response(200, json=[{"id": str(PARENT_ID), "name": "원본 레시피"}])

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(f"/api/v1/recipes/{RECIPE_ID}", headers={"Authorization": "Bearer valid-token"})
    data = response.json()
    assert response.status_code == 200, response.text
    assert "owner_id" not in data and data["is_mine"] is True
    assert data["forked_from"] == {"id": str(PARENT_ID), "name": "원본 레시피"}
    await upstream.aclose()


@pytest.mark.asyncio
async def test_someone_elses_public_recipe_is_not_mine() -> None:
    app, upstream = client_for(lambda r: httpx.Response(200, json=[recipe_row(RECIPE_ID, OTHER_USER)]))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get(f"/api/v1/recipes/{RECIPE_ID}", headers={"Authorization": "Bearer valid-token"})
    assert response.json()["is_mine"] is False
    await upstream.aclose()


@pytest.mark.asyncio
async def test_aice_run_update_changes_only_title_memo_and_result() -> None:
    payload = sample_aice_run().to_dict()

    def row(run: dict, title: str = "AICE sample") -> dict:
        return {"id": str(RECORD_ID), "user_id": str(USER_ID), "title": title, "payload": run,
                "schema_version": 3, "status": run["status"], "goal_gloss": run["goal"]["gloss"],
                "goal_transparency": run["goal"]["transparency"], "recipe_id": run["recipe"]["id"],
                "ware_preset": run["ware"]["preset"], "is_public": False, "created_at": NOW, "updated_at": NOW}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json=[row(payload)])
        body = json.loads(request.content)
        assert request.method == "PATCH" and request.url.path == "/rest/v1/aice_runs"
        return httpx.Response(200, json=[row(body["payload"], body["title"])])

    app, upstream = client_for(handler)
    headers = {"Authorization": "Bearer valid-token"}
    result = {**payload["result"], "color": "lighter", "gloss": "matte"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.patch(f"/api/v1/aice-runs/{RECORD_ID}", headers=headers, json={"title": "  새 제목  ", "memo": "다음엔 얇게", "result": result})
        blank = await client.patch(f"/api/v1/aice-runs/{RECORD_ID}", headers=headers, json={"title": "   "})
    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "새 제목"
    assert body["run"]["memo"] == "다음엔 얇게"
    assert body["run"]["result"]["color"] == "lighter"
    assert body["run"]["recipe"]["materials"] == payload["recipe"]["materials"]
    assert blank.status_code == 422
    await upstream.aclose()


def _evaluated_payload(gloss: str) -> dict:
    payload = sample_aice_run().to_dict()
    payload["status"] = "evaluated"
    payload["result"] = {**payload["result"], "match": "close", "color": "close", "gloss": gloss, "texture": "smooth",
                         "transparency": "opaque", "defects": [], "defects_reviewed": True}
    return payload


@pytest.mark.asyncio
async def test_editing_a_run_rebuilds_the_recipe_calibration_from_remaining_runs() -> None:
    run_a = _evaluated_payload("satin")  # 처음에는 목표와 같은 광택 — 편향 0
    run_b = _evaluated_payload("matte")  # 목표보다 한 단계 무광 — 오차 -1
    stored = {"a": run_a, "b": run_b}
    ids = {"a": RECORD_ID, "b": UUID("33333333-3333-3333-3333-333333333333")}
    # 이전 수정 전 학습값: 낡은 firing 키와, 기록에서 파생되지 않는 k1.
    coefficients = {"k1": 1.5, "firing": {"recipe_id": "x", "gloss_bias_level": 9.0, "calibration_runs": 5, "provenance_notes": []}}
    commits: list[dict] = []

    def row(key: str) -> dict:
        run = stored[key]
        return {"id": str(ids[key]), "user_id": str(USER_ID), "title": "t", "payload": run, "schema_version": 3,
                "status": "evaluated", "goal_gloss": "satin", "goal_transparency": "opaque", "recipe_id": run["recipe"]["id"],
                "ware_preset": "bowl", "is_public": False, "created_at": NOW, "updated_at": NOW, "feedback_status": "applied"}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/rest/v1/personal_calibrations":
            return httpx.Response(200, json=[{"coefficients": coefficients}])
        if path == "/rest/v1/rpc/commit_aice_feedback":
            commits.append(json.loads(request.content))
            return httpx.Response(200, json=[{"applied": True}])
        if path == "/rest/v1/aice_runs" and request.method == "PATCH":
            body = json.loads(request.content)
            stored["a"] = body["payload"]
            return httpx.Response(200, json=[row("a")])
        if path == "/rest/v1/aice_runs":
            if "id" in request.url.params:
                return httpx.Response(200, json=[row("a")])
            return httpx.Response(200, json=[row("a"), row("b")])
        return httpx.Response(200, json=[])

    app, upstream = client_for(handler)
    headers = {"Authorization": "Bearer valid-token"}
    edited = {**run_a["result"], "gloss": "gloss"}  # 목표보다 두 단계 유광으로 정정 — 오차 +2
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.patch(f"/api/v1/aice-runs/{RECORD_ID}", headers=headers, json={"result": edited})
    assert response.status_code == 200
    assert len(commits) == 1
    commit = commits[0]
    assert commit["p_run_id"] is None and commit["p_expected"] == coefficients
    rebuilt = commit["p_coefficients"]
    assert rebuilt["k1"] == 1.5  # 기록에서 파생되지 않는 계수는 그대로
    firing = rebuilt["firing"]
    assert firing["calibration_runs"] == 2  # 낡은 5회가 아니라 남은 기록 2건에서 다시 만든다
    assert firing["gloss_bias_level"] == pytest.approx(0.5)  # (+2 → 평균 (2·1 + -1)/2)
    await upstream.aclose()


@pytest.mark.asyncio
async def test_deleting_a_run_removes_its_contribution_from_the_recipe_calibration() -> None:
    run_b = _evaluated_payload("matte")  # 삭제 후 남는 유일한 기록 — 오차 -1
    coefficients = {"k1": 1.5, "firing": {"recipe_id": "x", "gloss_bias_level": 0.5, "calibration_runs": 2, "provenance_notes": []}}
    commits: list[dict] = []
    deleted = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal deleted
        path = request.url.path
        if path == "/rest/v1/personal_calibrations":
            return httpx.Response(200, json=[{"coefficients": coefficients}])
        if path == "/rest/v1/rpc/commit_aice_feedback":
            commits.append(json.loads(request.content))
            return httpx.Response(200, json=[{"applied": True}])
        if path == "/rest/v1/aice_runs" and request.method == "DELETE":
            deleted = True
            return httpx.Response(200, json=[{"id": str(RECORD_ID), "recipe_id": run_b["recipe"]["id"]}])
        if path == "/rest/v1/aice_runs":
            assert deleted  # 재계산은 삭제가 끝난 뒤에 남은 기록으로 한다
            return httpx.Response(200, json=[{"id": str(RECORD_ID), "user_id": str(USER_ID), "title": "t", "payload": run_b, "schema_version": 3,
                                              "status": "evaluated", "goal_gloss": "satin", "goal_transparency": "opaque", "recipe_id": run_b["recipe"]["id"],
                                              "ware_preset": "bowl", "is_public": False, "created_at": NOW, "updated_at": NOW, "feedback_status": "applied"}])
        return httpx.Response(200, json=[])

    app, upstream = client_for(handler)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.delete(f"/api/v1/aice-runs/{RECORD_ID}", headers={"Authorization": "Bearer valid-token"})
    assert response.status_code == 204
    firing = commits[0]["p_coefficients"]["firing"]
    assert firing["calibration_runs"] == 1 and firing["gloss_bias_level"] == pytest.approx(-1.0)
    await upstream.aclose()



@pytest.mark.asyncio
async def test_feed_post_create_list_update_delete_are_owner_scoped() -> None:
    post_id = "11111111-1111-4111-8111-111111111111"
    stored = {"id": post_id, "kind": "work", "payload": {"glazeName": "해안 사틴", "memo": "m"}, "created_at": NOW, "updated_at": NOW}

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/rest/v1/feed_posts"
        if request.method == "POST":
            assert json.loads(request.content)["user_id"] == str(USER_ID)
            return httpx.Response(201, json=[stored])
        assert request.url.params["user_id"] == f"eq.{USER_ID}"
        if request.method == "PATCH":
            assert request.url.params["id"] == f"eq.{post_id}"
            return httpx.Response(200, json=[{**stored, "payload": json.loads(request.content)["payload"]}])
        if request.method == "DELETE":
            return httpx.Response(200, json=[stored])
        return httpx.Response(200, json=[stored])

    app, upstream = client_for(handler)
    headers = {"Authorization": "Bearer valid-token"}
    body = {"kind": "work", "payload": {"glazeName": "해안 사틴", "memo": "m"}}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        created = await client.post("/api/v1/feed-posts", headers=headers, json=body)
        listed = await client.get("/api/v1/feed-posts", headers=headers)
        edited = await client.put(f"/api/v1/feed-posts/{post_id}", headers=headers, json={**body, "payload": {"glazeName": "고침"}})
        removed = await client.delete(f"/api/v1/feed-posts/{post_id}", headers=headers)
        invalid = await client.post("/api/v1/feed-posts", headers=headers, json={"kind": "work", "payload": {}})
    assert created.status_code == 201 and created.json()["id"] == post_id
    assert listed.json()["items"][0]["payload"]["glazeName"] == "해안 사틴"
    assert edited.json()["payload"]["glazeName"] == "고침"
    assert removed.status_code == 204
    assert invalid.status_code == 422
    await upstream.aclose()
