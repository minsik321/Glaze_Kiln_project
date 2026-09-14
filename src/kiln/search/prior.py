"""5-5절 · 사전분포와 후보 제시 — 콜드 스타트 해법.

기획서 5-5절:

    사전분포   문헌 + Glazy 공개 데이터의 조성-결과 분포
                  ↓
    개인 데이터가 사전분포를 갱신 (경험적 베이즈 구조)
                  ↓
    회차가 쌓일수록 개인 데이터의 가중치가 커짐

이 모듈이 지키는 다섯 가지 제약은 전부 기획서 문장이지 최적화 편의가 아니다.

**① 조성 축 전용이다 (5-5절).** "사전분포는 조성 축에만 정보를 준다. 소성
축은 개인 데이터로만 채워진다." Glazy 사례에는 소성 정보 칸이 비어 있기
때문이다. 그래서 :class:`Prior` 에는 최고온·유지시간·냉각률을 넣을 자리가
**아예 없다**. 넣을 수 있게 만들어 두고 "쓰지 않기로 한다"고 적으면 다음
사람이 채운다.

**② 소성 조건에 베이지안 최적화를 쓰지 않는다 (5-3절, 부록 E).** 소성 조건은
회차당 1점만 관측된다 — 3차원 공간에 20점은 BO가 작동할 밀도가 아니다.
이 모듈은 조성 계층 전용이고, :mod:`kiln.firing` 을 import하지 않는다.
5-3절의 2단계 절차("1단계 소성 조건 고정 → 조성만 탐색, 2단계 조성 확정 후
소성 조건 1변수씩")에서 이 모듈은 **1단계만** 담당한다.

**③ 목표별로 저장하지 않는다 (5-5절, 부록 E).** 축적은 **조성→결과 매핑**
이다. 목표별로 저장하면 사용자가 목표를 바꿀 때마다 리셋된다. 그래서
:meth:`Prior.update` 와 :meth:`Prior.predict` 는 목표 좌표를 인자로 받지
않는다 — 목표는 :func:`propose` 가 **순위를 매길 때만** 쓰고 저장하지 않는다.

**④ 개인 데이터 가중은 단조증가한다 (5-5절).** 경험적 베이즈의 표준형
``w(n) = n / (n + n₀)`` 를 쓴다. n=0에서 0(전부 사전분포), n→∞에서 1(전부
개인 데이터), 그 사이 어디서도 감소하지 않는다.

**⑤ 판단 주체는 규칙이다 (부록 D).** 후보 순위는 ① 예상 거리 오름차순,
② 동점 내에서 조성 공간 최대최소(max-min) 공간 채움 — 두 규칙뿐이다.
LLM도 학습된 선호도 모델도 개입하지 않는다. 예측기 :meth:`Prior.predict` 는
역거리 가중 평균(inverse-distance weighting)이라는, 코드에 식이 그대로
드러나는 결정적 보간이다.

**색은 예측하지 않는다 (4-4절).** :meth:`Prior.predict` 가 돌려주는 것은
(광택도, 투명도) 두 축뿐이다. 색은 부수 관측으로만 기록된다.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence

from kiln import constants
from kiln.chem.stull import classify
from kiln.chem.umf import unity_formula_from_materials
from kiln.domain.enums import Gloss, Transparency
from kiln.domain.models import SearchState, TargetCoordinate
from kiln.search.grid import TOTAL_PCT, refine, simplex_grid
from kiln.search.objective import Candidate, objective

__all__ = [
    "PRIOR_PSEUDO_COUNT",
    "DEFAULT_COMPONENTS",
    "Prior",
    "propose",
]


#: 사전분포의 의사관측 수 n₀ — 개인 데이터 가중 ``w(n) = n/(n+n₀)`` 의 척도.
#:
#: **부록 C 미정값 대장에 등록된 계수가 아니다.** 5-5절은 "회차가 쌓일수록
#: 개인 데이터의 가중치가 커진다"는 방향만 적었고 속도를 적지 않았다. 8은
#: "개인 회차 8회(주 1회면 두 달)에서 개인 데이터와 사전분포가 반반이 된다"는
#: 관행적 눈금이며, 이 값의 **크기를 주장하지 않는다**. 주장하는 것은 함수의
#: 단조증가성뿐이고 그것만 테스트로 고정되어 있다. 값이 결과에 미치는 영향은
#: 후보의 ``umf_note`` 에 가중치 숫자로 실려 나간다.
PRIOR_PSEUDO_COUNT: float = 8.0

#: 1단계 탐색의 3원료 삼각 (5-1절 근거①). 순서가 :func:`~kiln.search.grid.simplex_grid`
#: 의 잔차 흡수 대상을 정한다 — 석회석이 마지막인 것은 5-2절이 석회석 축을
#: 가장 민감한 축(10%p가 후보 폭의 6~13배)으로 지목했기 때문이 아니라,
#: 잔차를 어디든 하나에 몰아야 하기 때문이다(격자 간격 자체는 세 축 모두
#: 동일하게 유지된다).
DEFAULT_COMPONENTS: tuple[str, ...] = ("규석", "장석", "석회석")

#: 역거리 가중의 분모 하한. 완전 일치 관측(거리 0)에서 0으로 나누는 것을 막고,
#: 그 관측이 사실상 전권을 갖게 한다.
_EPS = 1e-9


def _normalized(materials: dict[str, float]) -> dict[str, float]:
    """배합비를 합 100%로 정규화한다.

    조성 공간의 거리는 척도에 의존하므로 저장 전에 눈금을 맞춘다. 외부
    코퍼스(Glazy 등)가 100%로 떨어지지 않는 비율로 들어와도 개인 데이터와
    같은 공간에 놓이게 하는 것이 목적이다.
    """
    if not materials:
        raise ValueError("배합비가 비어 있다")
    for name, pct in materials.items():
        if pct < 0:
            raise ValueError(f"원료 {name!r}의 비율이 음수다: {pct}")
    total = sum(materials.values())
    if total <= 0:
        raise ValueError("배합비 합이 0 이하다")
    scale = TOTAL_PCT / total
    return {name: pct * scale for name, pct in materials.items()}


def _composition_distance(a: dict[str, float], b: dict[str, float]) -> float:
    """조성 공간의 유클리드 거리 [%p]. 없는 원료는 0%로 본다."""
    keys = set(a) | set(b)
    return math.sqrt(sum((a.get(k, 0.0) - b.get(k, 0.0)) ** 2 for k in keys))


def _clamped_level(value: float, axis: type[Gloss] | type[Transparency]) -> int:
    """가중 평균 레벨을 축의 정수 등급으로 되돌린다(반올림 후 구간 고정)."""
    levels = [m.level for m in axis]
    rounded = int(math.floor(value + 0.5))
    return min(max(rounded, min(levels)), max(levels))


class Prior:
    """조성→결과 사전분포 + 개인 데이터 갱신 (5-5절).

    두 코퍼스를 따로 들고 있다.

    - **사전분포 코퍼스**: 생성자의 ``observations``. 문헌 + Glazy 공개
      데이터의 조성-결과 분포다. 조성 축에만 정보가 있다.
    - **개인 코퍼스**: :meth:`update` 로 쌓인다. 회차가 쌓일수록 가중이
      커진다(:meth:`weight_of_personal_data`).

    둘을 한 리스트에 섞지 않는 이유가 5-5절 그 자체다 — 섞으면 "회차가
    쌓일수록 개인 데이터의 가중치가 커진다"를 표현할 수 없다.

    **저장 형식은 조성→결과다.** 목표 좌표는 어느 메서드에도 들어오지
    않는다(부록 E: "목표별로 저장하면 사용자가 목표를 바꿀 때마다
    리셋된다"). **소성 조건도 들어오지 않는다**(5-5절: 사전분포는 조성
    축에만 정보를 준다).
    """

    __slots__ = ("_prior", "_personal")

    def __init__(
        self,
        observations: Iterable[tuple[dict[str, float], TargetCoordinate]] = (),
    ) -> None:
        """사전분포 코퍼스로 초기화한다 (5-5절).

        Args:
            observations: ``(배합비, 결과 좌표)`` 쌍들. 문헌·Glazy 공개
                데이터에서 온 조성-결과 분포를 상정한다. 비워 두면
                순수 콜드 스타트가 되고, 개인 관측이 하나도 없는 동안
                :meth:`predict` 는 ``None`` 을 낸다.
        """
        self._prior: list[tuple[dict[str, float], TargetCoordinate]] = [
            (_normalized(materials), coord) for materials, coord in observations
        ]
        self._personal: list[tuple[dict[str, float], TargetCoordinate]] = []

    @property
    def prior_count(self) -> int:
        """사전분포 코퍼스의 관측 수."""
        return len(self._prior)

    @property
    def personal_count(self) -> int:
        """개인 관측 수 n. 5-5절 가중의 분자다."""
        return len(self._personal)

    def update(
        self, materials: dict[str, float], coord: TargetCoordinate
    ) -> None:
        """개인 관측 한 건을 축적한다 (5-5절 경험적 베이즈 갱신).

        **조성→결과 매핑으로만 저장한다.** 목표 좌표를 받지 않는 것이
        부록 E "목표별로 축적 데이터 저장" 폐기의 코드 표현이다 — 사용자가
        목표를 바꿔도 이 코퍼스는 그대로 남는다.

        소성 조건도 받지 않는다(5-5절). 소성 축은 이 계층의 관심사가
        아니며, 5-3절에 따라 순차 1변수·사전 지식 기반으로 따로 다룬다.

        Args:
            materials: 관측된 배합비(원료명 → %). 내부에서 합 100%로
                정규화해 저장한다.
            coord: 소성 결과 좌표 (10-1절 축 1).
        """
        self._personal.append((_normalized(materials), coord))

    def weight_of_personal_data(self) -> float:
        """개인 데이터의 가중 w (5-5절). 회차가 쌓일수록 커진다.

        ``w(n) = n / (n + n₀)``, n = 개인 관측 수, n₀ = :data:`PRIOR_PSEUDO_COUNT`.

        n에 대해 **단조증가**(엄밀히는 강증가)이고 ``0 ≤ w < 1`` 이다.
        n=0이면 0 — 사전분포가 전부를 설명한다(콜드 스타트). 사전분포
        코퍼스가 비어 있으면 개인 데이터 외에 근거가 없으므로 n>0인 한
        1.0을 돌려준다.

        Returns:
            0 이상 1 이하의 가중.
        """
        n = float(len(self._personal))
        if n == 0.0:
            return 0.0
        if not self._prior:
            return 1.0
        return n / (n + PRIOR_PSEUDO_COUNT)

    def predict(self, materials: dict[str, float]) -> TargetCoordinate | None:
        """조성으로부터 결과 좌표를 추정한다 (5-5절, 조성 축 전용).

        역거리 가중 평균이다. 두 코퍼스가 각각 그룹 가중
        ``(1−w)``·``w`` 를 나눠 갖고, 그룹 안에서는 조성 거리의 역제곱으로
        가중된다. 축별로 레벨의 가중 평균을 낸 뒤 반올림해 순서형 등급으로
        되돌린다 — 순서형 축이라 중간값이 없기 때문이다(4-1절).

        **색은 예측하지 않는다(4-4절).** 반환은 (광택도, 투명도) 뿐이다.
        **소성 조건도 예측하지 않는다(5-5절).**

        Args:
            materials: 평가할 배합비(원료명 → %).

        Returns:
            추정 좌표. 코퍼스가 양쪽 다 비어 있으면 ``None`` — 이때
            "모른다"를 0이나 임의의 기본 좌표로 바꾸지 않는다.
        """
        if not self._prior and not self._personal:
            return None

        query = _normalized(materials)
        w_personal = self.weight_of_personal_data()

        contributions: list[tuple[float, TargetCoordinate]] = []
        for group, group_weight in (
            (self._prior, 1.0 - w_personal),
            (self._personal, w_personal),
        ):
            if not group or group_weight <= 0.0:
                continue
            share = group_weight / len(group)
            for obs_materials, coord in group:
                dist = _composition_distance(query, obs_materials)
                contributions.append((share / (dist * dist + _EPS), coord))

        total = sum(w for w, _ in contributions)
        if total <= 0.0:
            return None

        gloss_level = sum(w * c.gloss.level for w, c in contributions) / total
        transparency_level = (
            sum(w * c.transparency.level for w, c in contributions) / total
        )
        return TargetCoordinate(
            gloss=Gloss.from_level(_clamped_level(gloss_level, Gloss)),
            transparency=Transparency.from_level(
                _clamped_level(transparency_level, Transparency)
            ),
        )


def _spread_select(
    points: Sequence[dict[str, float]], count: int
) -> list[dict[str, float]]:
    """조성 공간에서 최대한 멀리 떨어진 ``count`` 점을 고른다 (5-2절 표집).

    5-2절 "삼각형 전체를 10%p 격자로 (66점 중 6~10점 표집)"의 표집 규칙이다.
    탐욕적 max-min: 무게중심에서 가장 먼 점으로 시작해, 이미 고른 점들과의
    최소 거리가 최대가 되는 점을 하나씩 더한다. 동점은 사전순으로 깬다 —
    난수를 쓰지 않으므로 같은 입력에 항상 같은 표집이 나온다.
    """
    pool = list(points)
    if count >= len(pool):
        return pool

    keys = sorted({k for p in pool for k in p})
    centroid = {k: sum(p.get(k, 0.0) for p in pool) / len(pool) for k in keys}

    def _order_key(point: dict[str, float]) -> tuple[float, ...]:
        return tuple(point.get(k, 0.0) for k in keys)

    first = max(
        pool,
        key=lambda p: (_composition_distance(p, centroid), [-v for v in _order_key(p)]),
    )
    chosen = [first]
    remaining = [p for p in pool if p is not first]

    while len(chosen) < count and remaining:
        best = max(
            remaining,
            key=lambda p: (
                min(_composition_distance(p, c) for c in chosen),
                [-v for v in _order_key(p)],
            ),
        )
        chosen.append(best)
        remaining = [p for p in remaining if p is not best]
    return chosen


def _fixed_components() -> tuple[dict[str, float], str]:
    """5-1절 고정 성분과 그 출처 문구를 만든다.

    벤토나이트는 현탁제로 소량 고정(탐색 변수 아님), 카올린은 고정 배경
    비율(10~15%) — 둘 다 :mod:`kiln.constants` 대장에서 읽는다. 값을 코드에
    직접 쓰면 부록 C가 명세서 실시가능성의 근거인 이유가 무너진다.
    """
    kaolin = constants.get("kaolin_background")
    bentonite = constants.get("bentonite_fixed")
    fixed = {"카올린": kaolin.value, "벤토나이트": bentonite.value}
    note = (
        f"고정 성분(5-1절): 카올린 배경 {kaolin.value:g}% {kaolin.annotation()}"
        f" · 벤토나이트 {bentonite.value:g}% {bentonite.annotation()}"
    )
    return fixed, note


def _umf_note(
    materials: dict[str, float],
    fixed_note: str,
    personal_weight: float,
    predicted: TargetCoordinate | None,
) -> str:
    """후보 하나의 출처 주석 (00절). 문헌 추정임이 반드시 실려 나간다."""
    try:
        umf = unity_formula_from_materials(materials)
    except (ValueError, KeyError) as exc:
        chem_part = f"UMF 산출 불가 — {exc}"
    else:
        reading = classify(umf)
        chem_part = (
            f"UMF SiO2 {umf.sio2:.2f} · Al2O3 {umf.al2o3:.2f} · "
            f"비 {umf.ratio:.2f} → Stull 참조 「{reading.zone.value}」 "
            f"{reading.provenance_note}"
        )

    if predicted is None:
        pred_part = (
            "사전분포·개인 관측이 모두 비어 예상 좌표를 낼 수 없다 — "
            "예상 거리 대신 조성 공간 공간채움 표집으로 제시한다(5-2절)"
        )
    else:
        pred_part = (
            f"예상 좌표 {predicted} — 사전분포는 조성 축에만 정보를 준다. "
            "소성 축은 개인 데이터로만 채워진다(5-5절)"
        )

    return (
        f"{chem_part} | {fixed_note} | "
        f"개인 데이터 가중 w={personal_weight:.3f} "
        f"(n={PRIOR_PSEUDO_COUNT:g} 의사관측 기준, 부록 C 미등록 관행값) | "
        f"{pred_part} | 색은 예측하지 않는다(4-4절)"
    )


def propose(state: SearchState, prior: Prior, n: int = 6) -> list[Candidate]:
    """다음 회차에 걸 조성 후보 n개를 제시한다 (4-2절 · 5-2절 · 5-5절).

    **규칙 두 개로만 순위를 매긴다(부록 D: AI를 판단 주체로 쓰지 않는다).**

    1. ``prior.predict`` 로 얻은 예상 좌표와 ``state.target`` 의 거리
       (:func:`~kiln.search.objective.objective`, 5-4절) 오름차순.
    2. 동점 안에서는 조성 공간 max-min 공간 채움(:func:`_spread_select`) —
       거리가 순서형 축의 정수 합이라 동점이 대량으로 생기는데, 사전순으로
       자르면 삼각형 한 귀퉁이만 제시된다. 5-2절 "66점 중 6~10점 표집"이
       요구하는 것은 그 반대다.

    후보 격자는 두 갈래다.

    - **관측이 없으면**: ``state.grid_step`` 간격의 전체 단체 격자
      (5-2절 1차 탐색). 예상 좌표를 낼 수 없으면 거리는 전부 ``inf`` 가
      되고 순위는 순수 공간 채움으로 결정된다.
    - **관측이 있으면**: 목표에 가장 가까운 관측 조성을 중심으로
      ``state.grid_step`` 세분(:func:`~kiln.search.grid.refine`, 5-2절
      2·3차 탐색). 격자를 **좁힐 시점**은 이 함수가 정하지 않는다 —
      ``state.grid_step`` 은 호출부가 관리한다(5-2절: 해상도 상한은
      안쪽 루프의 두께 통제가 정한다).

    ``state.observations`` 는 **조성→결과 매핑**이다(5-5절). 목표를 바꾸면
    ``state.target`` 만 바뀌고 관측은 그대로다.

    이 함수는 소성 조건을 후보에 넣지 않는다 — 5-3절 1단계는 "소성 조건
    고정(레퍼런스 스케줄) → 조성만 탐색"이다.

    Args:
        state: 탐색 상태 — 목표 좌표, 축적 관측, 현재 격자 간격, 가중치.
        prior: 사전분포 + 개인 데이터.
        n: 제시할 후보 수. 5-2절의 "6~10점"이 기본 근거이며 기본값 6이다.

    Returns:
        예상 거리 오름차순의 :class:`~kiln.search.objective.Candidate` 리스트.
        격자점 수가 n보다 적으면 그만큼만 돌려준다.

    Raises:
        ValueError: ``n`` 이 1 미만.
    """
    if n < 1:
        raise ValueError(f"제시할 후보 수는 1 이상이어야 한다: {n}")

    fixed, fixed_note = _fixed_components()

    observed: list[tuple[dict[str, float], TargetCoordinate]] = [
        ({name: pct for name, pct in materials}, coord)
        for materials, coord in state.observations
    ]

    if observed:
        center, _ = min(
            observed,
            key=lambda pair: (
                objective(
                    state.target,
                    pair[1],
                    w_gloss=state.w_gloss,
                    w_transparency=state.w_transparency,
                ),
                tuple(sorted(pair[0].items())),
            ),
        )
        points = refine(center, state.grid_step, DEFAULT_COMPONENTS)
    else:
        points = simplex_grid(state.grid_step, DEFAULT_COMPONENTS, fixed=fixed)

    personal_weight = prior.weight_of_personal_data()

    scored: list[tuple[float, dict[str, float], TargetCoordinate | None]] = []
    for point in points:
        predicted = prior.predict(point)
        distance = (
            math.inf
            if predicted is None
            else objective(
                state.target,
                predicted,
                w_gloss=state.w_gloss,
                w_transparency=state.w_transparency,
            )
        )
        scored.append((distance, point, predicted))

    ordered: list[tuple[float, dict[str, float], TargetCoordinate | None]] = []
    for distance in sorted({d for d, _, _ in scored}):
        tie_group = [entry for entry in scored if entry[0] == distance]
        need = n - len(ordered)
        if need <= 0:
            break
        by_point = {id(entry[1]): entry for entry in tie_group}
        picked = _spread_select([entry[1] for entry in tie_group], need)
        ordered.extend(by_point[id(point)] for point in picked)

    return [
        Candidate(
            materials=dict(point),
            expected_distance=distance,
            umf_note=_umf_note(point, fixed_note, personal_weight, predicted),
        )
        for distance, point, predicted in ordered[:n]
    ]
