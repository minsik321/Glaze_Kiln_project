from __future__ import annotations

import pytest

from kiln.domain.enums import Gloss, Transparency
from kiln.domain.models import TargetCoordinate
from kiln.aice.identity import canonical_recipe_id
from kiln.llm.recipe_candidates import RecipeCandidateValidationError, build_recipe_candidates, parse_target
from kiln.search.objective import Candidate

_MATERIALS = {"장석": 40.0, "석회석": 20.0, "규석": 25.0, "카올린": 15.0}


def _search_candidates(count: int = 2) -> list[Candidate]:
    return [
        Candidate(materials={**_MATERIALS, "장석": 40.0 - i, "규석": 25.0 + i}, expected_distance=float(i), umf_note=f"검색 후보 {i + 1} 근거")
        for i in range(count)
    ]


def _raw_candidate(cid: str = "cand-1", **overrides) -> dict:
    base = {
        "id": cid,
        "name": "해안 사틴",
        "colorants": {"CuO": 2.0, "CoO": 0.2},
        "colorant_note": "청록색 참고 출발값이며 실제 발색은 달라질 수 있음",
        "predicted_firing_range_c": [1180, 1230],
        "predicted_firing_note": "환원 소성, cone 6~8 가정",
    }
    base.update(overrides)
    return base


def test_build_recipe_candidates_uses_search_materials_not_llm_json() -> None:
    raw = {"candidates": [_raw_candidate("cand-1"), _raw_candidate("cand-2")]}
    candidates = _search_candidates(2)
    candidate_set, errors = build_recipe_candidates(raw, candidates)
    assert errors == ()
    assert len(candidate_set.candidates) == 2
    first = candidate_set.candidates[0]
    assert first.materials == _MATERIALS
    assert first.source_type == "inferred"
    assert first.predicted_firing_range.value == (1180, 1230)
    assert "Stull 참조" in first.predicted_firing_note
    assert first.photo.placeholder is True
    assert first.colorants == {"CuO": 2.0, "CoO": 0.2}
    assert "청록색" in first.colorant_note
    assert "검색 후보 1" in first.composition_note


def test_llm_supplied_materials_are_ignored_even_if_present() -> None:
    """v9: LLM이 옛 스키마 습관으로 materials를 보내도 검색 배합이 이긴다."""
    raw = {"candidates": [_raw_candidate("cand-1", materials={"규석": 999.0})]}
    candidate_set, _ = build_recipe_candidates(raw, _search_candidates(1))
    assert candidate_set.candidates[0].materials == _MATERIALS


def test_unknown_colorant_is_dropped() -> None:
    raw = {"candidates": [_raw_candidate(colorants={"Unobtainium": 1.0})]}
    with pytest.raises(RecipeCandidateValidationError, match="지원하지 않는 발색 산화물"):
        build_recipe_candidates(raw, _search_candidates(1))


def test_search_candidate_with_invalid_composition_is_dropped_not_crashed() -> None:
    """안전망: propose()가 규칙대로 유효한 배합만 내지만, 그렇지 않은 경우도 통째로 버린다."""
    bad_candidate = Candidate(materials={"규석": 999.0}, expected_distance=0.0, umf_note="깨진 배합")
    raw = {"candidates": [_raw_candidate("cand-1"), _raw_candidate("cand-2")]}
    candidate_set, errors = build_recipe_candidates(raw, [bad_candidate, *_search_candidates(1)])
    assert len(candidate_set.candidates) == 1
    assert candidate_set.candidates[0].id == canonical_recipe_id(_MATERIALS, {"CuO": 2.0, "CoO": 0.2})
    assert len(errors) == 1
    assert "cand-1" in errors[0]


def test_mismatched_counts_are_zipped_to_shorter_and_noted() -> None:
    raw = {"candidates": [_raw_candidate("cand-1"), _raw_candidate("cand-2")]}
    candidate_set, errors = build_recipe_candidates(raw, _search_candidates(1))
    assert len(candidate_set.candidates) == 1
    assert any("개수가 달라" in error for error in errors)


def test_all_candidates_invalid_raises() -> None:
    raw = {"candidates": [_raw_candidate("cand-1", colorants={"Unobtainium": 1.0})]}
    with pytest.raises(RecipeCandidateValidationError):
        build_recipe_candidates(raw, _search_candidates(1))


def test_empty_candidates_raises() -> None:
    with pytest.raises(RecipeCandidateValidationError):
        build_recipe_candidates({"candidates": []}, _search_candidates(1))


def test_empty_search_candidates_raises() -> None:
    raw = {"candidates": [_raw_candidate("cand-1")]}
    with pytest.raises(RecipeCandidateValidationError, match="검색이 낸 배합"):
        build_recipe_candidates(raw, [])


def test_parse_target_reads_enum_names() -> None:
    coord = parse_target({"target_gloss": "satin", "target_transparency": "OPAQUE"})
    assert coord == TargetCoordinate(gloss=Gloss.SATIN, transparency=Transparency.OPAQUE)


def test_parse_target_rejects_unknown_label() -> None:
    with pytest.raises(RecipeCandidateValidationError):
        parse_target({"target_gloss": "shiny", "target_transparency": "OPAQUE"})


def test_parse_target_rejects_missing_keys() -> None:
    with pytest.raises(RecipeCandidateValidationError):
        parse_target({"target_gloss": "SATIN"})


def test_candidate_identity_is_composition_not_llm_slot_or_name() -> None:
    raw = {"candidates": [_raw_candidate("cand-1")]}
    first, _ = build_recipe_candidates(raw, _search_candidates(1))
    changed = Candidate(materials={**_MATERIALS, "장석": 30.0, "규석": 35.0}, expected_distance=0, umf_note="")
    second, _ = build_recipe_candidates(raw, [changed])
    reordered, _ = build_recipe_candidates({"candidates": [_raw_candidate("cand-8", name="다른 이름")]}, _search_candidates(1))
    assert first.candidates[0].id != second.candidates[0].id
    assert first.candidates[0].id == reordered.candidates[0].id


def test_identical_candidate_recipes_are_deduplicated() -> None:
    one = _search_candidates(1)[0]
    result, errors = build_recipe_candidates({"candidates": [_raw_candidate(), _raw_candidate("cand-2")]}, [one, one])
    assert len(result.candidates) == 1
    assert "중복" in errors[0]
