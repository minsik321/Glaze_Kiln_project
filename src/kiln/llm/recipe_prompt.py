"""화면 1(LLM 채팅) 레시피 후보 프롬프트 — LLM 프런트도어 TODO Phase 2.

**v9: 배합비(wt%) 숫자는 더 이상 LLM에게 요청하지 않는다.** 루트
CLAUDE.md "AI를 판단 주체로 쓰지 않는다"(부록 D)가 실제로 지켜지려면
조성 공간의 판단은 규칙(``kiln.search``)이 내려야 한다. 이 모듈은 그래서
두 개의 프롬프트를 만든다.

1. :func:`build_target_messages` — 사용자의 자연어 목표를 (광택도,
   투명도) 축으로 **분류만** 한다. 이건 배합 숫자 발명이 아니라 언어
   이해이므로 LLM에 맡겨도 된다 — 분류 결과는 ``kiln.search.prior.propose``
   호출의 입력(목표 좌표)이 될 뿐, 배합 자체를 정하지 않는다.
2. :func:`build_messages` — 1의 분류 → ``propose()``가 낸 배합 후보들을
   **고정값으로 프롬프트에 박아 넣고**, LLM에게는 후보별 이름·착색
   산화물·예상 소성 범위·근거 문장만 요청한다. 원료 목록 제약(현재
   규석·장석·석회석·카올린·벤토나이트 5종, 05-1절 최소 세트)은 그대로
   유지한다 — ``kiln.search.prior.DEFAULT_COMPONENTS``(규석·장석·석회석,
   자유축) + ``kiln.constants``의 카올린·벤토나이트 고정값과 이미 같은
   조성 공간이었으므로(5-1절), 재료 유니버스를 바꿀 필요가 없었다.

착색 산화물은 기본 유약 100%와 분리한 외배합 참고값으로 제안한다.
``kiln.chem.colorants`` 에 등록된 6종만 허용하며, 목표색의 정확한 재현을
주장하지 않는다.
"""

from __future__ import annotations

from kiln.chem.colorants import COLORANTS
from kiln.domain.enums import Gloss, Transparency
from kiln.search.objective import Candidate

__all__ = ["build_target_messages", "build_messages"]

_COLORANT_NAMES = tuple(sorted(COLORANTS))

_TARGET_SCHEMA = """
정확히 이 JSON 구조로만 응답한다 (설명 문장, 마크다운, 코드펜스 없이 JSON 객체 하나):

{"target_gloss": "SATIN", "target_transparency": "OPAQUE"}
""".strip()


def build_target_messages(prompt_text: str) -> list[dict[str, str]]:
    """자연어 목표 → (광택도, 투명도) 분류 요청. 배합비는 다루지 않는다."""
    gloss_names = ", ".join(g.name for g in Gloss)
    transparency_names = ", ".join(t.name for t in Transparency)
    system = (
        "당신은 도예 유약 목표를 두 개의 순서형 축으로 분류하는 보조 도구다. "
        "배합비나 원료는 절대 다루지 않는다 — 그건 별도 규칙 엔진이 정한다. "
        f"target_gloss는 다음 중 정확히 하나여야 한다: {gloss_names}. "
        f"target_transparency는 다음 중 정확히 하나여야 한다: {transparency_names}. "
        "사용자 설명이 모호하면 가장 가까운 값을 고른다. "
        f"{_TARGET_SCHEMA}"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt_text},
    ]


def _format_materials(materials: dict[str, float]) -> str:
    return ", ".join(f"{name} {amount:.1f}%" for name, amount in materials.items())


_SCHEMA_DESCRIPTION = """
정확히 이 JSON 구조로만 응답한다 (설명 문장, 마크다운, 코드펜스 없이 JSON 객체 하나):

{
  "candidates": [
    {
      "id": "cand-1",
      "name": "짧은 한국어 이름",
      "colorants": {"CuO": 2.0, "CoO": 0.2},
      "colorant_note": "예상 발색과 산화물 선택 이유. 실제 발색을 보장하지 않는다는 짧은 주의 포함",
      "predicted_firing_range_c": [1180, 1230],
      "predicted_firing_note": "환원/산화, cone 등 짧은 소성 방법 메모",
      "rationale": "이 배합을 고른 짧은 이유(1~2문장)"
    }
  ]
}
""".strip()


def build_messages(prompt_text: str, candidates: list[Candidate]) -> list[dict[str, str]]:
    """화면 1 채팅 입력 + 검색이 낸 고정 배합 → 서술 요청 메시지.

    ``candidates``(``kiln.search.prior.propose`` 결과)의 배합비는 이미
    확정돼 있다 — LLM은 그 숫자를 바꾸지 않고 후보별 이름·착색·소성
    메모만 채운다. 개수는 ``len(candidates)``로 고정된다(격자점이 부족하면
    요청보다 적을 수 있다).
    """
    listing = "\n".join(
        f"- 후보 {index + 1}(id: cand-{index + 1}, 배합 고정, 바꾸지 마시오): "
        f"{_format_materials(candidate.materials)}"
        for index, candidate in enumerate(candidates)
    )
    system = (
        "당신은 도예 유약 레시피 후보를 서술하는 보조 도구다. 아래에 각 후보의 "
        "배합비(wt%)가 이미 정해져 있다 — 이 숫자를 절대 바꾸거나 새로 지어내지 "
        f"않는다. 정확히 이 순서·id로 {len(candidates)}개 후보를 서술한다.\n"
        f"{listing}\n"
        "각 후보에 대해 짧은 이름과 근거만 제안한다. 발색 산화물은 기본 원료 "
        "합계에 넣지 말고 건조 기본 유약 100g 대비 외배합 wt%로 colorants에 "
        f"따로 쓴다. 허용 산화물은 {', '.join(_COLORANT_NAMES)}뿐이다. 무색 후보는 "
        "colorants를 빈 객체로 쓴다. 목표색에 맞는 참고 출발값을 제안하되, "
        "colorant_note에 예상 발색과 선택 이유를 짧게 설명한다. 기저 조성·두께·"
        "분위기·냉각에 따라 발색이 크게 달라져 정확한 색을 보장하지 않는다는 "
        "주의를 반드시 포함한다. 실제 소성 결과를 보장한다고 말하지 않는다 — "
        "문헌·일반 지식에 근거한 출발점 제안임을 전제로 한다. "
        f"{_SCHEMA_DESCRIPTION}"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt_text},
    ]
