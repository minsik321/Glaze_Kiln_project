"""backend/app/vectorstore.py 테스트 — 실제 Qdrant 임베디드 모드(``:memory:``)로
검증한다(모킹이 아니다). ``qdrant-client``는 순수 파이썬 인메모리 백엔드를
지원하므로 Docker나 네트워크 없이도 진짜 컬렉션 생성·upsert·검색 경로를
그대로 돌릴 수 있다. 임베딩만 결정적인 가짜 함수로 주입해 fastembed 모델
다운로드(네트워크 필요)를 피한다 — 벡터 계산 자체의 품질이 아니라
``AiceVectorStore``의 upsert/검색/필터/복원력 로직을 검증하는 것이 목적이다.
"""

from __future__ import annotations

import pytest

qdrant_client = pytest.importorskip("qdrant_client")

from qdrant_client import QdrantClient  # noqa: E402

from backend.app.vectorstore import (  # noqa: E402
    AiceVectorStore,
    RetrievedDocument,
    SOURCE_CORRELATION_NOTE,
    SOURCE_MATERIAL_CHEMISTRY,
    SOURCE_PERSONAL_RECIPE,
    VectorDocument,
    VectorStoreUnavailable,
    format_retrieved_context,
)


def _fake_embed(texts):
    """문자 히스토그램 기반의 결정적 "임베딩" — 실제 의미 유사도는 아니지만
    같은 글자를 공유하는 문장끼리 코사인 유사도가 높아지므로, 필터링·정렬·
    upsert idempotency 같은 래퍼 로직을 검증하는 데는 충분하다."""
    vectors = []
    for text in texts:
        vec = [0.0] * 16
        for ch in text:
            vec[ord(ch) % 16] += 1.0
        norm = sum(v * v for v in vec) ** 0.5 or 1.0
        vectors.append([v / norm for v in vec])
    return vectors


@pytest.fixture
def store():
    client = QdrantClient(":memory:")
    return AiceVectorStore(url="", collection="aice-test", client=client, embed_fn=_fake_embed)


def test_upsert_then_search_finds_relevant_document(store):
    store.upsert_documents([
        VectorDocument(doc_id="material-규석", text="규석은 순수 실리카 SiO2 100%다.", metadata={"source_type": SOURCE_MATERIAL_CHEMISTRY, "name": "규석"}),
        VectorDocument(doc_id="material-장석", text="장석은 K2O Al2O3 SiO2를 공급한다.", metadata={"source_type": SOURCE_MATERIAL_CHEMISTRY, "name": "장석"}),
        VectorDocument(doc_id="corr-matte", text="무광 유약은 결정화나 미분리로 빛 산란이 커진다.", metadata={"source_type": SOURCE_CORRELATION_NOTE}),
    ])

    results = store.search("실리카 원료 조성", limit=2)

    assert len(results) == 2
    assert all(isinstance(r, RetrievedDocument) for r in results)
    # 가장 가까운 문서는 "실리카"라는 글자를 그대로 포함한 규석 항목이어야 한다.
    assert any("규석" in r.text for r in results)


def test_search_can_filter_by_source_type(store):
    store.upsert_documents([
        VectorDocument(doc_id="material-규석", text="규석은 순수 실리카 SiO2 100%다.", metadata={"source_type": SOURCE_MATERIAL_CHEMISTRY}),
        VectorDocument(doc_id="run-1", text="사용자가 과거에 만든 규석 위주 레시피 회차.", metadata={"source_type": SOURCE_PERSONAL_RECIPE, "user_id": "user-a"}),
    ])

    material_only = store.search("규석", limit=5, source_types=(SOURCE_MATERIAL_CHEMISTRY,))

    assert len(material_only) == 1
    assert material_only[0].source_type == SOURCE_MATERIAL_CHEMISTRY


def test_search_scopes_personal_recipes_by_user_id(store):
    store.upsert_documents([
        VectorDocument(doc_id="run-a", text="사용자 A의 사틴 레시피 회차.", metadata={"source_type": SOURCE_PERSONAL_RECIPE, "user_id": "user-a"}),
        VectorDocument(doc_id="run-b", text="사용자 B의 사틴 레시피 회차.", metadata={"source_type": SOURCE_PERSONAL_RECIPE, "user_id": "user-b"}),
    ])

    only_a = store.search("사틴 레시피", limit=5, source_types=(SOURCE_PERSONAL_RECIPE,), user_id="user-a")

    assert len(only_a) == 1
    assert only_a[0].metadata["user_id"] == "user-a"


def test_reingesting_same_doc_id_updates_instead_of_duplicating(store):
    store.upsert_documents([VectorDocument(doc_id="material-규석", text="규석은 순수 실리카다.", metadata={"source_type": SOURCE_MATERIAL_CHEMISTRY})])
    store.upsert_documents([VectorDocument(doc_id="material-규석", text="규석은 SiO2 100%인 원료다(갱신됨).", metadata={"source_type": SOURCE_MATERIAL_CHEMISTRY})])

    count = store.client.count(collection_name="aice-test")
    results = store.search("규석", limit=10)

    assert count.count == 1
    assert len(results) == 1
    assert "갱신됨" in results[0].text


def test_search_on_missing_collection_returns_empty_list_not_error(store):
    # upsert를 한 번도 하지 않았으므로 컬렉션이 아직 없다 — 예외 대신 빈 리스트.
    assert store.search("아무 질의") == []


def test_search_swallows_embed_failures_and_returns_empty_list():
    def broken_embed(_texts):
        raise RuntimeError("네트워크 오류 시뮬레이션")

    client = QdrantClient(":memory:")
    store = AiceVectorStore(url="", collection="aice-test", client=client, embed_fn=_fake_embed)
    store.upsert_documents([VectorDocument(doc_id="a", text="원료", metadata={"source_type": SOURCE_MATERIAL_CHEMISTRY})])

    broken_store = AiceVectorStore(url="", collection="aice-test", client=client, embed_fn=broken_embed)
    assert broken_store.search("원료") == []


def test_upsert_failure_raises_vector_store_unavailable_not_a_raw_exception():
    class BoomClient:
        def collection_exists(self, *_args, **_kwargs):
            raise RuntimeError("connection refused")

    store = AiceVectorStore(url="", collection="aice-test", client=BoomClient(), embed_fn=_fake_embed)

    with pytest.raises(VectorStoreUnavailable):
        store.upsert_documents([VectorDocument(doc_id="a", text="원료", metadata={})])


def test_format_retrieved_context_is_empty_string_for_no_results():
    assert format_retrieved_context([]) == ""


def test_format_retrieved_context_lists_source_type_and_text():
    docs = [RetrievedDocument(text="규석은 실리카다.", source_type=SOURCE_MATERIAL_CHEMISTRY, score=0.9, metadata={})]
    formatted = format_retrieved_context(docs)
    assert "material_chemistry" in formatted
    assert "규석은 실리카다." in formatted


def test_missing_qdrant_client_library_raises_vector_store_unavailable(monkeypatch):
    import backend.app.vectorstore as vectorstore_module

    monkeypatch.setattr(vectorstore_module, "QdrantClient", None)
    with pytest.raises(VectorStoreUnavailable):
        AiceVectorStore(url="http://localhost:6333", collection="aice-test")
