from __future__ import annotations

from kiln.chem.colorants import COLORANTS
from kiln.domain.enums import Gloss, Transparency
from kiln.llm.recipe_prompt import build_messages, build_target_messages
from kiln.search.objective import Candidate


def test_build_target_messages_lists_axis_names_only() -> None:
    messages = build_target_messages("사발에 어울리는 청록색 사틴 유약")
    assert messages[0]["role"] == "system"
    assert messages[1] == {"role": "user", "content": "사발에 어울리는 청록색 사틴 유약"}
    system = messages[0]["content"]
    for member in Gloss:
        assert member.name in system
    for member in Transparency:
        assert member.name in system
    assert "배합비나 원료는" in system
    assert "target_gloss" in system and "target_transparency" in system


def _candidates() -> list[Candidate]:
    return [
        Candidate(materials={"규석": 25.0, "장석": 40.0, "석회석": 20.0, "카올린": 12.5, "벤토나이트": 2.5}, expected_distance=0.0, umf_note="테스트 후보 1"),
        Candidate(materials={"규석": 30.0, "장석": 35.0, "석회석": 20.0, "카올린": 12.5, "벤토나이트": 2.5}, expected_distance=1.0, umf_note="테스트 후보 2"),
    ]


def test_build_messages_pins_search_materials_and_forbids_inventing_them() -> None:
    candidates = _candidates()
    messages = build_messages("사발에 어울리는 청록색 사틴 유약", candidates)
    system = messages[0]["content"]
    assert "규석 25.0%" in system
    assert "장석 40.0%" in system
    assert "바꾸지 마시오" in system
    assert "2개 후보" in system
    for symbol in COLORANTS:
        assert symbol in system


def test_build_messages_does_not_promise_exact_color() -> None:
    system = build_messages("아무 유약", _candidates())[0]["content"]
    assert "정확한 색을 보장하지 않는다" in system


def test_build_messages_schema_has_no_materials_field() -> None:
    system = build_messages("아무 유약", _candidates())[0]["content"]
    schema_part = system.split("정확히 이 JSON 구조로만 응답한다")[1]
    assert '"materials"' not in schema_part
