from __future__ import annotations

from kiln.chem.materials import MATERIALS
from kiln.chem.colorants import COLORANTS
from kiln.llm.recipe_prompt import build_messages


def test_build_messages_lists_known_materials_only() -> None:
    messages = build_messages("사발에 어울리는 청록색 사틴 유약", candidate_count=5)
    assert messages[0]["role"] == "system"
    assert messages[1] == {"role": "user", "content": "사발에 어울리는 청록색 사틴 유약"}
    system = messages[0]["content"]
    for name in MATERIALS:
        assert name in system
    assert "5개" in system
    assert "JSON" in system
    for symbol in COLORANTS:
        assert symbol in system
    assert "외배합 wt%" in system


def test_build_messages_does_not_promise_exact_color() -> None:
    system = build_messages("아무 유약")[0]["content"]
    assert "정확한 색을 보장하지 않는다" in system
