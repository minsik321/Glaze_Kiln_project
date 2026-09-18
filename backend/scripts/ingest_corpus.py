"""backend/scripts/ingest_corpus.py — RAG 코퍼스 시딩(수정 사항 정리 3번).

Docker로 띄운 Qdrant(루트 docker-compose.yml)에 최초 1회 실행한다:

    docker compose up -d
    pip install -e ".[backend-dev]"   # qdrant-client[fastembed] 포함
    python backend/scripts/ingest_corpus.py

(레포 루트에서 실행한다고 가정한다. 다른 위치에서 실행해도 아래
``sys.path`` 보정으로 동작하지만, ``backend/.env``는 항상
``backend/app/config.py`` 기준 경로에서 읽으므로 실행 위치와 무관하다.)

여기서는 세 코퍼스를 채운다(모두 코드에 이미 있는 값을 그대로 문서화할
뿐이다 — 새 수치를 지어내지 않는다):

  1. **원료 화학** — ``kiln.chem.materials.MATERIALS``(05-1절). 원료별
     산화물 조성표.
  2. **성분 상관관계** — ``kiln.chem.stull.StullZone``의 문헌 추정 초기값
     (부록 C, Stull 경계표. ``StullZone`` 전 항목을 빠짐없이 다룬다 —
     테스트가 이걸 강제한다)과 ``docs/kiln-plan-v7.md`` 09절의 냉각-결정화
     관계를 그대로 옮긴 요약.
  3. **착색 산화물 참고 색상표** — ``kiln.chem.colorants.COLORANTS``
     (4-4-a절). 6종 착색 산화물의 문헌 참고 색상·통상 첨가량.

전부 "문헌 추정 초기값/참고값"이며 이 프로젝트가 실측 검증한 값이
아니다 — 각 문서의 ``citation`` 메타데이터에 정확한 출처 모듈/절을
남긴다.

**세 번째 코퍼스인 "과거 레시피"는 이 스크립트가 다루지 않는다.** 이유:

  - 사용자별 Supabase RLS 경계를 우회할 서비스 롤 키가 이 프로젝트에는
    없다(``backend/app/config.py``는 publishable/anon 키만 다룬다) — 이
    스크립트가 전체 사용자의 과거 회차를 한 번에 긁어올 방법이 없다.
  - 그보다 근본적으로, 사용자 요구사항 "데이터를 저장하면 벡터 db에
    저장되는 방식"은 저장 시점 인덱싱을 가리킨다. 그래서 개인 레시피
    코퍼스는 ``backend/app/routes.py``의 ``create_aice_run`` 라우트가
    평가 완료(evaluated)된 회차를 저장할 때마다
    ``_index_personal_recipe_best_effort``로 자동 색인한다(이상치는
    ``_personal_search_history``와 같은 기준으로 제외). 이 스크립트를
    다시 실행해도 원료 화학·상관관계 문서만 갱신될 뿐, 개인 레시피
    문서는 건드리지 않는다.

색인은 idempotent하다(``AiceVectorStore``가 문서 id를 결정적 UUID로
해싱한다) — 이 스크립트를 여러 번 실행해도 중복이 쌓이지 않고 갱신만
된다.
"""

from __future__ import annotations

import argparse
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

from backend.app.config import get_settings  # noqa: E402
from backend.app.vectorstore import (  # noqa: E402
    AiceVectorStore,
    SOURCE_COLORANT_REFERENCE,
    SOURCE_CORRELATION_NOTE,
    SOURCE_MATERIAL_CHEMISTRY,
    VectorDocument,
    VectorStoreUnavailable,
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


def _correlation_documents() -> list[VectorDocument]:
    return [
        VectorDocument(
            doc_id=note["id"],
            text=f"{note['text']} (문헌 추정 초기값 — 이 프로젝트의 실측 검증은 아님)",
            metadata={"source_type": SOURCE_CORRELATION_NOTE, "citation": note["citation"]},
        )
        for note in _CORRELATION_NOTES
    ]


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.parse_args(argv)

    settings = get_settings()
    if not settings.qdrant_configured:
        print(
            "QDRANT_URL이 설정되지 않았습니다 — backend/.env에 QDRANT_URL을 채우세요"
            "(기본값은 http://localhost:6333, docker-compose.yml 참고).",
            file=sys.stderr,
        )
        return 1

    material_docs = _material_documents()
    correlation_docs = _correlation_documents()
    colorant_docs = _colorant_documents()

    try:
        store = AiceVectorStore(url=settings.qdrant_url, collection=settings.qdrant_collection)
        store.upsert_documents(material_docs + correlation_docs + colorant_docs)
    except VectorStoreUnavailable as exc:
        print(f"Qdrant 색인에 실패했습니다: {exc}", file=sys.stderr)
        print(
            "Docker가 떠 있는지(docker compose up -d) 그리고 인터넷 연결이 되는지"
            "(fastembed가 최초 1회 임베딩 모델을 내려받는다) 확인하세요.",
            file=sys.stderr,
        )
        return 1

    total = len(material_docs) + len(correlation_docs) + len(colorant_docs)
    print(
        f"원료 화학 {len(material_docs)}건, 성분 상관관계 {len(correlation_docs)}건, "
        f"착색 산화물 참고표 {len(colorant_docs)}건(총 {total}건)을 "
        f"'{settings.qdrant_collection}' 컬렉션({settings.qdrant_url})에 색인했습니다."
    )
    print("(과거 레시피 코퍼스는 회차를 저장할 때마다 자동으로 색인됩니다 — 이 스크립트가 다루는 범위가 아닙니다.)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
