from __future__ import annotations

import pytest

from kiln.llm.recipe_candidates import RecipeCandidateValidationError, build_recipe_candidates


def _raw_candidate(cid: str = "cand-1", **overrides) -> dict:
    base = {
        "id": cid,
        "name": "해안 사틴",
        "materials": {"장석": 40.0, "석회석": 20.0, "규석": 25.0, "카올린": 15.0},
        "colorants": {"CuO": 2.0, "CoO": 0.2},
        "colorant_note": "청록색 참고 출발값이며 실제 발색은 달라질 수 있음",
        "predicted_firing_range_c": [1180, 1230],
        "predicted_firing_note": "환원 소성, cone 6~8 가정",
    }
    base.update(overrides)
    return base


def test_build_recipe_candidates_from_valid_llm_json() -> None:
    raw = {"candidates": [_raw_candidate("cand-1"), _raw_candidate("cand-2")]}
    candidate_set, errors = build_recipe_candidates(raw)
    assert errors == ()
    assert len(candidate_set.candidates) == 2
    first = candidate_set.candidates[0]
    assert first.source_type == "inferred"
    assert first.predicted_firing_range.value == (1180, 1230)
    assert "Stull 참조" in first.predicted_firing_note
    assert first.photo.placeholder is True
    assert first.colorants == {"CuO": 2.0, "CoO": 0.2}
    assert "청록색" in first.colorant_note


def test_unknown_colorant_is_dropped() -> None:
    raw = {"candidates": [_raw_candidate(colorants={"Unobtainium": 1.0})]}
    with pytest.raises(RecipeCandidateValidationError, match="지원하지 않는 발색 산화물"):
        build_recipe_candidates(raw)


def test_unknown_material_name_is_dropped_not_crashed() -> None:
    raw = {
        "candidates": [
            _raw_candidate("cand-1"),
            _raw_candidate("cand-2", materials={"목회": 50.0, "장석": 50.0}),
        ]
    }
    candidate_set, errors = build_recipe_candidates(raw)
    assert len(candidate_set.candidates) == 1
    assert candidate_set.candidates[0].id == "cand-1"
    assert len(errors) == 1
    assert "cand-2" in errors[0]


def test_materials_not_summing_to_100_is_dropped() -> None:
    raw = {
        "candidates": [
            _raw_candidate("cand-1"),
            _raw_candidate("cand-2", materials={"장석": 40.0, "규석": 40.0}),
        ]
    }
    candidate_set, errors = build_recipe_candidates(raw)
    assert len(candidate_set.candidates) == 1
    assert len(errors) == 1


def test_all_candidates_invalid_raises() -> None:
    raw = {"candidates": [_raw_candidate("cand-1", materials={"목회": 100.0})]}
    with pytest.raises(RecipeCandidateValidationError):
        build_recipe_candidates(raw)


def test_empty_candidates_raises() -> None:
    with pytest.raises(RecipeCandidateValidationError):
        build_recipe_candidates({"candidates": []})
