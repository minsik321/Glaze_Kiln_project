"""5-4절 · 목적함수와 필터 회귀 테스트.

확인하는 것:

- 5-4절 식 ``d = w1·|Δ광택도| + w2·|Δ투명도|`` 를 그대로 낸다
- 거리 공리(비음수 · 동일점 0 · 대칭)
- 부수 관측이 목적함수에 **섞이지 않는다** (필터 경로와 완전히 분리)
- 4-4절 색은 필터에서도 빠진다
"""

from __future__ import annotations

import itertools

import pytest

from kiln.domain.enums import FailureType, Gloss, Grade, Transparency
from kiln.domain.models import FiringResult, TargetCoordinate
from kiln.search.objective import (
    Candidate,
    DISQUALIFYING_FAILURES,
    FILTERED_OBSERVATION_KEYS,
    objective,
    passes_filter,
)

ALL_COORDS = [
    TargetCoordinate(gloss=g, transparency=t)
    for g in Gloss
    for t in Transparency
]


# ─── 5-4절 목적함수 ──────────────────────────────────────────────────────────


def test_objective_matches_plan_formula() -> None:
    """5-4절: d = w1·|광택도_목표 − 광택도_결과| + w2·|투명도_목표 − 투명도_결과|."""
    target = TargetCoordinate(gloss=Gloss.SATIN, transparency=Transparency.TRANSLUCENT)
    result = TargetCoordinate(gloss=Gloss.GLOSS, transparency=Transparency.OPAQUE)
    # |2−4| = 2, |2−0| = 2
    assert objective(target, result) == pytest.approx(4.0)
    assert objective(target, result, w_gloss=2.0) == pytest.approx(6.0)
    assert objective(target, result, w_transparency=0.5) == pytest.approx(3.0)


def test_objective_default_weights_are_one_to_one() -> None:
    """5-4절: w1, w2 기본 1:1."""
    target = TargetCoordinate(gloss=Gloss.DRY, transparency=Transparency.OPAQUE)
    result = TargetCoordinate(gloss=Gloss.MATTE, transparency=Transparency.SEMI_OPAQUE)
    assert objective(target, result) == pytest.approx(
        objective(target, result, w_gloss=1.0, w_transparency=1.0)
    )


def test_objective_is_non_negative() -> None:
    for a, b in itertools.product(ALL_COORDS, repeat=2):
        assert objective(a, b) >= 0.0


def test_objective_is_zero_exactly_at_identity() -> None:
    for coord in ALL_COORDS:
        assert objective(coord, coord) == 0.0
    for a, b in itertools.product(ALL_COORDS, repeat=2):
        if a != b:
            assert objective(a, b) > 0.0


def test_objective_is_symmetric() -> None:
    for a, b in itertools.product(ALL_COORDS, repeat=2):
        assert objective(a, b, 1.7, 0.3) == pytest.approx(objective(b, a, 1.7, 0.3))


def test_objective_satisfies_triangle_inequality() -> None:
    """L1 합이므로 삼각부등식도 성립한다 — d가 진짜 거리임을 확인."""
    for a, b, c in itertools.product(ALL_COORDS[:8], repeat=3):
        assert objective(a, c) <= objective(a, b) + objective(b, c) + 1e-9


def test_zero_weight_removes_an_axis() -> None:
    """가중 0은 "그 축은 보지 않겠다" — 허용한다."""
    target = TargetCoordinate(gloss=Gloss.DRY, transparency=Transparency.OPAQUE)
    result = TargetCoordinate(gloss=Gloss.GLOSS, transparency=Transparency.TRANSPARENT)
    assert objective(target, result, w_gloss=0.0) == pytest.approx(3.0)
    assert objective(target, result, w_transparency=0.0) == pytest.approx(4.0)


@pytest.mark.parametrize(
    "w_gloss,w_transparency", [(-1.0, 1.0), (1.0, -1.0), (-1.0, -1.0)]
)
def test_negative_weight_raises(w_gloss: float, w_transparency: float) -> None:
    """음수 가중은 d를 음수로 만들어 거리 공리를 깬다."""
    a = TargetCoordinate(gloss=Gloss.DRY, transparency=Transparency.OPAQUE)
    b = TargetCoordinate(gloss=Gloss.GLOSS, transparency=Transparency.TRANSPARENT)
    with pytest.raises(ValueError):
        objective(a, b, w_gloss=w_gloss, w_transparency=w_transparency)


def test_objective_signature_takes_only_coordinates() -> None:
    """5-4절 경계의 구조적 보증: 목적함수는 FiringResult를 받지 않는다.

    부수 관측을 d에 섞으려면 시그니처를 바꿔야만 한다.
    """
    import inspect

    params = list(inspect.signature(objective).parameters)
    assert params == ["target", "result", "w_gloss", "w_transparency"]
    hints = inspect.get_annotations(objective)
    assert hints["target"] == "TargetCoordinate"
    assert hints["result"] == "TargetCoordinate"


# ─── 5-4절 필터 ──────────────────────────────────────────────────────────────


def _result(
    *,
    grade: Grade = Grade.AS_INTENDED,
    failures: frozenset[FailureType] = frozenset(),
    observations: dict[str, str] | None = None,
    gloss: Gloss = Gloss.SATIN,
    transparency: Transparency = Transparency.TRANSLUCENT,
) -> FiringResult:
    return FiringResult(
        record_id="r1",
        coordinate=TargetCoordinate(gloss=gloss, transparency=transparency),
        grade=grade,
        failures=failures,
        observations=observations or {},
    )


def test_clean_result_passes() -> None:
    assert passes_filter(_result()) is True


def test_running_failure_is_excluded() -> None:
    """5-4절 예시: "흐름 발생" 시편은 목표 거리와 무관하게 제외한다."""
    assert (
        passes_filter(
            _result(grade=Grade.FAILED, failures=frozenset({FailureType.RUNNING}))
        )
        is False
    )


@pytest.mark.parametrize("failure", sorted(DISQUALIFYING_FAILURES, key=lambda f: f.name))
def test_all_disqualifying_failures_are_excluded(failure: FailureType) -> None:
    assert (
        passes_filter(_result(grade=Grade.FAILED, failures=frozenset({failure})))
        is False
    )


def test_underfired_alone_still_passes() -> None:
    """미용융은 필터가 아니다 — 광택도 축 Dry 끝으로 좌표에 그대로 찍히고
    d가 그 정보를 나른다(모듈 docstring)."""
    result = _result(
        grade=Grade.FAILED,
        failures=frozenset({FailureType.UNDERFIRED}),
        gloss=Gloss.DRY,
        transparency=Transparency.OPAQUE,
    )
    assert passes_filter(result) is True
    target = TargetCoordinate(gloss=Gloss.GLOSS, transparency=Transparency.TRANSPARENT)
    assert objective(target, result.coordinate) == pytest.approx(7.0)


@pytest.mark.parametrize("key", FILTERED_OBSERVATION_KEYS)
def test_observation_occurrence_excludes(key: str) -> None:
    assert passes_filter(_result(observations={key: "발생"})) is False


@pytest.mark.parametrize("value", ["없음", "미발생", "no", "", "   "])
def test_observation_absence_passes(value: str) -> None:
    assert passes_filter(_result(observations={"흐름": value})) is True


def test_colour_observation_never_excludes() -> None:
    """4-4절: 색은 예측하지 않고 부수 관측으로만 기록한다 — 필터도 아니다."""
    assert (
        passes_filter(_result(observations={"색": "청자색이 아니라 회색 발생"}))
        is True
    )


def test_unregistered_observation_key_never_excludes() -> None:
    """고정 표 조회뿐이다 — 자연어를 해석해 결함을 추론하지 않는다(부록 D)."""
    assert passes_filter(_result(observations={"메모": "흐름 발생함"})) is True


def test_grade_alone_does_not_exclude() -> None:
    """등급(10-1절 축 2)은 필터 입력이 아니다."""
    assert passes_filter(_result(grade=Grade.ACCEPTABLE)) is True


# ─── 필터와 목적함수의 분리 ──────────────────────────────────────────────────


def test_filter_does_not_leak_into_objective() -> None:
    """5-4절 핵심: 부수 관측은 d에 넣지 않는다.

    좌표가 같고 부수 관측만 다른 두 결과는 **거리가 완전히 같아야** 하고,
    필터 결과만 갈라져야 한다.
    """
    target = TargetCoordinate(gloss=Gloss.GLOSS, transparency=Transparency.TRANSPARENT)
    clean = _result()
    flowed = _result(
        grade=Grade.FAILED,
        failures=frozenset({FailureType.RUNNING}),
        observations={"흐름": "발생"},
    )
    assert clean.coordinate == flowed.coordinate
    assert objective(target, clean.coordinate) == objective(target, flowed.coordinate)
    assert passes_filter(clean) is True
    assert passes_filter(flowed) is False


def test_perfect_coordinate_can_still_be_filtered_out() -> None:
    """목표 거리 0인 시편도 흐름이 났으면 후보에서 빠진다 (5-4절)."""
    target = TargetCoordinate(gloss=Gloss.SATIN, transparency=Transparency.TRANSLUCENT)
    flowed = _result(grade=Grade.FAILED, failures=frozenset({FailureType.RUNNING}))
    assert objective(target, flowed.coordinate) == 0.0
    assert passes_filter(flowed) is False


def test_filter_signature_takes_only_result() -> None:
    """필터에는 가중치가 없다 — 가중치를 정의할 근거가 없어 필터로 쓴다(5-4절)."""
    import inspect

    assert list(inspect.signature(passes_filter).parameters) == ["result"]


# ─── Candidate ───────────────────────────────────────────────────────────────


def test_candidate_carries_provenance_note() -> None:
    """00절: 문헌 추정값을 쓰면 출처가 반환 자료형에 실려 나가야 한다."""
    candidate = Candidate(
        materials={"규석": 40.0, "장석": 40.0, "석회석": 20.0},
        expected_distance=1.0,
        umf_note="(문헌 추정 초기값)",
    )
    assert candidate.umf_note
    assert candidate.expected_distance == 1.0
    with pytest.raises(AttributeError):
        candidate.expected_distance = 2.0  # frozen
