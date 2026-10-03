from backend.app.models import AiceRunCreate
from kiln.aice import sample_aice_run


def test_completed_run_normalizes_goal_and_result_levels() -> None:
    run = sample_aice_run().to_dict()
    run["status"] = "evaluated"
    run["goal"]["gloss"] = "SEMI-GLOSS"
    run["goal"]["transparency"] = "SEMI OPAQUE"
    run["result"].update({
        "match": "close",
        "defects_reviewed": True,
        "gloss": "SEMI-GLOSS",
        "transparency": "SEMI OPAQUE",
    })

    request = AiceRunCreate.model_validate({"title": "완료 기록", "run": run})

    assert request.run["goal"]["gloss"] == "semi_gloss"
    assert request.run["goal"]["transparency"] == "semi_opaque"
    assert request.run["result"]["gloss"] == "semi_gloss"
    assert request.run["result"]["transparency"] == "semi_opaque"
