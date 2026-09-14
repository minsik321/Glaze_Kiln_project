"""9-2절 · 적재 — 총량 이상 감지로 한정.

```
등록된 기물 목록 → 투영 면적 합 → 점유율 → F(점유율), h(점유율)
```

**승온 응답 역산으로 적재량을 검증하는 것은 분해능이 부족하다.** 9-2절이
든 숫자가 그대로 이 모듈의 설계 근거다.

    30L 가마(내화물 45kg, 선반 6kg), 100℃/h
      기물  0kg → 1400 W   3kg → 1467 W (+4.8%)   10kg → 1622 W (+15.9%)
      10kg 등록 vs 12kg 실제 = 신호 차 2.7%

    계통 불확실: 공급전압 ±5% → 전력 ±10% / 열선 노후 −5~15% / 축열 침투 지연

**신호(2.7%)가 계통 불확실(≈10%)보다 작다.** 그래서 기능 목표를
**총량 이상 감지(gross error detection)** 로 낮추고 임계값을 계통 불확실보다
크게 잡는다. 이 모듈은 **"적재 오등록 판별"을 주장하지 않는다**
(부록 E: 되살리면 안 되는 설계).

**F(점유율)·h(점유율)는 구현하지 않는다.** 밀집도 감쇠 계수 α·β가 부록 C
**미정**이고 동정 방법이 "시뮬레이터 민감도 스윕"이라, 값을 정하지 않은 채
함수형만 코드에 박으면 조용한 기본값이 된다. 이 모듈은 점유율까지만 내고
감쇠 함수는 민감도 스윕의 파라미터로 남긴다(12-1절: 값 없이는 자리표시자).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from kiln.domain.models import Ware

__all__ = [
    "SYSTEMATIC_UNCERTAINTY",
    "RESPONSE_PER_KG",
    "LoadingCheck",
    "packing_ratio",
    "check_loading",
]

#: 9-2절 계통 불확실의 대표 크기. 공급전압 ±5% → 전력 ±10%.
#: 임계값은 **반드시 이보다 커야** 한다 — 아니면 계통 불확실을 이상으로
#: 오인해 경보가 잡음이 된다.
SYSTEMATIC_UNCERTAINTY = 0.10

#: 적재 1kg당 승온 응답(유지전력)의 상대 증가율 [1/kg].
#: 9-2절 예제에서 그대로 역산한다 — (1622−1400)/1400/10kg = 0.01586,
#: (1467−1400)/1400/3kg = 0.01595. 두 점이 같은 기울기를 준다.
#: **이것은 부록 C 계수가 아니라 기획서 9-2절 예제의 역산값**이므로
#: 대장(constants)을 거치지 않는다. 가마가 바뀌면 호출부가 덮어쓴다.
RESPONSE_PER_KG = (1622.0 - 1400.0) / 1400.0 / 10.0


@dataclass(frozen=True, slots=True)
class LoadingCheck:
    """9-2절 총량 이상 감지 결과.

    ``gross_error`` 가 True여도 "적재를 잘못 등록했다"는 결론이 아니다.
    그 판별에 필요한 분해능이 없다(부록 A: "적재 — 총량 이상 감지만").
    """

    #: 선반 면적 대비 투영 면적 점유율 [0..]. 1.0 초과는 다단 적재를 뜻한다.
    packing_ratio: float
    #: 등록 적재량으로 예상한 승온 응답과 실제 응답의 괴리가 임계를 넘었는가
    gross_error: bool
    #: 사용된 임계값 (상대 편차). 계통 불확실보다 크다
    threshold: float
    #: 화면 문구. 계통 불확실 대비 신호 크기를 항상 함께 적는다
    message: str


def packing_ratio(wares: Sequence[Ware], shelf_area_m2: float) -> float:
    """등록된 기물의 투영 면적 합 / 선반 면적 (9-2절).

    9-2절의 사슬 ``등록된 기물 목록 → 투영 면적 합 → 점유율`` 중 점유율까지가
    이 함수의 범위다. 이어지는 ``F(점유율), h(점유율)`` 는 α·β 미정이라
    구현하지 않는다(모듈 docstring 참고).

    도메인 가드
        - ``shelf_area_m2 <= 0`` 이면 :class:`ValueError` (0으로 나누기).
        - 기물 목록이 비면 ``0.0``.
        - 1.0을 넘어도 자르지 않는다 — 다단 적재는 실제로 일어나고,
          잘라 버리면 "선반이 넘쳤다"는 정보가 사라진다.
    """
    if shelf_area_m2 <= 0:
        raise ValueError(
            f"선반 면적이 {shelf_area_m2} m²다. 점유율의 분모가 될 수 없다"
        )
    total = sum(w.footprint_area for w in wares)
    if total < 0:
        raise ValueError("투영 면적 합이 음수다. 기물 등록을 확인하라")
    return total / shelf_area_m2


def check_loading(
    declared_kg: float,
    observed_response_w: float,
    baseline_w: float,
    *,
    threshold: float = 0.20,
    response_per_kg: float = RESPONSE_PER_KG,
    packing_ratio_value: float = 0.0,
) -> LoadingCheck:
    """등록 적재량과 승온 응답의 **총량 이상 감지** (9-2절).

    ``baseline_w`` 는 빈 가마의 유지전력, ``observed_response_w`` 는 실제
    관측된 유지전력이다. 등록 적재량으로 기대되는 응답은

        기대응답 = baseline_w · (1 + declared_kg · response_per_kg)

    이고, 판정은 기대응답 대비 상대 편차 하나로 한다.

    **임계값은 계통 불확실보다 커야 한다.** ``threshold <= 0.10`` 이면
    :class:`ValueError` 를 던진다 — 9-2절이 요구하는 것은 임계를 낮춰
    민감하게 만드는 것이 아니라, 신호가 계통 불확실보다 작다는 사실을
    인정하고 기능 목표를 낮추는 것이다. 임계를 계통 불확실 아래로 내리면
    전압 변동과 열선 노후를 적재 이상으로 오보한다.

    이 판정이 **하지 못하는 것**: 9-2절 예제의 "10kg 등록 vs 12kg 실제"는
    신호 차가 2.7%라 어떤 정직한 임계로도 걸리지 않는다. 그래서 반환
    문구에 "적재 오등록 판별이 아니다"를 항상 싣는다(부록 A).

    도메인 가드
        - ``baseline_w <= 0`` → :class:`ValueError` (0으로 나누기).
        - ``declared_kg < 0`` → :class:`ValueError`.
    """
    if baseline_w <= 0:
        raise ValueError(
            f"빈 가마 기준 전력이 {baseline_w} W다. 상대 편차의 분모가 될 수 없다"
        )
    if declared_kg < 0:
        raise ValueError(f"등록 적재량이 음수다: {declared_kg} kg")
    if threshold <= SYSTEMATIC_UNCERTAINTY:
        raise ValueError(
            f"임계값 {threshold:.3f}가 계통 불확실({SYSTEMATIC_UNCERTAINTY:.2f})"
            " 이하다. 9-2절: 공급전압 ±5%만으로 전력이 ±10% 움직이므로 "
            "이 임계는 전압 변동을 적재 이상으로 오보한다. "
            "총량 이상 감지의 임계는 계통 불확실보다 크게 잡아야 한다"
        )

    expected_w = baseline_w * (1.0 + declared_kg * response_per_kg)
    deviation = (observed_response_w - expected_w) / expected_w
    gross_error = abs(deviation) > threshold

    head = (
        f"등록 {declared_kg:.1f}kg 기대응답 {expected_w:.0f}W · "
        f"관측 {observed_response_w:.0f}W · 편차 {deviation * 100:+.1f}%"
    )
    if gross_error:
        body = (
            f"임계 {threshold * 100:.0f}%를 넘었다 — **총량 이상**으로 표시한다. "
            "적재 목록·선반 구성·열전대 위치를 사람이 확인하라."
        )
    else:
        body = f"임계 {threshold * 100:.0f}% 이내 — 총량 이상 신호 없음."
    tail = (
        f"이 판정은 **총량 이상 감지(gross error detection)** 이지 적재 오등록 "
        f"판별이 아니다 (9-2절). 계통 불확실이 ±{SYSTEMATIC_UNCERTAINTY * 100:.0f}%"
        "(공급전압 ±5% → 전력 ±10%, 열선 노후 −5~15%)라 "
        "그보다 작은 적재 차이는 원리적으로 분해되지 않는다."
    )
    return LoadingCheck(
        packing_ratio=packing_ratio_value,
        gross_error=gross_error,
        threshold=threshold,
        message=f"{head}. {body} {tail}",
    )
