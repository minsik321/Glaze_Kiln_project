"""kiln.calibration.demo_convergence — 20회차 합성 narrowing 시연 검증.

부록 E 문체: 확인하는 것은 "k1이 참값으로 수렴했다"가 아니라 **생성기가
추정 모델과 구조적으로 다르고(오지정), 그 위에서도 뒤쪽 회차의 평균
gap이 앞쪽보다 커지지는 않으며, 크러스트 항이 만든 편향이 완전히 0으로
지워지지는 않는다**는 것이다.
"""

from __future__ import annotations

import pytest

from kiln.calibration.demo_convergence import (
    _CRUST_BIAS_MM_PER_S,
    _TRUE_K1,
    run_convergence_demo,
)


def test_same_seed_reproduces_the_same_rounds():
    """12-2절과 같은 요구 — seed가 유일한 잡음 입력이다."""
    a = run_convergence_demo(seed=42)
    b = run_convergence_demo(seed=42)
    assert a.rounds == b.rounds
    assert a.narrowing_pct == b.narrowing_pct


def test_a_different_seed_changes_the_noise():
    a = run_convergence_demo(seed=1)
    b = run_convergence_demo(seed=2)
    assert a.rounds != b.rounds


def test_every_round_updates_the_same_recipes_table():
    """20회차 전부 담금 · 건조완료라 `run_update` 가 매 회차 k1을 갱신한다."""
    result = run_convergence_demo()
    assert len(result.rounds) == 20
    for r in result.rounds:
        assert r.k1_estimate is not None
        assert r.table_k1 is not None
    # 회차 수 가중 평균이므로 10회차째의 테이블 k1은 그 10개 추정치
    # 범위 안에 있어야 한다(가중 평균의 정의).
    first_ten_estimates = [r.k1_estimate for r in result.rounds[:10]]
    tenth_table_k1 = result.rounds[9].table_k1
    assert min(first_ten_estimates) <= tenth_table_k1 <= max(first_ten_estimates)


def test_the_generator_is_misspecified_relative_to_run_update():
    """생성기가 √t 하나로만 맞는 게 아니라는 것 자체가 오지정의 증거다.

    크러스트 항이 0이 아닌 한 추정 모델(√t만 보는 run_update)은 구조적으로
    다른 함수 위에서 동작한다 — 12-2절이 요구한 "구조적으로 다른 생성기".
    """
    assert _CRUST_BIAS_MM_PER_S > 0
    result = run_convergence_demo()
    # 뒤쪽 회차의 평균 gap이 정확히 0으로 떨어지지 않는다 — 선형 크러스트
    # 항을 √t 모델로는 완전히 흡수할 수 없기 때문이다(부록 E: 편향 잔존).
    assert result.mean_gap_last_window > 0.0


def test_later_rounds_are_not_worse_than_earlier_rounds_on_average():
    """"수렴했다"고 주장하지 않는다 — 뒤쪽이 앞쪽보다 나빠지지는 않는다는
    약한 narrowing 주장만 검증한다. 회차 수 가중 평균의 분산 감소 성질상
    뒤쪽 창의 평균 gap이 앞쪽보다 크게 벌어지면 안 된다.
    """
    result = run_convergence_demo()
    assert result.mean_gap_last_window <= result.mean_gap_first_window
    assert result.narrowing_pct >= 0.0


def test_result_never_claims_recovery_of_a_single_true_value():
    """부록 E: "수렴했다"·"참값을 복원했다" 같은 표현을 쓰지 않는다."""
    result = run_convergence_demo()
    text = " ".join(result.notes)
    assert "수렴했다" not in text
    assert "복원했다" not in text
    assert "참값" in text  # 언급은 하되 "허구값"·"주장하지 않는다"와 함께
    assert "허구값" in text or "주장하지 않는다" in text
    assert f"{result.narrowing_pct:+.1f}%" in text
    # 편향이 남는다는 사실이 수치로 남아 있어야 한다(부록 E 문체).
    assert f"{result.remaining_bias_pct:.1f}%" in text


def test_synthetic_target_differs_from_the_literature_k1_default():
    """생성기 참값이 부록 C 문헌 초기값(0.55)과 다르다 — "대장 초기값을
    그대로 돌려받았다"는 우연이 시연과 섞이지 않는다.
    """
    from kiln import constants

    assert _TRUE_K1 != constants.get("k1").value


def test_rounds_shorter_than_two_windows_is_refused():
    with pytest.raises(ValueError):
        run_convergence_demo(rounds=4, window=5)
