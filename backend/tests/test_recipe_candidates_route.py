from __future__ import annotations

import json
import base64
from datetime import datetime, timezone
from uuid import UUID

import httpx
import pytest

from backend.app.aimlapi import AimlapiClient, AimlapiSettings
from backend.app.config import Settings
from backend.app.main import create_app
from backend.app.supabase import SupabaseGateway
from backend.app.vectorstore import AiceVectorStore, SOURCE_MATERIAL_CHEMISTRY, VectorDocument
from kiln.aice import sample_aice_run

USER_ID = UUID("11111111-1111-1111-1111-111111111111")
RUN_ID = UUID("33333333-3333-3333-3333-333333333333")
NOW = datetime(2026, 9, 17, tzinfo=timezone.utc).isoformat()


def _fake_embed(texts):
    """curvePlan/predictionModel 테스트와 같은 태도: 실제 임베딩 의미가
    아니라 AiceVectorStore 배선(주입 → 검색에 쓰임)만 검증하면 되므로,
    fastembed 모델 다운로드(네트워크 필요) 없이 결정적 가짜로 대체한다."""
    vectors = []
    for text in texts:
        vec = [0.0] * 16
        for ch in text:
            vec[ord(ch) % 16] += 1.0
        norm = sum(v * v for v in vec) ** 0.5 or 1.0
        vectors.append([v / norm for v in vec])
    return vectors


def _memory_vectorstore() -> AiceVectorStore:
    from qdrant_client import QdrantClient

    return AiceVectorStore(url="", collection="aice-route-test", client=QdrantClient(":memory:"), embed_fn=_fake_embed)


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


def _app_with_llm(llm_handler, aice_runs: list[dict] | None = None, vectorstore: AiceVectorStore | None = None):
    def supabase_handler(request: httpx.Request) -> httpx.Response:
        response = _auth_response(request)
        if response is not None:
            return response
        if request.url.path == "/rest/v1/aice_runs" and request.method == "GET":
            return httpx.Response(200, json=aice_runs or [])
        if request.url.path == "/rest/v1/rpc/save_aice_run" and request.method == "POST":
            body = json.loads(request.content)
            values = body["p_values"]
            feedback_status = "pending" if values["status"] == "evaluated" else "skipped"
            return httpx.Response(201, json=[{
                "id": str(RUN_ID), **values, "request_id": body["p_request_id"],
                "feedback_status": feedback_status, "created_at": NOW, "updated_at": NOW,
            }])
        return httpx.Response(500)

    auth_upstream = httpx.AsyncClient(transport=httpx.MockTransport(supabase_handler))
    gateway = SupabaseGateway(make_settings(), client=auth_upstream)
    llm_upstream = httpx.AsyncClient(transport=httpx.MockTransport(llm_handler))
    llm = AimlapiClient(
        AimlapiSettings(
            api_key="test-key", text_model="test/text-model", image_model="test/image-model"
        ),
        client=llm_upstream,
    )
    return create_app(make_settings(), gateway, llm, vectorstore), auth_upstream, llm_upstream


def _aice_run_row(
    *, materials: dict, defects: list[str], gloss="satin", transparency="opaque",
    result_gloss="satin", result_transparency="opaque",
):
    """`result_gloss`/`result_transparency`는 사용자가 **실제로 관찰해
    기록한** 값이다 — `_personal_search_history`가 조성 되먹임에 쓰는 건
    이 실측 결과이지 `goal_gloss`/`goal_transparency`(그 회차가 노렸던
    목표)가 아니다. 기본값은 목표와 같게 둬 "목표를 그대로 달성한 회차"를
    나타내고, 목표를 빗나간 회차를 표현하려면 `result_gloss`/
    `result_transparency`를 다르게 준다."""
    return {
        "status": "evaluated",
        "goal_gloss": gloss,
        "goal_transparency": transparency,
        "payload": {
            "recipe": {"materials": materials},
            "result": {
                "defects": defects,
                "gloss": result_gloss,
                "transparency": result_transparency,
                "defects_reviewed": True,
            },
        },
    }


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
    # v9 후속: 1차 호출(목표 분류)이 낸 좌표가 후보에 실려 나가야 화면 1의
    # "예상 이미지 생성" 버튼이 그 목표를 이미지 프롬프트에 넘길 수 있다.
    assert body["candidates"][0]["target_gloss"] == "SATIN"
    assert body["candidates"][0]["target_transparency"] == "OPAQUE"
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


@pytest.mark.asyncio
async def test_generate_recipe_candidate_image_includes_texture_instruction() -> None:
    """매트 목표인데 이미지 프롬프트에 무광 지시가 없으면 유광 이미지가 나올
    수 있다는 실제 버그 보고를 막는 회귀 테스트."""
    raw = b"\x89PNG\r\n\x1a\nfake-png-bytes"
    captured: dict[str, str] = {}

    def llm_handler(request: httpx.Request) -> httpx.Response:
        request_body = json.loads(request.content)
        captured["prompt"] = request_body["prompt"]
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
                "candidate_name": "무광 화이트",
                "materials": {"장석": 40.0, "석회석": 20.0, "규석": 25.0, "카올린": 15.0},
                "target_gloss": "MATTE",
                "target_transparency": "OPAQUE",
            },
            headers={"Authorization": "Bearer valid-token"},
        )
    assert response.status_code == 200, response.text
    assert "무광" in captured["prompt"]
    assert "불투명" in captured["prompt"]
    await auth_upstream.aclose()
    await llm_upstream.aclose()


@pytest.mark.asyncio
async def test_suggest_recipe_candidates_uses_personal_history_and_ignores_outliers() -> None:
    """조성 추천 피드백 루프: 과거 "평가 완료" 회차의 배합이 다음 추천의
    중심이 되고, 결함이 기록된 회차(이상치)는 그 후보로 쓰이지 않는다."""
    clean_materials = {"규석": 40.0, "장석": 30.0, "석회석": 15.5, "카올린": 12.5, "벤토나이트": 2.0}
    outlier_materials = {"규석": 10.0, "장석": 60.0, "석회석": 15.5, "카올린": 12.5, "벤토나이트": 2.0}
    aice_runs = [
        _aice_run_row(materials=clean_materials, defects=[], gloss="satin", transparency="opaque"),
        _aice_run_row(materials=outlier_materials, defects=["running"], gloss="satin", transparency="opaque"),
    ]

    description_json = {
        "candidates": [
            {"id": f"cand-{i+1}", "name": f"후보 {i+1}"} for i in range(6)
        ]
    }
    app, auth_upstream, llm_upstream = _app_with_llm(
        _two_stage_handler(description_json), aice_runs=aice_runs
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/aice/recipe-candidates",
            json={"prompt_text": "사발에 어울리는 청록색 사틴 유약", "candidate_count": 6},
            headers={"Authorization": "Bearer valid-token"},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    returned_materials = [candidate["materials"] for candidate in body["candidates"]]

    # 깨끗한 과거 회차의 배합이 세분(refine) 중심으로 그대로 후보에 포함된다.
    assert clean_materials in returned_materials
    # 결함이 있던 회차의 배합은 긍정 신호로 쓰이지 않았으므로 그 정확한
    # 배합이 그대로 후보에 나타나지 않는다(우연히 refine 이동으로 같은 값이
    # 나올 수는 있지만, 이 조합에서는 그렇지 않다).
    assert outlier_materials not in returned_materials
    await auth_upstream.aclose()
    await llm_upstream.aclose()


@pytest.mark.asyncio
async def test_suggest_recipe_candidates_includes_rag_context_from_material_chemistry() -> None:
    """수정 사항 정리 3번: RAG로 찾은 원료 화학 문서가 2차 LLM 호출(서술
    요청) 프롬프트에 참고 자료로 실려 나가야 한다 — "실제 rag를 사용"."""
    store = _memory_vectorstore()
    store.upsert_documents([
        VectorDocument(
            doc_id="material-규석",
            text="규석은 순수 실리카(SiO2 100%)이며 알루미나 공급이 없다.",
            metadata={"source_type": SOURCE_MATERIAL_CHEMISTRY, "name": "규석"},
        )
    ])

    description_json = {"candidates": [{"id": "cand-1", "name": "후보 1"}]}
    captured: dict[str, str] = {}

    def llm_handler(request: httpx.Request) -> httpx.Response:
        request_body = json.loads(request.content)
        system = request_body["messages"][0]["content"]
        if "target_gloss" in system:
            payload = {"target_gloss": "SATIN", "target_transparency": "OPAQUE"}
        else:
            captured["system"] = system
            payload = description_json
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(payload)}}]})

    app, auth_upstream, llm_upstream = _app_with_llm(llm_handler, vectorstore=store)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/aice/recipe-candidates",
            json={"prompt_text": "규석 위주 배합을 알려줘", "candidate_count": 1},
            headers={"Authorization": "Bearer valid-token"},
        )
    assert response.status_code == 200, response.text
    assert "참고 자료" in captured["system"]
    assert "규석은 순수 실리카" in captured["system"]
    await auth_upstream.aclose()
    await llm_upstream.aclose()


@pytest.mark.asyncio
async def test_suggest_recipe_candidates_without_vectorstore_has_no_rag_block() -> None:
    """Qdrant가 설정되지 않은 기본 상태(vectorstore=None)에서는 기존과
    동일하게 참고 자료 블록이 전혀 붙지 않는다 — 하위호환 회귀 테스트."""
    description_json = {"candidates": [{"id": "cand-1", "name": "후보 1"}]}
    captured: dict[str, str] = {}

    def llm_handler(request: httpx.Request) -> httpx.Response:
        request_body = json.loads(request.content)
        system = request_body["messages"][0]["content"]
        if "target_gloss" in system:
            payload = {"target_gloss": "SATIN", "target_transparency": "OPAQUE"}
        else:
            captured["system"] = system
            payload = description_json
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(payload)}}]})

    app, auth_upstream, llm_upstream = _app_with_llm(llm_handler)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/aice/recipe-candidates",
            json={"prompt_text": "규석 위주 배합을 알려줘", "candidate_count": 1},
            headers={"Authorization": "Bearer valid-token"},
        )
    assert response.status_code == 200, response.text
    assert "참고 자료" not in captured["system"]
    await auth_upstream.aclose()
    await llm_upstream.aclose()


@pytest.mark.asyncio
async def test_create_aice_run_indexes_evaluated_run_into_personal_rag_corpus() -> None:
    """수정 사항 정리 3번: "데이터를 저장하면 벡터 db에 저장되는 방식" —
    평가 완료(evaluated) 회차를 저장하면 그 사용자의 개인 레시피 RAG
    코퍼스에 자동으로 색인되어야 한다."""
    store = _memory_vectorstore()
    payload = sample_aice_run().to_dict()
    payload["status"] = "evaluated"
    payload["result"]["gloss"] = "satin"
    payload["result"]["transparency"] = "opaque"
    payload["result"]["defects_reviewed"] = True
    payload["result"]["match"] = "close"

    app, auth_upstream, llm_upstream = _app_with_llm(lambda _: httpx.Response(500), vectorstore=store)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/aice-runs",
            headers={"Authorization": "Bearer valid-token"},
            json={"title": "RAG 색인 테스트", "run": payload},
        )
    assert response.status_code == 201, response.text

    from backend.app.vectorstore import SOURCE_PERSONAL_RECIPE

    results = store.search(
        "해안 사틴", limit=5, source_types=(SOURCE_PERSONAL_RECIPE,), user_id=str(USER_ID)
    )
    assert len(results) == 1
    assert "장석 40.0%" in results[0].text
    assert results[0].metadata["user_id"] == str(USER_ID)
    await auth_upstream.aclose()
    await llm_upstream.aclose()


@pytest.mark.asyncio
async def test_create_aice_run_does_not_index_draft_or_outlier_runs() -> None:
    """draft 상태(아직 결과 없음)나 결함이 기록된(이상치) 회차는 RAG
    코퍼스에 색인되지 않아야 한다 — _personal_search_history와 같은 기준."""
    store = _memory_vectorstore()

    draft_payload = sample_aice_run().to_dict()  # 기본 status는 "simulated"
    app, auth_upstream, llm_upstream = _app_with_llm(lambda _: httpx.Response(500), vectorstore=store)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/api/v1/aice-runs",
            headers={"Authorization": "Bearer valid-token"},
            json={"title": "초안", "run": draft_payload},
        )
    assert response.status_code == 201, response.text
    assert store.search("사틴", limit=5) == []
    await auth_upstream.aclose()
    await llm_upstream.aclose()
