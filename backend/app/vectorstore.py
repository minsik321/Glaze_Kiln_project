"""RAG 벡터 저장소 — Docker Qdrant + 로컬 임베딩(fastembed) 래퍼.

사용자 요구사항(수정 사항 정리 3번): "실제 rag를 사용할 수 있도록 해줘.
데이터를 저장하면 벡터 db에 저장되는 방식이고 실제 그 데이터를 활용하며
그 외에도 원료 화학, 성분 상관관계, 과거 레시피 코퍼스 인덱싱도 다 rag로
가능하도록 해줘. Pc에 docker가 깔려 있으니 그걸 통해서 벡터 db 만들어서
연결" — 그리고 "db는 도커가 더 편한것 같은데 그렇게 적용해"(Supabase
pgvector가 아니라 Docker 기반 벡터 DB).

엔진 선택(Claude가 고름, 사용자 지시: "벡터 db 엔진은 너가 추천하는걸로"):
Qdrant.

  1. 공식 Docker 이미지 하나(``docker-compose.yml`` 참고)로 뜨고, 별도
     임베딩 서버·API 키가 필요 없다 — ``fastembed``가 로컬 ONNX 모델로
     임베딩을 계산한다(최초 1회만 모델을 내려받는다).
  2. 컬렉션이 "텍스트 + 메타데이터" 문서라 스키마 마이그레이션 없이
     원료 화학표·성분 상관관계 노트·과거 레시피를 한 컬렉션에 같이
     넣고 ``source_type`` 메타데이터로만 구분하면 된다.
  3. Supabase(PostgREST, publishable/anon 키만 있음)로 하려면 pgvector
     확장 활성화 + SQL 함수(``match_documents`` 같은 RPC) + 서비스
     롤 키가 추가로 필요하다(``backend/app/supabase.py``는 지금
     RPC 호출 자체가 없다) — Docker 하나로 끝나는 Qdrant보다 손이 더
     간다.

**복원력.** RAG는 "있으면 더 좋은" 계층이지 판단 주체가 아니다(루트
CLAUDE.md 부록 D와 같은 원칙 — RAG로 찾은 문서는 LLM 프롬프트의 참고
자료일 뿐, 배합 숫자를 대체하지 않는다). Qdrant가 꺼져 있거나
``qdrant-client``가 설치되지 않았거나 컬렉션이 비어 있어도 레시피 추천
자체는 막히지 않는다 — ``routes.py``의 ``_personal_search_history``가
``SupabaseError``를 삼키는 것과 같은 태도로, 이 모듈의 모든 공개 메서드는
실패 시 조용히 빈 결과를 반환하거나 무시 가능한 예외만 던진다(호출부가
쉽게 잡아 무시할 수 있도록 단일 예외 타입 ``VectorStoreUnavailable``로
통일한다).
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Sequence

logger = logging.getLogger(__name__)

#: 우리 문서 id(문자열, 예: "material-장석")를 Qdrant가 요구하는 정수/UUID
#: 포인트 id로 결정적으로 바꾸는 데 쓰는 고정 네임스페이스. 같은 문서 id는
#: 항상 같은 포인트 id로 바뀌므로, 재수집(re-ingest)이 새 포인트를 쌓지
#: 않고 있던 포인트를 갱신한다(idempotent upsert).
_ID_NAMESPACE = uuid.UUID("6f6e3c2e-6b1f-4b0a-9f2e-2a6f7b8c9d10")

#: fastembed 기본 임베딩 모델 — 다국어(한국어 포함) 지원 소형 모델.
#: 최초 사용 시 자동으로 내려받는다(별도 API 키·GPU 불필요).
DEFAULT_EMBEDDING_MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

try:  # pragma: no cover - import shape depends on optional dependency
    from qdrant_client import QdrantClient, models as qmodels
    _QDRANT_IMPORT_ERROR: Exception | None = None
except ImportError as exc:  # pragma: no cover - exercised only when dependency missing
    QdrantClient = None  # type: ignore[assignment,misc]
    qmodels = None  # type: ignore[assignment]
    _QDRANT_IMPORT_ERROR = exc

EmbedFn = Callable[[Sequence[str]], list[list[float]]]

#: RAG로 인덱싱하는 문서 종류. ``personal_recipe``만 ``user_id``로 더 좁혀
#: 진다(다른 사용자의 개인 레시피를 검색 결과로 섞지 않기 위함 — Supabase
#: RLS와 같은 경계를 벡터 DB 쪽에서도 지킨다).
SOURCE_MATERIAL_CHEMISTRY = "material_chemistry"
SOURCE_CORRELATION_NOTE = "correlation_note"
SOURCE_PERSONAL_RECIPE = "personal_recipe"
#: 착색 산화물 참고 색상표(kiln.chem.colorants, 4-4-a절) — 원료 화학과는
#: 별도 출처라 구분한다(문헌 참고값이라는 성격은 같지만, 색상·통상
#: 첨가량 표라는 다른 종류의 문서라 필터링 시 나눠 쓸 수 있게 한다).
SOURCE_COLORANT_REFERENCE = "colorant_reference"


class VectorStoreUnavailable(Exception):
    """Qdrant 연결 실패, 라이브러리 미설치, 컬렉션 없음 등 — RAG를 건너뛰라는 신호.

    호출부는 이 예외 하나만 잡으면 된다(``_personal_search_history``가
    ``SupabaseError``를 잡는 것과 같은 패턴). 절대 레시피 추천 자체를
    막는 데 쓰지 않는다.
    """


@dataclass(frozen=True, slots=True)
class VectorDocument:
    """인덱싱할 문서 하나. ``doc_id``는 사람이 읽을 수 있는 안정적인
    문자열(예: ``material-장석``, ``run-<uuid>``)이며, Qdrant 포인트 id로는
    이 값을 결정적으로 해싱한 UUID가 쓰인다(재수집 시 중복 생성 방지)."""

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
    """지연 로딩: 실제 fastembed 모델은 이 함수가 처음 호출될 때만 내려받는다.

    테스트나 오프라인 환경에서는 ``AiceVectorStore(embed_fn=...)``로 다른
    구현을 주입해 네트워크·모델 다운로드 없이 검증할 수 있다.
    """
    try:
        from fastembed import TextEmbedding
    except ImportError as exc:  # pragma: no cover - optional dependency
        raise VectorStoreUnavailable(
            "fastembed가 설치되지 않았습니다(pip install 'qdrant-client[fastembed]')."
        ) from exc
    model = TextEmbedding(model_name=DEFAULT_EMBEDDING_MODEL)

    def embed(texts: Sequence[str]) -> list[list[float]]:
        return [vector.tolist() for vector in model.embed(list(texts))]

    return embed


class AiceVectorStore:
    """Qdrant 컬렉션 하나에 대한 얇은 래퍼. 컬렉션은 문서 종류와 무관하게
    하나만 쓰고(``source_type`` 메타데이터로 구분), 벡터 크기는 첫 upsert
    시점의 임베딩 차원에서 자동으로 정한다.
    """

    def __init__(
        self,
        url: str,
        collection: str,
        *,
        client: "QdrantClient | None" = None,
        embed_fn: EmbedFn | None = None,
    ) -> None:
        if client is None:
            if QdrantClient is None:
                raise VectorStoreUnavailable(
                    "qdrant-client가 설치되지 않았습니다(pip install 'qdrant-client[fastembed]')."
                ) from _QDRANT_IMPORT_ERROR
            if not url:
                raise VectorStoreUnavailable("QDRANT_URL이 설정되지 않았습니다.")
            #: check_compatibility=False — 이 클래스의 모든 공개 메서드가 이미
            #: VectorStoreUnavailable로 실패를 명시적으로 처리하므로, 백그라운드
            #: 스레드로 서버 버전 호환성을 확인하고 콘솔에 UserWarning을 띄우는
            #: qdrant-client의 기본 동작은 불필요한 소음이다(특히 Qdrant가 아직
            #: 안 떠 있거나 네트워크 격리된 테스트 환경에서 매번 경고가 난다).
            client = QdrantClient(url=url, check_compatibility=False)
        self.client = client
        self.collection = collection
        self._embed_fn = embed_fn
        self._lazy_embed_fn: EmbedFn | None = None

    def _embed(self, texts: Sequence[str]) -> list[list[float]]:
        if not texts:
            return []
        try:
            if self._embed_fn is not None:
                return self._embed_fn(texts)
            if self._lazy_embed_fn is None:
                self._lazy_embed_fn = _default_embed_fn()
            return self._lazy_embed_fn(texts)
        except VectorStoreUnavailable:
            raise
        except Exception as exc:  # pragma: no cover - defensive: embedding backend errors
            raise VectorStoreUnavailable(f"임베딩 계산에 실패했습니다: {exc}") from exc

    def _point_id(self, doc_id: str) -> str:
        return str(uuid.uuid5(_ID_NAMESPACE, doc_id))

    def _ensure_collection(self, vector_size: int) -> None:
        try:
            exists = self.client.collection_exists(self.collection)
        except Exception as exc:
            raise VectorStoreUnavailable(f"Qdrant에 연결할 수 없습니다: {exc}") from exc
        if exists:
            return
        self.client.create_collection(
            collection_name=self.collection,
            vectors_config=qmodels.VectorParams(size=vector_size, distance=qmodels.Distance.COSINE),
        )

    def upsert_documents(self, docs: Sequence[VectorDocument]) -> None:
        """문서를 인덱싱(또는 갱신)한다. 실패 시 ``VectorStoreUnavailable``.

        호출부(``routes.py``의 회차 저장 경로, ``scripts/ingest_corpus.py``)는
        이걸 항상 best-effort로 취급해야 한다 — RAG 인덱싱 실패가 레시피
        저장 자체를 막으면 안 된다.
        """
        if not docs:
            return
        vectors = self._embed([doc.text for doc in docs])
        self._ensure_collection(len(vectors[0]))
        points = [
            qmodels.PointStruct(
                id=self._point_id(doc.doc_id),
                vector=vector,
                payload={"text": doc.text, **doc.metadata},
            )
            for doc, vector in zip(docs, vectors)
        ]
        try:
            self.client.upsert(collection_name=self.collection, points=points)
        except Exception as exc:
            raise VectorStoreUnavailable(f"Qdrant upsert에 실패했습니다: {exc}") from exc

    def search(
        self,
        query_text: str,
        *,
        limit: int = 4,
        source_types: tuple[str, ...] | None = None,
        user_id: str | None = None,
    ) -> list[RetrievedDocument]:
        """``query_text``와 가까운 문서 상위 ``limit``개.

        빈 컬렉션·연결 실패 등은 예외를 던지지 않고 빈 리스트를 반환한다
        (검색은 "있으면 좋은" 보강일 뿐이라 호출부에서 매번 try/except를
        쓰지 않아도 되게 한다 — upsert와는 다르게 실패를 숨겨도 안전하다:
        최악의 경우 컨텍스트 없이 프롬프트가 나갈 뿐이다).
        """
        try:
            if not self.client.collection_exists(self.collection):
                return []
            [vector] = self._embed([query_text])
        except VectorStoreUnavailable:
            return []
        except Exception:  # pragma: no cover - defensive
            return []
        conditions = []
        if source_types:
            conditions.append(
                qmodels.FieldCondition(key="source_type", match=qmodels.MatchAny(any=list(source_types)))
            )
        if user_id is not None:
            conditions.append(qmodels.FieldCondition(key="user_id", match=qmodels.MatchValue(value=user_id)))
        query_filter = qmodels.Filter(must=conditions) if conditions else None
        try:
            result = self.client.query_points(
                collection_name=self.collection,
                query=vector,
                limit=limit,
                query_filter=query_filter,
            )
        except Exception:  # pragma: no cover - defensive
            return []
        documents: list[RetrievedDocument] = []
        for point in result.points:
            payload = dict(point.payload or {})
            text = str(payload.pop("text", ""))
            source_type = str(payload.get("source_type", ""))
            documents.append(RetrievedDocument(text=text, source_type=source_type, score=point.score, metadata=payload))
        return documents


def format_retrieved_context(documents: Sequence[RetrievedDocument]) -> str:
    """검색 결과를 LLM 프롬프트에 그대로 붙일 수 있는 한국어 불릿 목록으로.

    빈 리스트면 빈 문자열 — 호출부가 "RAG 컨텍스트 없음"과 "빈 문자열"을
    똑같이 취급해 프롬프트에 아무것도 추가하지 않게 한다.
    """
    if not documents:
        return ""
    lines = [f"- ({doc.source_type}) {doc.text}" for doc in documents]
    return "\n".join(lines)
