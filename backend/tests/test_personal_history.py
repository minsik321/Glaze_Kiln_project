"""조성 추천 되먹임(`_personal_search_history`)이 목표가 아니라 **실측
결과**를 쓰는지 검증한다.

사용자 요구사항: "개인의 과거 레시피에서 해당 레시피가 나의 결과에
어떠했는지를 반영" — 이전 구현은 그 회차의 목표 좌표(``goal_gloss``/
``goal_transparency``)를 마치 결과인 것처럼 ``Prior``에 먹여서, 결함
태그만 없으면 목표를 완전히 빗나간 회차조차 "이 배합이 그 목표를
달성했다"는 관측으로 쌓였다. 이 테스트는 함수 단위로 그 수정을 검증한다
— HTTP 라우트를 통째로 돌리면 ``propose()``의 후보 순위 알고리즘까지
거쳐야 해서 신호가 흐려진다.
"""

from __future__ import annotations

from backend.app.routes import _extract_trustworthy_materials, _personal_search_history
from kiln.domain.enums import Gloss, Transparency
from kiln.domain.models import TargetCoordinate


def _row(*, materials: dict, defects: list[str] | None = None, gloss=None, transparency=None, status="evaluated"):
    return {
        "status": status,
        "goal_gloss": "satin",
        "goal_transparency": "opaque",
        "payload": {
            "recipe": {"materials": materials},
            "result": {
                "defects": defects or [],
                "gloss": gloss,
                "transparency": transparency,
                "defects_reviewed": True,
            },
        },
    }


_MATERIALS = {"규석": 40.0, "장석": 30.0, "석회석": 15.5, "카올린": 12.5, "벤토나이트": 2.0}


def test_history_uses_actual_result_not_goal_coordinate() -> None:
    """목표는 SATIN·OPAQUE지만 실제로는 GLOSS·TRANSPARENT로 나온 회차 —
    되먹임 좌표는 실제 결과여야 한다."""
    row = _row(materials=_MATERIALS, gloss="gloss", transparency="transparent")

    history = _personal_search_history([row])

    assert len(history) == 1
    materials, coord = history[0]
    assert materials == _MATERIALS
    assert coord == TargetCoordinate(gloss=Gloss.GLOSS, transparency=Transparency.TRANSPARENT)
    # 목표 좌표(SATIN·OPAQUE)로 잘못 읽히지 않았는지 명시적으로 확인한다.
    assert coord != TargetCoordinate(gloss=Gloss.SATIN, transparency=Transparency.OPAQUE)


def test_history_excludes_runs_without_recorded_result() -> None:
    """결과 광택·투명도가 아직 기록되지 않은 회차(레거시 회차 포함)는
    목표로 대체하지 않고 조용히 뺀다 — 판정 불가를 지어내지 않는다."""
    row = _row(materials=_MATERIALS, gloss=None, transparency=None)

    assert _personal_search_history([row]) == []


def test_history_excludes_outlier_defect_runs_even_with_recorded_result() -> None:
    row = _row(materials=_MATERIALS, defects=["running"], gloss="satin", transparency="opaque")

    assert _personal_search_history([row]) == []


def test_extract_trustworthy_materials_requires_evaluated_status() -> None:
    payload = {
        "recipe": {"materials": _MATERIALS},
        "result": {"defects": [], "gloss": "satin", "transparency": "opaque", "defects_reviewed": True},
    }

    assert _extract_trustworthy_materials("simulated", payload) is None
    assert _extract_trustworthy_materials("evaluated", payload) == _MATERIALS
