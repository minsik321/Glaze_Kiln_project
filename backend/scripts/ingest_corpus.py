"""Generate reproducible Supabase pgvector seed SQL for reference documents.

The source text comes from the project's chemistry and Stull tables. Private
run documents are indexed when those runs are saved, and are not written here.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _SCRIPT_DIR.parent
_ROOT_DIR = _BACKEND_DIR.parent
for _path in (_ROOT_DIR, _ROOT_DIR / "src"):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))

from kiln.chem.colorants import COLORANTS  # noqa: E402
from kiln.chem.materials import MATERIALS  # noqa: E402
from kiln.chem.stull import StullZone  # noqa: E402

from backend.app.vectorstore import (  # noqa: E402
    VECTOR_SIZE,
    _default_embed_fn,
    SOURCE_COLORANT_REFERENCE,
    SOURCE_CORRELATION_NOTE,
    SOURCE_MATERIAL_CHEMISTRY,
    VectorDocument,
)

#: 원료 역할 한 줄 설명 — kiln.chem.materials 모듈의 기존 주석에서 그대로
#: 옮긴다(새로 지어내지 않는다. 05-1절 근거).
_MATERIAL_ROLE_KO: dict[str, str] = {
    "규석": "알루미나 공급 없음(05-1절 근거① 전제) — 순수 유리형성제 원료.",
    "장석": "3원료 세트에서 유일한 알루미나 공급원이자 유일한 K2O 공급원(05-1절 근거①).",
    "석회석": "CaO 공급원이자 유일한 융제 확장축(05-2절 '석회석 축').",
    "카올린": "배경 비율로 고정하는 보조 알루미나 공급원(05-1절)이자 슬립 현탁 보조(근거②).",
    "벤토나이트": "현탁제이며 탐색 변수가 아니다(05-1절). 소량 고정 사용을 전제한다.",
}


def _material_documents() -> list[VectorDocument]:
    docs = []
    for name, mat in MATERIALS.items():
        oxide_desc = ", ".join(f"{ox} {pct:.1f}%" for ox, pct in mat.oxides.items())
        role = _MATERIAL_ROLE_KO.get(name, "")
        text = f"{name} — 원상태(raw) 기준 산화물 조성: {oxide_desc}"
        if mat.loi:
            text += f", LOI(강열감량) {mat.loi:.1f}%"
        text += f". {role}".rstrip()
        docs.append(
            VectorDocument(
                doc_id=f"material-{name}",
                text=text,
                metadata={
                    "source_type": SOURCE_MATERIAL_CHEMISTRY,
                    "name": name,
                    "citation": "src/kiln/chem/materials.py (05-1절)",
                },
            )
        )
    return docs


#: 성분 상관관계 — kiln.chem.stull.StullZone의 문헌 추정 초기값(부록 C,
#: 콘6/11 경계표)과 docs/kiln-plan-v7.md 09절 냉각 관계에서 그대로 옮긴
#: 요약이다. 이 프로젝트가 실측 검증한 값이 아니므로 각 문서 텍스트에
#: 그 사실을 명시한다(부록 A와 같은 태도 — "판정이 아니라 참조").
#:
#: Stull 영역에 매인 노트(zone이 있는 것)에는 docs/AICE_CITATIONS.md
#: §1에서 서지사항을 확인해 둔 1차 문헌(R.T. Stull, 1912)을 실제로
#: 병기한다 — "문헌 추정"이라는 말이 어떤 문헌인지 이제 특정할 수
#: 있다는 뜻이다. 냉각-결정화 노트는 Stull 원 논문이 아니라
#: docs/kiln-plan-v7.md 09절의 요업공학 일반 지식 요약이라 이 인용을
#: 붙이지 않는다 — 없는 서지사항을 지어내지 않는다.
_CORRELATION_NOTES: list[dict[str, str]] = [
    {
        "id": "corr-matte-high-al2o3",
        "text": "Al2O3가 SiO2 대비 상대적으로 높으면 무광(알루미나 매트) 방향이다.",
        "citation": "src/kiln/chem/stull.py StullZone.MATTE",
        "zone": StullZone.MATTE,
    },
    {
        "id": "corr-semi-matte-between",
        "text": "SiO2·Al2O3가 매트와 광택 사이 중간 정도이면 세미매트(완전한 광택도 뚜렷한 무광도 아닌) 방향이다.",
        "citation": "src/kiln/chem/stull.py StullZone.SEMI_MATTE",
        "zone": StullZone.SEMI_MATTE,
    },
    {
        "id": "corr-bright-balanced",
        "text": "SiO2·Al2O3가 함께 충분히 높고 균형 잡히면 광택(잘 녹은 유리질) 방향이다.",
        "citation": "src/kiln/chem/stull.py StullZone.BRIGHT",
        "zone": StullZone.BRIGHT,
    },
    {
        "id": "corr-crazing-low-both",
        "text": "SiO2·Al2O3가 모두 낮으면(융제 비중이 매우 크면) 열팽창이 크고 유동성이 높아 크레이징(관유)·흘러내림에 취약해진다.",
        "citation": "src/kiln/chem/stull.py StullZone.CRAZING",
        "zone": StullZone.CRAZING,
    },
    {
        "id": "corr-underfired-high-silica",
        "text": "SiO2가 과다하고 Al2O3가 상대적으로 부족하면, 유리형성제가 융제량 대비 너무 많아 그 콘·그 융제량으로는 다 녹이기 어려운 미용융 방향이다.",
        "citation": "src/kiln/chem/stull.py StullZone.UNDERFIRED",
        "zone": StullZone.UNDERFIRED,
    },
    {
        "id": "corr-low-silica-ambiguous",
        "text": "SiO2가 아주 낮은 영역은 '유리질 자체가 부족해 안 녹은 미용융'과 '녹았지만 유리형성제가 모자라 냉각 중 결정화한 저실리카 매트'가 조성 좌표만으로는 구분되지 않는다 — 구분은 콘·유지시간·냉각 조건이 결정한다.",
        "citation": "src/kiln/chem/stull.py StullZone.LOW_SILICA_AMBIGUOUS",
        "zone": StullZone.LOW_SILICA_AMBIGUOUS,
    },
    {
        "id": "corr-cooling-crystallization",
        "text": "석회질·저실리카 매트는 냉각 중 결정 석출로 무광이 된다 — 조성과 최고온도가 같아도 급냉하면 광택, 서냉하면 매트로 나올 수 있다.",
        "citation": "docs/kiln-plan-v7.md 09절",
        #: 특정 StullZone 하나에 매인 내용이 아니라(냉각 조건 전체에 관한
        #: 별도 참조) zone이 없다 — 아래 커버리지 확인에서 제외한다.
        "zone": None,
    },
]

#: 테스트(및 이 스크립트 자신)가 "StullZone 전 항목을 빠짐없이 다뤘는가"를
#: 기계적으로 확인할 수 있도록, 특정 zone에 매인 노트만 모은다.
_ZONES_COVERED: frozenset[StullZone] = frozenset(
    note["zone"] for note in _CORRELATION_NOTES if note["zone"] is not None
)
assert _ZONES_COVERED == set(StullZone), (
    f"_CORRELATION_NOTES가 StullZone 전 항목을 다루지 않는다 — 빠진 항목: "
    f"{set(StullZone) - _ZONES_COVERED}"
)


#: docs/AICE_CITATIONS.md §1에서 서지사항을 확인한 Stull 원 논문 —
#: zone이 있는 노트(=Stull 경계표에서 온 노트)에만 병기한다.
_STULL_PRIMARY_SOURCE = "R.T. Stull, \"Fusibility and Viscosity Tests\", Trans. Am. Ceram. Soc. 14, 62-70 (1912)"


def _correlation_documents() -> list[VectorDocument]:
    docs = []
    for note in _CORRELATION_NOTES:
        if note["zone"] is not None:
            suffix = f"(문헌 추정 초기값 — {_STULL_PRIMARY_SOURCE}의 경계표 기반. 이 프로젝트가 실측 검증한 값은 아님)"
        else:
            suffix = "(문헌 추정 초기값 — 이 프로젝트의 실측 검증은 아님)"
        docs.append(
            VectorDocument(
                doc_id=note["id"],
                text=f"{note['text']} {suffix}",
                metadata={"source_type": SOURCE_CORRELATION_NOTE, "citation": note["citation"]},
            )
        )
    return docs


#: 착색 산화물 참고 색상표 — kiln.chem.colorants.COLORANTS(4-4-a절)를
#: 그대로 문서화한다. 각 ColorantOxide.note에는 이미 문헌 참고값
#: 캐비어트가 포함돼 있으므로(모듈 자체가 __post_init__에서 강제한다)
#: 그 텍스트를 그대로 재사용한다 — 새로 지어내지 않는다.
def _colorant_documents() -> list[VectorDocument]:
    docs = []
    for symbol, colorant in COLORANTS.items():
        lo, hi = colorant.typical_pct
        text = (
            f"{colorant.name_ko}({symbol}) — {colorant.note} "
            f"통상 첨가량(건조 재료 대비) {lo:.1f}~{hi:.1f}wt%."
        )
        docs.append(
            VectorDocument(
                doc_id=f"colorant-{symbol}",
                text=text,
                metadata={
                    "source_type": SOURCE_COLORANT_REFERENCE,
                    "symbol": symbol,
                    "citation": "src/kiln/chem/colorants.py (4-4-a절)",
                },
            )
        )
    return docs


def _quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def build_seed_sql() -> str:
    docs = _material_documents() + _correlation_documents() + _colorant_documents()
    vectors = _default_embed_fn()([doc.text for doc in docs])
    if len(vectors) != len(docs) or any(len(vector) != VECTOR_SIZE for vector in vectors):
        raise ValueError(f"참고 문서 임베딩은 {VECTOR_SIZE}차원이어야 합니다.")
    rows = []
    for doc, vector in zip(docs, vectors):
        embedding = "[" + ",".join(format(float(value), ".9g") for value in vector) + "]"
        rows.append("(" + ", ".join((
            _quote(doc.doc_id), _quote(doc.metadata["source_type"]), _quote(doc.text),
            _quote(json.dumps(doc.metadata, ensure_ascii=False, separators=(",", ":"))) + "::jsonb",
            _quote(embedding) + "::extensions.vector",
        )) + ")")
    return (
        "-- Generated from backend/scripts/ingest_corpus.py with " + _default_embed_fn.__module__ + ".\n"
        "insert into public.aice_vector_documents (doc_id, source_type, content, metadata, embedding) values\n"
        + ",\n".join(rows) + "\n"
        "on conflict (doc_id) do update set content = excluded.content, "
        "metadata = excluded.metadata, embedding = excluded.embedding, updated_at = now();\n"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-sql", type=Path, required=True)
    args = parser.parse_args(argv)
    sql = build_seed_sql()
    args.output_sql.write_text(sql, encoding="utf-8")
    print(f"Supabase 참고 문서 SQL을 작성했습니다: {args.output_sql}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
