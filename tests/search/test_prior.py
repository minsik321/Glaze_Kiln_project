"""5-5절 · 사전분포와 후보 제시 회귀 테스트.

확인하는 것:

- 5-5절 개인 데이터 가중의 **단조증가**
- 5-5절 축적은 조성→결과 매핑 — 목표를 바꿔도 리셋되지 않는다
- 5-5절 사전분포는 조성 축에만 정보를 준다 (소성 축이 자료형에 없다)
- 5-3절 소성 조건에 베이지안 최적화 금지 — kiln.firing 비의존
- 5-1절 고정 성분(카올린 배경·벤토나이트)이 후보에 실린다
- 4-4절 색은 예측하지 않는다
- 00절 출처가 umf_note에 실려 나간다
"""

from __future__ import annotations

import inspect
import math
from pathlib import Path

import pytest

from kiln import constants
from kiln.domain.enums import Gloss, Transparency
from kiln.domain.models import SearchState, TargetCoordinate
from kiln.search import prior as prior_module
from kiln.search.grid import simplex_grid
from kiln.search.objective import Candidate
from kiln.search.prior import (
    DEFAULT_COMPONENTS,
    PRIOR_PSEUDO_COUNT,
    Prior,
    propose,
)

GLOSSY = TargetCoordinate(gloss=Gloss.GLOSS, transparency=Transparency.TRANSPARENT)
MATTE = TargetCoordinate(gloss=Gloss.MATTE, transparency=Transparency.OPAQUE)
SATIN = TargetCoordinate(gloss=Gloss.SATIN, transparency=Transparency.TRANSLUCENT)

RECIPE_A = {"규석": 45.5, "장석": 30.0, "석회석": 10.0, "카올린": 12.5, "벤토나이트": 2.0}
RECIPE_B = {"규석": 25.5, "장석": 30.0, "석회석": 30.0, "카올린": 12.5, "벤토나이트": 2.0}


# ─── 5-5절 개인 데이터 가중 ──────────────────────────────────────────────────


def test_weight_starts_at_zero_with_no_personal_data() -> None:
    """콜드 스타트: 개인 관측이 0이면 사전분포가 전부를 설명한다."""
    p = Prior(observations=[(RECIPE_A, GLOSSY)])
    assert p.weight_of_personal_data() == 0.0


def test_weight_is_monotonically_increasing() -> None:
    """5-5절: 회차가 쌓일수록 개인 데이터의 가중치가 커진다."""
    p = Prior(observations=[(RECIPE_A, GLOSSY), (RECIPE_B, MATTE)])
    weights = [p.weight_of_personal_data()]
    for _ in range(30):
        p.update(RECIPE_A, SATIN)
        weights.append(p.weight_of_personal_data())
    assert all(b > a for a, b in zip(weights, weights[1:]))


def test_weight_stays_in_unit_interval() -> None:
    p = Prior(observations=[(RECIPE_A, GLOSSY)])
    for _ in range(200):
        p.update(RECIPE_B, MATTE)
        w = p.weight_of_personal_data()
        assert 0.0 <= w < 1.0


def test_weight_matches_empirical_bayes_form() -> None:
    """w(n) = n/(n+n₀) — 식이 코드에 그대로 드러나야 한다(순수 stdlib 원칙)."""
    p = Prior(observations=[(RECIPE_A, GLOSSY)])
    for n in range(1, 12):
        p.update(RECIPE_A, SATIN)
        assert p.weight_of_personal_data() == pytest.approx(
            n / (n + PRIOR_PSEUDO_COUNT)
        )


def test_weight_reaches_half_at_pseudo_count() -> None:
    """의사관측 수만큼 쌓이면 개인 데이터와 사전분포가 반반이 된다."""
    p = Prior(observations=[(RECIPE_A, GLOSSY)])
    for _ in range(int(PRIOR_PSEUDO_COUNT)):
        p.update(RECIPE_A, SATIN)
    assert p.weight_of_personal_data() == pytest.approx(0.5)


def test_weight_is_one_when_there_is_no_prior_corpus() -> None:
    """사전분포 코퍼스가 비어 있으면 개인 데이터 외에 근거가 없다."""
    p = Prior()
    p.update(RECIPE_A, GLOSSY)
    assert p.weight_of_personal_data() == 1.0


# ─── 5-5절 조성→결과 매핑 · 목표별 저장 금지 ────────────────────────────────


def test_update_and_predict_never_take_a_target() -> None:
    """부록 E: 목표별로 저장하면 사용자가 목표를 바꿀 때마다 리셋된다.

    목표 좌표가 저장 경로의 인자에 아예 없어야 그 실수가 재발하지 않는다.
    """
    assert list(inspect.signature(Prior.update).parameters) == [
        "self",
        "materials",
        "coord",
    ]
    assert list(inspect.signature(Prior.predict).parameters) == ["self", "materials"]
    assert list(inspect.signature(Prior.__init__).parameters) == [
        "self",
        "observations",
    ]


def test_changing_target_does_not_reset_accumulated_data() -> None:
    """5-5절: 축적은 조성→결과 매핑이므로 목표 변경에 영향받지 않는다."""
    p = Prior(observations=[(RECIPE_A, GLOSSY)])
    for _ in range(5):
        p.update(RECIPE_B, MATTE)
    before = (p.personal_count, p.prior_count, p.weight_of_personal_data())

    state_a = SearchState(target=GLOSSY)
    state_b = SearchState(target=MATTE)
    propose(state_a, p, n=3)
    propose(state_b, p, n=3)

    assert (p.personal_count, p.prior_count, p.weight_of_personal_data()) == before


def test_prediction_is_unchanged_by_target_choice() -> None:
    p = Prior(observations=[(RECIPE_A, GLOSSY), (RECIPE_B, MATTE)])
    first = p.predict(RECIPE_A)
    propose(SearchState(target=MATTE), p, n=2)
    assert p.predict(RECIPE_A) == first


# ─── predict ─────────────────────────────────────────────────────────────────


def test_predict_returns_none_when_empty() -> None:
    """근거가 없으면 "모른다"를 임의의 기본 좌표로 바꾸지 않는다."""
    assert Prior().predict(RECIPE_A) is None


def test_predict_recovers_an_exact_observation() -> None:
    p = Prior(observations=[(RECIPE_A, GLOSSY), (RECIPE_B, MATTE)])
    assert p.predict(RECIPE_A) == GLOSSY
    assert p.predict(RECIPE_B) == MATTE


def test_predict_is_scale_invariant() -> None:
    """배합비를 합 100%로 정규화해 저장하므로 눈금이 달라도 같은 점이다."""
    p = Prior(observations=[(RECIPE_A, GLOSSY), (RECIPE_B, MATTE)])
    halved = {k: v / 2 for k, v in RECIPE_A.items()}
    assert p.predict(halved) == p.predict(RECIPE_A)


def test_personal_data_overrides_prior_as_runs_accumulate() -> None:
    """5-5절 경험적 베이즈: 개인 데이터가 쌓이면 사전분포를 덮는다."""
    p = Prior(observations=[(RECIPE_A, GLOSSY)])
    assert p.predict(RECIPE_A) == GLOSSY
    for _ in range(100):
        p.update(RECIPE_A, MATTE)
    assert p.predict(RECIPE_A) == MATTE


def test_predict_returns_only_the_two_ordinal_axes() -> None:
    """4-4절 색은 예측하지 않는다 · 5-5절 소성 축은 예측하지 않는다."""
    p = Prior(observations=[(RECIPE_A, GLOSSY)])
    coord = p.predict(RECIPE_A)
    assert isinstance(coord, TargetCoordinate)
    assert set(TargetCoordinate.__slots__) == {"gloss", "transparency"}


@pytest.mark.parametrize("bad", [{}, {"규석": -1.0, "장석": 101.0}, {"규석": 0.0}])
def test_invalid_composition_raises(bad: dict[str, float]) -> None:
    with pytest.raises(ValueError):
        Prior().update(bad, GLOSSY)


# ─── 5-3절 · 부록 D 구조적 금지 ──────────────────────────────────────────────


def test_search_module_does_not_depend_on_firing() -> None:
    """5-3절: 소성 조건에 베이지안 최적화를 쓰지 않는다 — 이 모듈은 조성 계층 전용.

    소성 계층을 import하지 않는 것이 그 경계의 구조적 보증이다.
    """
    src = Path(prior_module.__file__).parent
    for path in sorted(src.glob("*.py")):
        text = path.read_text(encoding="utf-8")
        code_lines = [
            line for line in text.splitlines() if line.strip().startswith(("import ", "from "))
        ]
        assert not any("kiln.firing" in line for line in code_lines), path.name


def test_propose_takes_no_firing_condition() -> None:
    """5-3절: 후보는 조성뿐이다. 최고온·유지·냉각률은 이 계층의 인자가 아니다."""
    assert list(inspect.signature(propose).parameters) == ["state", "prior", "n"]


def test_proposal_is_deterministic() -> None:
    """부록 D: 탐색 엔진은 규칙/최적화 알고리즘으로 명시한다 — 난수가 없다."""
    p = Prior(observations=[(RECIPE_A, GLOSSY), (RECIPE_B, MATTE)])
    state = SearchState(target=SATIN)
    assert propose(state, p, n=6) == propose(state, p, n=6)


# ─── propose ─────────────────────────────────────────────────────────────────


def test_propose_returns_requested_count() -> None:
    p = Prior(observations=[(RECIPE_A, GLOSSY), (RECIPE_B, MATTE)])
    assert len(propose(SearchState(target=SATIN), p, n=6)) == 6
    assert len(propose(SearchState(target=SATIN), p, n=10)) == 10


def test_propose_candidates_sum_to_100() -> None:
    p = Prior(observations=[(RECIPE_A, GLOSSY)])
    for candidate in propose(SearchState(target=SATIN), p, n=8):
        assert sum(candidate.materials.values()) == pytest.approx(100.0, abs=1e-6)


def test_propose_carries_the_5_1_fixed_components() -> None:
    """5-1절: 벤토나이트 고정 · 카올린 고정 배경 비율(10~15%) 위의 3원료 삼각."""
    kaolin = constants.get("kaolin_background")
    bentonite = constants.get("bentonite_fixed")
    p = Prior(observations=[(RECIPE_A, GLOSSY)])
    for candidate in propose(SearchState(target=SATIN), p, n=6):
        assert candidate.materials["카올린"] == pytest.approx(kaolin.value)
        assert candidate.materials["벤토나이트"] == pytest.approx(bentonite.value)
        assert 10.0 <= candidate.materials["카올린"] <= 15.0
        assert set(candidate.materials) == set(DEFAULT_COMPONENTS) | {
            "카올린",
            "벤토나이트",
        }


def test_propose_is_ordered_by_expected_distance() -> None:
    p = Prior(observations=[(RECIPE_A, GLOSSY), (RECIPE_B, MATTE)])
    distances = [c.expected_distance for c in propose(SearchState(target=MATTE), p, n=8)]
    assert distances == sorted(distances)


def test_propose_puts_the_matching_direction_first() -> None:
    """규칙 순위 확인: 목표에 가까운 예상 좌표를 가진 조성이 먼저 나온다.

    사전분포가 "석회석이 많으면 매트"라고 말하고 목표가 매트면, 제시되는
    첫 후보는 석회석이 많은 쪽이어야 한다.
    """
    p = Prior(observations=[(RECIPE_A, GLOSSY), (RECIPE_B, MATTE)])
    first = propose(SearchState(target=MATTE), p, n=1)[0]
    assert first.expected_distance == 0.0
    top = propose(SearchState(target=MATTE), p, n=6)
    assert max(c.materials["석회석"] for c in top if c.expected_distance == 0.0) >= 30.0


def test_cold_start_yields_infinite_distance_and_says_so() -> None:
    """근거가 전혀 없으면 예상 거리를 지어내지 않고 inf로 두고 사유를 적는다."""
    candidates = propose(SearchState(target=SATIN), Prior(), n=6)
    assert len(candidates) == 6
    assert all(math.isinf(c.expected_distance) for c in candidates)
    assert all("예상 좌표를 낼 수 없다" in c.umf_note for c in candidates)


def test_cold_start_samples_are_spread_over_the_simplex() -> None:
    """5-2절 "66점 중 6~10점 표집" — 한 귀퉁이에 몰리면 안 된다.

    10%p 격자 전체의 석회석 폭에 견줘, 표집된 6점이 그 폭의 절반 이상을
    덮어야 한다.
    """
    candidates = propose(SearchState(target=SATIN), Prior(), n=6)
    whiting = [c.materials["석회석"] for c in candidates]
    grid = simplex_grid(
        10.0,
        DEFAULT_COMPONENTS,
        fixed={
            "카올린": constants.get("kaolin_background").value,
            "벤토나이트": constants.get("bentonite_fixed").value,
        },
    )
    full_span = max(p["석회석"] for p in grid) - min(p["석회석"] for p in grid)
    assert (max(whiting) - min(whiting)) >= full_span * 0.5
    assert len({tuple(sorted(c.materials.items())) for c in candidates}) == 6


def test_propose_refines_around_the_best_observation() -> None:
    """5-2절 2·3차 탐색: 관측이 있으면 유망 영역 주변을 세분한다.

    관측된 조성 중 목표에 가장 가까운 것을 중심으로, 모든 후보가
    grid_step 이내에서만 움직여야 한다.
    """
    observations = (
        (tuple(sorted(RECIPE_A.items())), GLOSSY),
        (tuple(sorted(RECIPE_B.items())), MATTE),
    )
    state = SearchState(target=MATTE, observations=observations, grid_step=5.0)
    p = Prior(observations=[(RECIPE_A, GLOSSY), (RECIPE_B, MATTE)])
    for candidate in propose(state, p, n=7):
        for component in DEFAULT_COMPONENTS:
            delta = abs(candidate.materials[component] - RECIPE_B[component])
            assert delta in (pytest.approx(0.0), pytest.approx(5.0))


def test_propose_rejects_non_positive_n() -> None:
    with pytest.raises(ValueError):
        propose(SearchState(target=SATIN), Prior(), n=0)


# ─── 00절 출처 전달 ──────────────────────────────────────────────────────────


def test_umf_note_carries_literature_provenance() -> None:
    """00절: 문헌 추정값을 쓰면 출처가 반환 자료형에 실려 나가야 한다."""
    p = Prior(observations=[(RECIPE_A, GLOSSY)])
    for candidate in propose(SearchState(target=SATIN), p, n=4):
        assert isinstance(candidate, Candidate)
        note = candidate.umf_note
        assert "문헌 추정 초기값" in note          # Stull 경계 · 카올린 배경
        assert "Stull 참조" in note
        assert "카올린 배경" in note and "벤토나이트" in note
        assert "색은 예측하지 않는다(4-4절)" in note
        assert "개인 데이터 가중" in note


def test_umf_note_states_the_composition_axis_restriction() -> None:
    """5-5절: 사전분포는 조성 축에만 정보를 준다 — 그 사실이 화면까지 나간다."""
    p = Prior(observations=[(RECIPE_A, GLOSSY)])
    note = propose(SearchState(target=SATIN), p, n=1)[0].umf_note
    assert "조성 축에만 정보를 준다" in note
    assert "소성 축은 개인 데이터로만" in note


def test_umf_note_reports_the_personal_weight_value() -> None:
    p = Prior(observations=[(RECIPE_A, GLOSSY)])
    for _ in range(int(PRIOR_PSEUDO_COUNT)):
        p.update(RECIPE_A, MATTE)
    note = propose(SearchState(target=SATIN), p, n=1)[0].umf_note
    assert "w=0.500" in note
    assert "부록 C 미등록 관행값" in note
