from __future__ import annotations

from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from backend.app.supabase import SupabaseError
from backend.app.vectorstore import (
    AiceVectorStore,
    RetrievedDocument,
    SOURCE_PERSONAL_RECIPE,
    VECTOR_SIZE,
    VectorDocument,
    VectorStoreUnavailable,
    format_retrieved_context,
)

RUN_ID = UUID("22222222-2222-2222-2222-222222222222")
USER_ID = UUID("11111111-1111-1111-1111-111111111111")


def _embed(texts):
    return [[1.0] + [0.0] * (VECTOR_SIZE - 1) for _ in texts]


@pytest.mark.asyncio
async def test_upsert_personal_run_uses_owner_scoped_supabase_row() -> None:
    gateway = AsyncMock()
    gateway.insert.return_value = [{"doc_id": f"run-{RUN_ID}"}]
    store = AiceVectorStore(gateway, embed_fn=_embed)

    await store.upsert_documents("user-token", [VectorDocument(
        doc_id=f"run-{RUN_ID}", text="내 관찰 결과",
        metadata={"source_type": SOURCE_PERSONAL_RECIPE, "user_id": str(USER_ID), "recipe_id": "recipe-a"},
    )])

    args, kwargs = gateway.insert.await_args
    assert args[:2] == ("aice_vector_documents", "user-token")
    assert args[2][0]["run_id"] == str(RUN_ID)
    assert args[2][0]["user_id"] == str(USER_ID)
    assert args[2][0]["embedding"] == _embed(["내 관찰 결과"])[0]
    assert kwargs == {"upsert": True, "conflict": "doc_id"}


@pytest.mark.asyncio
async def test_search_passes_owner_and_source_filters_to_supabase_rpc() -> None:
    gateway = AsyncMock()
    gateway.rpc.return_value = [{
        "doc_id": f"run-{RUN_ID}", "content": "내 사틴 관찰",
        "source_type": SOURCE_PERSONAL_RECIPE, "metadata": {"recipe_id": "recipe-a"},
        "similarity": 0.91,
    }]
    store = AiceVectorStore(gateway, embed_fn=_embed)

    result = await store.search("user-token", "사틴", limit=3, source_types=(SOURCE_PERSONAL_RECIPE,), user_id=str(USER_ID))

    assert len(result) == 1
    assert result[0].text == "내 사틴 관찰"
    assert result[0].score == 0.91
    assert gateway.rpc.await_args.args[:2] == ("match_aice_vector_documents", "user-token")
    assert gateway.rpc.await_args.args[2] == {
        "query_embedding": _embed(["사틴"])[0], "match_count": 3,
        "match_source_types": [SOURCE_PERSONAL_RECIPE], "match_user_id": str(USER_ID),
    }


@pytest.mark.asyncio
async def test_search_returns_empty_when_supabase_vectors_are_unavailable() -> None:
    gateway = AsyncMock()
    gateway.rpc.side_effect = SupabaseError(404, "PGRST202", "function missing")
    store = AiceVectorStore(gateway, embed_fn=_embed)
    assert await store.search("token", "사틴") == []


@pytest.mark.asyncio
async def test_invalid_embedding_dimension_blocks_indexing() -> None:
    gateway = AsyncMock()
    store = AiceVectorStore(gateway, embed_fn=lambda texts: [[1.0] for _ in texts])
    with pytest.raises(VectorStoreUnavailable, match="384"):
        await store.upsert_documents("token", [VectorDocument(
            doc_id=f"run-{RUN_ID}", text="관찰",
            metadata={"source_type": SOURCE_PERSONAL_RECIPE, "user_id": str(USER_ID)},
        )])
    gateway.insert.assert_not_awaited()


def test_format_retrieved_context() -> None:
    assert format_retrieved_context([]) == ""
    text = format_retrieved_context([RetrievedDocument("규석은 실리카다.", "material_chemistry", .9, {})])
    assert "material_chemistry" in text and "규석은 실리카다." in text
