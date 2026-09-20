from __future__ import annotations

import json

import pytest

from kiln.aice import AiceRun, SOURCE_TYPES, SourcedValue, aice_run_to_legacy, legacy_to_aice_run, sample_aice_run


def test_sample_round_trip_preserves_sources_units_and_versions() -> None:
    sample = sample_aice_run()
    restored = AiceRun.from_dict(json.loads(json.dumps(sample.to_dict())))
    assert restored == sample
    assert restored.schema_version == 3
    assert restored.recipe.firing_range.unit == "°C"
    assert restored.sources[0].source_type == "literature"
    assert restored.versions.predictor is None


def test_exact_source_types_and_invalid_value() -> None:
    assert SOURCE_TYPES == ("observed", "patent_example", "patent_range", "literature", "inferred", "synthetic")
    with pytest.raises(ValueError, match="source_type"):
        SourcedValue(1, "mm", "measured", .5, "invalid")  # type: ignore[arg-type]


def test_legacy_conversion_never_claims_missing_observation() -> None:
    run = legacy_to_aice_run({"id": "old-1", "title": "Old", "payload": {"cone": 6}})
    assert run.run_id == "old-1"
    assert run.thickness.mean.value is None
    assert run.thickness.mean.source_type == "inferred"
    assert run.sources[-1].source_type == "inferred"
    legacy = aice_run_to_legacy(run)
    assert legacy["schema_version"] == 1
    assert legacy["is_public"] is False
    assert legacy["payload"]["compatibility"] == "read_only"


def test_selected_curve_must_exist() -> None:
    data = sample_aice_run().to_dict()
    data["curves"]["selected_id"] = "missing"
    with pytest.raises(ValueError, match="후보"):
        AiceRun.from_dict(data)


def test_observation_fields_and_photo_survive_json_roundtrip() -> None:
    data = sample_aice_run().to_dict()
    data["recipe"].update(colorants={"CuO": 2.0}, colorant_note="외배합")
    data["application"].update(method="pouring", dip_seconds=None, drying_complete=True)
    data["result"].update(match="different", gloss="matte", transparency="opaque", defects_reviewed=True)
    data["result"]["photo"] = {"id": "observation", "kind": "result", "storage_path": None, "data_url": "data:image/png;base64,aGVsbG8=", "placeholder": False, "source_type": "observed", "rights_confirmed": False, "alt": "관찰.png"}
    restored = AiceRun.from_dict(json.loads(json.dumps(data)))
    assert restored.result.photo.data_url == data["result"]["photo"]["data_url"]
    assert restored.application.method == "pouring"
    assert restored.application.drying_complete is True
    assert restored.result.match == "different"
    assert restored.result.defects_reviewed is True
    assert restored.recipe.colorants == {"CuO": 2.0}


def test_legacy_run_does_not_invent_review_or_drying_confirmation() -> None:
    data = sample_aice_run().to_dict()
    del data["application"]["drying_complete"]
    del data["result"]["defects_reviewed"]
    restored = AiceRun.from_dict(data)
    assert restored.application.drying_complete is False
    assert restored.result.defects_reviewed is False
