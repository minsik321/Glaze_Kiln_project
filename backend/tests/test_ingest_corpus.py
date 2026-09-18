"""backend/scripts/ingest_corpus.py 테스트 — 코퍼스가 코드 안 실제 값과
빠짐없이 1:1로 대응하는지 확인한다(새 수치를 지어내지 않는다는 약속의
검증판). Qdrant·네트워크는 필요 없다 — 문서 빌더 함수만 부른다."""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT_DIR = Path(__file__).resolve().parents[2]
for _path in (_ROOT_DIR, _ROOT_DIR / "src"):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

from kiln.chem.colorants import COLORANTS  # noqa: E402
from kiln.chem.materials import MATERIALS  # noqa: E402
from kiln.chem.stull import StullZone  # noqa: E402

from backend.scripts.ingest_corpus import (  # noqa: E402
    _colorant_documents,
    _correlation_documents,
    _material_documents,
)
from backend.app.vectorstore import (  # noqa: E402
    SOURCE_COLORANT_REFERENCE,
    SOURCE_CORRELATION_NOTE,
    SOURCE_MATERIAL_CHEMISTRY,
)


def test_material_documents_cover_every_material_with_no_fabricated_numbers() -> None:
    docs = _material_documents()
    assert len(docs) == len(MATERIALS)
    for doc in docs:
        assert doc.metadata["source_type"] == SOURCE_MATERIAL_CHEMISTRY
        name = doc.metadata["name"]
        mat = MATERIALS[name]
        # 산화물 표의 수치가 텍스트에 그대로(반올림 없이 조작 없이) 실려야 한다.
        for oxide, pct in mat.oxides.items():
            assert f"{oxide} {pct:.1f}%" in doc.text


def test_correlation_documents_cover_every_stull_zone() -> None:
    """StullZone에 새 항목이 추가되고 이 코퍼스가 안 따라가면, 이 테스트가
    바로 실패해야 한다(예: SEMI_MATTE가 한 번 빠졌던 사례)."""
    docs = _correlation_documents()
    citations = " ".join(doc.metadata["citation"] for doc in docs)
    for zone in StullZone:
        assert zone.name in citations, f"StullZone.{zone.name}에 대응하는 상관관계 노트가 없다"
    for doc in docs:
        assert doc.metadata["source_type"] == SOURCE_CORRELATION_NOTE
        assert "문헌 추정 초기값" in doc.text


def test_stull_zone_notes_cite_the_verified_primary_source() -> None:
    """docs/AICE_CITATIONS.md §1이 서지사항을 확인해 둔 Stull(1912) 원
    논문은, StullZone에 매인 노트에서만 인용되고 냉각-결정화 노트(Stull
    경계표가 아니라 kiln-plan-v7.md 09절 출처)에는 지어내 붙이지 않는다."""
    docs = {doc.metadata["citation"]: doc for doc in _correlation_documents()}
    zone_docs = [doc for doc in docs.values() if "StullZone" in doc.metadata["citation"]]
    other_docs = [doc for doc in docs.values() if "StullZone" not in doc.metadata["citation"]]
    assert zone_docs, "StullZone 노트가 하나도 없다"
    assert other_docs, "StullZone 이외의 노트가 하나도 없다(냉각-결정화 노트가 사라졌다)"
    for doc in zone_docs:
        assert "Stull" in doc.text and "1912" in doc.text
    for doc in other_docs:
        assert "1912" not in doc.text


def test_colorant_documents_cover_every_colorant_oxide() -> None:
    docs = _colorant_documents()
    assert len(docs) == len(COLORANTS)
    doc_by_symbol = {doc.metadata["symbol"]: doc for doc in docs}
    assert set(doc_by_symbol) == set(COLORANTS)
    for symbol, colorant in COLORANTS.items():
        doc = doc_by_symbol[symbol]
        assert doc.metadata["source_type"] == SOURCE_COLORANT_REFERENCE
        # 문헌 참고값이라는 캐비어트가 반드시 실려야 한다(4-4-a절).
        assert "문헌 참고값" in doc.text
        assert colorant.name_ko in doc.text
