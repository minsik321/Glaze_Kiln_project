"""Supabase pgvector search for AICE reference and personal recipe documents.

Embeddings are produced locally with fastembed. Supabase stores the vectors,
enforces owner access through RLS, and performs cosine similarity search.
"""

from __future__ import annotations

import asyncio
import math
import threading
from dataclasses import dataclass, field
from typing import Any, Callable, Sequence
from uuid import UUID

from .supabase import SupabaseError, SupabaseGateway

VECTOR_SIZE = 384
DEFAULT_EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
EmbedFn = Callable[[Sequence[str]], list[list[float]]]

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


def _default_embed_fn() -> EmbedFn:
    try:
        from fastembed import TextEmbedding
    except ImportError as exc:
        raise VectorStoreUnavailable("fastembed가 설치되지 않았습니다.") from exc
    model = TextEmbedding(model_name=DEFAULT_EMBEDDING_MODEL)

    def embed(texts: Sequence[str]) -> list[list[float]]:
        return [vector.tolist() for vector in model.embed(list(texts))]

    return embed


class AiceVectorStore:
    def __init__(self, gateway: SupabaseGateway, *, embed_fn: EmbedFn | None = None) -> None:
        self.gateway = gateway
        self._embed_fn = embed_fn
        self._lazy_embed_fn: EmbedFn | None = None
        self._embed_init_lock = threading.Lock()

    def _embed(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        try:
            if self._embed_fn is None and self._lazy_embed_fn is None:
                with self._embed_init_lock:
                    if self._lazy_embed_fn is None:
                        self._lazy_embed_fn = _default_embed_fn()
            vectors = (self._embed_fn or self._lazy_embed_fn)(texts)  # type: ignore[operator]
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
        vectors = await asyncio.to_thread(self._embed, [doc.text for doc in docs])
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
            [vector] = await asyncio.to_thread(self._embed, [query_text])
            rows = await self.gateway.rpc("match_aice_vector_documents", token, {
                "query_embedding": vector,
                "match_count": limit,
                "match_source_types": list(source_types) if source_types else None,
                "match_user_id": user_id,
            })
        except (SupabaseError, VectorStoreUnavailable):
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


def format_retrieved_context(documents: Sequence[RetrievedDocument]) -> str:
    if not documents:
        return ""
    return "\n".join(f"- ({doc.source_type}) {doc.text}" for doc in documents)
