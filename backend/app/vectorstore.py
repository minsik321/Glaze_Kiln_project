"""Supabase pgvector search for AICE reference and personal recipe documents.

Embeddings are computed through the aimlapi.com ``/embeddings`` endpoint
(``AimlapiClient.embed``). Supabase stores the vectors,
enforces owner access through RLS, and performs cosine similarity search.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Sequence
from uuid import UUID

from .supabase import SupabaseError, SupabaseGateway

logger = logging.getLogger(__name__)

#: text-embedding-3-small의 출력 차원. DB의 vector(1536) 컬럼과 같아야 한다.
VECTOR_SIZE = 1536
EmbedFn = Callable[[list[str]], Awaitable[list[list[float]]]]

SOURCE_MATERIAL_CHEMISTRY = "material_chemistry"
SOURCE_CORRELATION_NOTE = "correlation_note"
SOURCE_PERSONAL_RECIPE = "personal_recipe"
SOURCE_COLORANT_REFERENCE = "colorant_reference"


class VectorStoreUnavailable(Exception):
    """Indexing failed; saved runs remain valid in Supabase."""


@dataclass(frozen=True, slots=True)
class VectorDocument:
    doc_id: str
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RetrievedDocument:
    text: str
    source_type: str
    score: float
    metadata: dict[str, Any]


class AiceVectorStore:
    def __init__(self, gateway: SupabaseGateway, *, embed_fn: EmbedFn) -> None:
        self.gateway = gateway
        self._embed_fn = embed_fn

    async def _embed(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        try:
            vectors = await self._embed_fn(list(texts))
            if len(vectors) != len(texts) or any(
                len(vector) != VECTOR_SIZE or not all(math.isfinite(value) for value in vector)
                for vector in vectors
            ):
                raise ValueError(f"임베딩은 문서당 {VECTOR_SIZE}개의 유한한 값이어야 합니다.")
            return vectors
        except VectorStoreUnavailable:
            raise
        except Exception as exc:
            raise VectorStoreUnavailable(f"임베딩 계산에 실패했습니다: {exc}") from exc

    async def upsert_documents(self, token: str, docs: Sequence[VectorDocument]) -> None:
        """Index owner-scoped runs. Reference corpus is seeded by SQL migration."""
        if not docs:
            return
        vectors = await self._embed([doc.text for doc in docs])
        rows = []
        for doc, vector in zip(docs, vectors):
            if doc.metadata.get("source_type") != SOURCE_PERSONAL_RECIPE or not doc.doc_id.startswith("run-"):
                raise VectorStoreUnavailable("개인 기록 외 참고 문서는 SQL 마이그레이션으로 색인해야 합니다.")
            try:
                run_id = str(UUID(doc.doc_id.removeprefix("run-")))
                user_id = str(UUID(str(doc.metadata["user_id"])))
            except (KeyError, ValueError) as exc:
                raise VectorStoreUnavailable("개인 기록 벡터의 소유자 또는 실행 ID가 올바르지 않습니다.") from exc
            rows.append({
                "doc_id": doc.doc_id,
                "user_id": user_id,
                "run_id": run_id,
                "source_type": SOURCE_PERSONAL_RECIPE,
                "content": doc.text,
                "metadata": {key: value for key, value in doc.metadata.items() if key not in {"user_id", "source_type"}},
                "embedding": vector,
            })
        try:
            await self.gateway.insert("aice_vector_documents", token, rows, upsert=True, conflict="doc_id")
        except SupabaseError as exc:
            raise VectorStoreUnavailable(f"Supabase 벡터 저장에 실패했습니다: {exc.message}") from exc

    async def search(
        self,
        token: str,
        query_text: str,
        *,
        limit: int = 4,
        source_types: tuple[str, ...] | None = None,
        user_id: str | None = None,
    ) -> list[RetrievedDocument]:
        try:
            [vector] = await self._embed([query_text])
            rows = await self.gateway.rpc("match_aice_vector_documents", token, {
                "query_embedding": vector,
                "match_count": limit,
                "match_source_types": list(source_types) if source_types else None,
                "match_user_id": user_id,
            })
        except (SupabaseError, VectorStoreUnavailable) as exc:
            # RAG는 있으면 더 좋은 계층이라 추천을 막지 않지만, 조용히 비면
            # 임베딩·RPC 실패를 알 수 없으므로 원인은 남긴다.
            logger.warning("RAG 검색 실패(빈 결과로 계속 진행): %s", exc)
            return []
        return [
            RetrievedDocument(
                text=str(row.get("content") or ""),
                source_type=str(row.get("source_type") or ""),
                score=float(row.get("similarity") or 0),
                metadata=dict(row.get("metadata") or {}),
            )
            for row in rows
        ]


def dedupe_retrieved(documents: Sequence[RetrievedDocument]) -> list[RetrievedDocument]:
    """같은 내용의 검색 결과를 하나로 줄인다(앞선 것, 즉 먼저 넣은 쪽을 남긴다).

    전역 문헌 검색과 개인 레시피 검색을 이어 붙이거나 같은 문서가 여러 번
    색인돼 있으면 같은 문장이 프롬프트에 중복돼 들어가 토큰을 낭비하고
    LLM이 그 내용에 쏠린다. 공백·대소문자 차이는 같은 내용으로 본다.
    """
    seen: set[str] = set()
    unique: list[RetrievedDocument] = []
    for doc in documents:
        key = " ".join(doc.text.lower().split())
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(doc)
    return unique


def format_retrieved_context(documents: Sequence[RetrievedDocument]) -> str:
    documents = dedupe_retrieved(documents)
    if not documents:
        return ""
    return "\n".join(f"- ({doc.source_type}) {doc.text}" for doc in documents)
