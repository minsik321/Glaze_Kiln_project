"""화면 1(LLM 채팅) 레시피 후보 프롬프트 — LLM 프런트도어 TODO Phase 2.

프롬프트가 강제하는 것: (1) 원료는 ``kiln.chem.materials.MATERIALS`` 에
있는 이름만 쓴다(현재 규석·장석·석회석·카올린·벤토나이트 5종, 05-1절
최소 세트) — 이 다섯 밖의 원료명을 쓰면 ``kiln.chem.unity_formula_from_materials``
가 계산할 수 없고, ``recipe_candidates`` 가 "계산이 맞는지 교차
확인"(Phase 2)할 수 없는 값을 화면에 올리게 된다. (2) 배합비 합은
100(±0.5)이어야 한다(``GlazeRecipe`` 불변식). (3) 출력은 고정 JSON
스키마 — 자유 대화가 아니라 화면 1이 그대로 그릴 수 있는 구조.

**이 프롬프트가 하지 않는 것**: 착색 산화물 첨가로 정확한 목표색이
나온다고 주장하지 않는다(4-4-a절, ``kiln.chem.colorants`` 의 경계 —
DECISIONS.md "착색 산화물 참고 색상표를 조성 예측으로 확장" 항목이
막는 것과 같은 이유). 색 관련 요청은 배합 제안과 별개의 참고 설명으로만
담는다.

**5원료 제약은 MVP 스코프 결정이다** — 원료 DB가 넓어지면(예: 목회,
콜만석, 활석 추가) 이 목록도 함께 넓혀야 한다. 지금은 데모 범위(§8,
Phase 0에서 확정)와 ``kiln.search`` 가 이미 다루는 조성 공간을 그대로
재사용해 없는 화학 데이터를 지어내지 않는 쪽을 택했다.
"""

from __future__ import annotations

from kiln.chem.materials import MATERIALS

__all__ = ["build_messages"]

_MATERIAL_NAMES = tuple(sorted(MATERIALS))

_SCHEMA_DESCRIPTION = """
정확히 이 JSON 구조로만 응답한다 (설명 문장, 마크다운, 코드펜스 없이 JSON 객체 하나):

{
  "candidates": [
    {
      "id": "cand-1",
      "name": "짧은 한국어 이름",
      "materials": {"규석": 25.0, "장석": 40.0, "석회석": 20.0, "카올린": 15.0},
      "predicted_firing_range_c": [1180, 1230],
      "predicted_firing_note": "환원/산화, cone 등 짧은 소성 방법 메모",
      "rationale": "이 배합을 고른 짧은 이유(1~2문장)"
    }
  ]
}
""".strip()


def build_messages(prompt_text: str, *, candidate_count: int = 5) -> list[dict[str, str]]:
    """화면 1 채팅 입력을 aimlapi chat/completions 메시지로 만든다."""
    system = (
        "당신은 도예 유약 레시피를 제안하는 보조 도구다. 반드시 다음 원료 "
        f"이름만 사용한다: {', '.join(_MATERIAL_NAMES)}. 이 목록 밖의 원료명을 "
        "쓰지 않는다 — 화학 계산기가 이 원료들의 산화물 조성만 알고 있어서, "
        "목록 밖 이름을 쓰면 검증에 실패해 후보 전체가 버려진다. "
        "각 후보의 원료 비율(wt%) 합은 정확히 100이어야 한다. 실제 소성 결과를 "
        "보장한다고 말하지 않는다 — 문헌·일반 지식에 근거한 출발점 제안임을 "
        "전제로 한다. 착색이나 정확한 색 재현은 이 배합 제안의 몫이 아니다 — "
        "언급하더라도 참고용 메모로만 남긴다. "
        f"정확히 {candidate_count}개의 서로 다른 후보를 제안한다. "
        f"{_SCHEMA_DESCRIPTION}"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt_text},
    ]
