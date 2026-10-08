from __future__ import annotations

import copy

import pytest

from kiln.aice import AiceRun, sample_aice_run
from kiln.aice.identity import canonical_recipe_id, normalize_run_recipe


def test_identity_is_stable_across_order_units_and_float_noise():
    expected = canonical_recipe_id({"a": 40, "b": 60}, {"CuO": 2})
    assert canonical_recipe_id({"b": 600, "a": 400}, {"CuO": 2.0}) == expected
    assert canonical_recipe_id({"a": 40.00000000000001, "b": 60}, {"CuO": 2}) == expected
    assert canonical_recipe_id({"a": 40, "b": 60, "unused": 0}, {"CuO": 2}) == expected
    assert canonical_recipe_id({"a": 40, "b": 60}, {"CuO": 1}) != expected
    assert canonical_recipe_id({"a": 41, "b": 59}, {"CuO": 2}) != expected


@pytest.mark.parametrize("materials", [{}, {"x": 0}, {"x": float("nan")}, {"x": float("inf")}, {"x": -1}, {"": 1}, {"x": True}])
def test_invalid_identity_inputs_are_rejected(materials):
    with pytest.raises(ValueError):
        canonical_recipe_id(materials)


def test_legacy_candidate_external_colorants_are_recovered_without_mutation():
    run = sample_aice_run().to_dict()
    run["recipe"]["id"] = "cand-1"
    del run["recipe"]["colorants"]
    run["intake"]["candidates"]["candidates"][0]["colorants"] = {"CuO": 2}
    original = copy.deepcopy(run)
    normalized = normalize_run_recipe(run)
    assert run == original
    assert normalized["recipe"]["colorants"] == {"CuO": 2}
    assert normalized["recipe"]["id"] == normalized["intake"]["candidates"]["selected_id"]
    assert AiceRun.from_dict(normalized).recipe.colorants == {"CuO": 2}


def test_missing_composition_is_never_fabricated():
    run = sample_aice_run().to_dict()
    run["recipe"]["materials"] = {}
    assert normalize_run_recipe(run)["recipe"]["id"] == "coastal-satin"


def test_legacy_wrong_slot_cannot_supply_another_recipes_colorants():
    run = sample_aice_run().to_dict()
    run["recipe"]["id"] = "cand-1"
    del run["recipe"]["colorants"]
    candidate = run["intake"]["candidates"]["candidates"][0]
    candidate["materials"] = {"different material": 100}
    candidate["colorants"] = {"CuO": 2}
    assert normalize_run_recipe(run)["recipe"]["colorants"] == {}
