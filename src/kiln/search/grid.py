"""5-2절 · 격자 — 단체(simplex) 격자 생성과 국소 세분화.

기획서 5-2절이 요구하는 것은 하나다.

    **격자 간격은 관측 노이즈보다 커야 한다.**
    1차  삼각형 전체를 10%p 격자로 (66점 중 6~10점 표집)
    2차  유망 영역 주변 5%p
    3차  2%p

이 모듈은 그 격자를 만들 뿐 **좁힐 시점을 판단하지 않는다** — 언제 10%p에서
5%p로 내려갈지는 안쪽 루프(07절)의 두께 통제 수준이 정하는 문제이고,
5-2절은 "노이즈의 지배적 성분은 조성이 아니라 시유 두께이므로, 안쪽 루프의
두께 통제가 격자 해상도의 상한을 정한다"고만 적었다. 그 상한을 산출할 함수는
아직 없다. 그래서 ``step_pct`` 는 항상 호출부가 넘긴다
(:attr:`kiln.domain.models.SearchState.grid_step`).

**왜 ±2%p 격자가 처음부터는 안 되는가** — 5-2절의 정량 근거를 그대로 옮기면,
±2%p 격자의 후보 A~D는 SiO₂ UMF가 최대 0.403밖에 벌어지지 않는데
석회석만 10%p 움직이면 그 폭의 **6.9배**(10→20%)가, 10~40% 전 구간으로는
**12.5배**가 움직인다. 관측 노이즈보다 작은 간격으로 격자를 짜면 회차를
전부 써도 후보 사이의 차이가 노이즈에 묻힌다.

**고정 성분(``fixed``)이 있는 이유** — 5-1절 원료 세 역할 분리다. 벤토나이트는
현탁제로 소량 고정이고 탐색 변수가 아니며, 카올린은 고정 배경 비율(10~15%)
위에서 3원료 삼각을 돈다. 격자는 **고정분을 뺀 나머지**에서만 만들어지고,
반환되는 점에는 고정 성분이 그대로 다시 실려 합이 100%가 된다.

**잔차(residual)를 마지막 성분이 흡수한다.** 고정분을 뺀 자유 총합이
``step_pct`` 의 정수배가 아닐 수 있다(예: 카올린 12.5% + 벤토나이트 2.0%를
고정하면 자유 총합 85.5%, 10%p 격자로 나누어떨어지지 않는다). 이때
``components`` 의 **앞 n−1개**를 ``step_pct`` 의 정수배로 돌리고 **마지막
하나가 나머지를 받는다**. 격자 간격은 모든 축에서 정확히 ``step_pct`` 로
유지되고(마지막 성분의 값들도 서로 ``step_pct`` 씩 떨어져 있다) 합은 정확히
100%가 된다 — 격자 전체가 잔차만큼 평행이동할 뿐이다. 자유 총합이 정수배일
때는 이 규칙이 대칭적인 표준 단체 격자와 완전히 같은 점집합을 낸다
(3원료·10%p·고정 없음 → 66점, 4원료 → 286점, 5-3절 표와 일치).
"""

from __future__ import annotations

import math
from collections.abc import Iterator, Sequence

__all__ = ["simplex_grid", "refine"]

#: 배합비 반올림 자릿수. 부동소수 누적오차로 합이 100.00000000001이 되는 것을
#: 막을 뿐이며, 이 값이 격자의 해상도를 정하지는 않는다(해상도는 step_pct).
_ROUND = 6

#: 합·비음수 검사 허용 오차 [%p].
_TOL = 1e-6

#: 전체 배합비 합 [%]. GlazeRecipe 불변식과 같은 값이다.
TOTAL_PCT = 100.0


def _validate_components(components: Sequence[str]) -> tuple[str, ...]:
    comps = tuple(components)
    if not comps:
        raise ValueError("탐색 성분이 비어 있다. 격자를 만들 축이 없다(5-2절)")
    if len(set(comps)) != len(comps):
        raise ValueError(f"탐색 성분에 중복이 있다: {comps}")
    return comps


def _lattice(max_k: int, dims: int) -> Iterator[tuple[int, ...]]:
    """합이 ``max_k`` 이하인 길이 ``dims`` 의 비음수 정수 튜플을 사전순으로."""
    if dims == 0:
        yield ()
        return
    for k in range(max_k + 1):
        for rest in _lattice(max_k - k, dims - 1):
            yield (k, *rest)


def simplex_grid(
    step_pct: float,
    components: Sequence[str],
    *,
    fixed: dict[str, float] | None = None,
) -> list[dict[str, float]]:
    """합 100% 제약을 지키는 단체 격자를 만든다 (5-2절).

    ``components`` 는 **탐색 축**(예: 규석·장석·석회석)이고, ``fixed`` 는
    5-1절이 탐색 변수에서 뺀 고정 성분(벤토나이트 현탁제, 카올린 배경
    비율)이다. 격자는 ``100 − sum(fixed)`` 안에서만 만들어지며, 반환되는
    각 점은 고정 성분을 포함해 **합이 정확히 100%** 다.

    간격은 모든 축에서 ``step_pct`` [%p]다. 자유 총합이 ``step_pct`` 의
    정수배가 아니면 ``components`` 의 마지막 성분이 잔차를 흡수한다(모듈
    docstring 참조) — 간격은 유지되고 격자 전체가 평행이동한다.

    5-3절 규모 확인: 3원료·10%p·고정 없음 = 66점, 4원료 = 286점.

    Args:
        step_pct: 격자 간격 [%p]. 5-2절의 10 → 5 → 2 순서. 양수여야 한다.
        components: 탐색 축이 되는 원료 이름들. 순서가 잔차 흡수 대상을
            정한다(마지막 성분이 흡수).
        fixed: 원료명 → 고정 비율 [%]. 탐색 변수가 아니다(5-1절).

    Returns:
        배합비 딕셔너리(원료명 → %) 리스트. 사전순으로 결정적이다.

    Raises:
        ValueError: 간격이 0 이하 / 성분이 비었거나 중복 / 고정 성분과
            탐색 성분이 겹침 / 고정분 합이 100%를 넘음.
    """
    if step_pct <= 0:
        raise ValueError(f"격자 간격은 양수여야 한다: {step_pct}")
    comps = _validate_components(components)

    fixed_map = dict(fixed or {})
    for name, pct in fixed_map.items():
        if pct < 0:
            raise ValueError(f"고정 성분 {name!r}의 비율이 음수다: {pct}")
    overlap = set(fixed_map) & set(comps)
    if overlap:
        raise ValueError(
            f"{sorted(overlap)}는 고정 성분이면서 탐색 축이다. "
            "5-1절은 둘을 분리한다 — 고정이면 탐색 변수가 아니다"
        )

    fixed_total = sum(fixed_map.values())
    free_total = TOTAL_PCT - fixed_total
    if free_total < -_TOL:
        raise ValueError(
            f"고정 성분 합이 {fixed_total:.2f}%로 100%를 넘는다. 탐색할 여지가 없다"
        )
    free_total = max(free_total, 0.0)

    if step_pct > free_total + _TOL and len(comps) > 1:
        raise ValueError(
            f"격자 간격 {step_pct}%p가 자유 총합 {free_total:.2f}%보다 크다. "
            "격자점이 꼭짓점 하나뿐이 되어 탐색이 성립하지 않는다"
        )

    max_k = int(math.floor(free_total / step_pct + _TOL))
    points: list[dict[str, float]] = []
    for combo in _lattice(max_k, len(comps) - 1):
        head = [k * step_pct for k in combo]
        tail = free_total - sum(head)
        if tail < -_TOL:
            continue
        values = [*head, max(tail, 0.0)]
        point = {name: round(v, _ROUND) for name, v in zip(comps, values)}
        point.update({name: round(v, _ROUND) for name, v in fixed_map.items()})
        points.append(point)
    return points


def refine(
    center: dict[str, float],
    step_pct: float,
    components: Sequence[str],
) -> list[dict[str, float]]:
    """유망 영역 주변을 더 촘촘한 간격으로 다시 훑는다 (5-2절 2·3차 탐색).

    ``center`` 를 그대로 두고, ``components`` 안에서 **한 성분에 +step,
    다른 한 성분에 −step** 을 주는 이동만 만든다. 합이 보존되므로 결과는
    전부 합 100%다(전역 격자를 다시 짜고 근방을 잘라내는 방식과 달리
    잔차·반올림이 끼지 않는다).

    ``components`` 에 없는 성분은 움직이지 않는다 — 5-1절 고정 성분
    (벤토나이트·카올린 배경)을 그대로 두고 3원료 삼각만 세분하는 것이
    이 함수의 기본 용법이다. ``center`` 에 없는 이름을 ``components`` 에
    넣으면 0%에서 출발하는 **새 축을 여는 것**으로 해석한다 — 5-1절
    "탐색 확장: 카올린 비율을 목표 미달 시에만 추가 차원으로 연다"가
    이 경로다.

    반환에는 ``center`` 자신이 포함된다. 세분 단계에서도 중심점은 여전히
    유효한 후보이고, 빼면 "더 촘촘히 봤더니 원래 점이 사라졌다"는 이상한
    결과가 된다.

    Args:
        center: 중심 배합비(원료명 → %). 합이 100%여야 한다.
        step_pct: 세분 간격 [%p]. 5-2절 2차 5, 3차 2.
        components: 움직일 성분들.

    Returns:
        배합비 딕셔너리 리스트. 중복 없이 사전순으로 결정적이다.

    Raises:
        ValueError: 간격이 0 이하 / 성분이 비었거나 중복 / 중심 배합비에
            음수가 있거나 합이 100%가 아님.
    """
    if step_pct <= 0:
        raise ValueError(f"세분 간격은 양수여야 한다: {step_pct}")
    comps = _validate_components(components)

    base = {name: float(pct) for name, pct in center.items()}
    for name, pct in base.items():
        if pct < 0:
            raise ValueError(f"중심 배합비의 {name!r}가 음수다: {pct}")
    total = sum(base.values())
    if not math.isclose(total, TOTAL_PCT, abs_tol=0.5):
        raise ValueError(
            f"중심 배합비 합이 {total:.2f}%다. 100%여야 한다"
        )
    for name in comps:
        base.setdefault(name, 0.0)

    seen: set[tuple[tuple[str, float], ...]] = set()
    points: list[dict[str, float]] = []

    def _add(point: dict[str, float]) -> None:
        rounded = {k: round(v, _ROUND) for k, v in point.items()}
        key = tuple(sorted(rounded.items()))
        if key in seen:
            return
        seen.add(key)
        points.append(rounded)

    _add(base)
    for donor in comps:
        for receiver in comps:
            if donor == receiver:
                continue
            if base[donor] - step_pct < -_TOL:
                continue
            moved = dict(base)
            moved[donor] = max(base[donor] - step_pct, 0.0)
            moved[receiver] = base[receiver] + step_pct
            _add(moved)

    points.sort(key=lambda p: tuple(sorted(p.items())))
    return points
