"""10-2절 · 회차 되먹임 — 계수 테이블 갱신.

10-2절 표에서 **매 회차, 저울만**으로 얻어지는 신호는 하나뿐이다: k1.
기물을 시유하면 저울 2회(시유 전/건조 후)가 남고, 형태에서 표면적 A가
나오므로 ``W/(A·ρ_dry) = k1·√(담금시간)·흡수율·g(ρ)`` 방정식이 회차마다
하나씩 쌓인다. 이 파일은 그 방정식 하나를 기존 k1에 합칠 뿐이며,

- **ρ_dry는 건드리지 않는다** — 회차 데이터는 저울뿐이라 ρ_dry와 평균두께가
  다시 곱으로 붙는다(7-3절). ρ_dry는 캘리퍼가 있는 :mod:`kiln.calibration.tiles`
  경로에서만 움직인다.
- **k2·s도 건드리지 않는다** — 파단면이 있어야 열리고, 있어도 서로 분리
  동정되지 않는다(7-4절, 부록 A). 동정되지 않은 계수는 ``None`` 으로 남긴다.

**7-5절 재캘리브레이션 트리거**: 초벌 온도가 바뀌면 흡수율이 바뀐다. 흡수율은
k1과 곱으로만 식별되므로 그 변화를 흡수율에 밀어 넣으면 **k1이 조용히 틀어진다.**
:func:`check_bisque_change` 가 그 경우 갱신을 멈추라고 말한다.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace

from kiln import constants
from kiln.batch.density import g_rho
from kiln.domain.enums import GlazingMethod
from kiln.domain.models import CoefficientTable, GlazingRecord, Ware
from kiln.thickness.geometry import surface_area_m2

from kiln.calibration.tiles import (
    DASHED_REASONS,
    DASHED_TARGETS,
    mean_thickness_from_weight,
)

__all__ = [
    "RunUpdate",
    "RecalibrationTrigger",
    "run_update",
    "update_after_run",
    "check_bisque_change",
]

#: 비중 실측이 없을 때 쓰는 대체값. g(ρ)/m(ρ)의 정규화 기준점과 같아서
#: g(ρ)=1.0이 되어 왜곡이 최소가 된다 (:mod:`kiln.thickness.profile` 과 동일).
_RHO_FALLBACK = 1.45


@dataclass(frozen=True, slots=True)
class RecalibrationTrigger:
    """재캘리브레이션이 필요한가 (7-5절)."""

    triggered: bool
    reason: str


@dataclass(frozen=True, slots=True)
class RunUpdate:
    """회차 1건의 갱신 결과와 그 사유 (10-2절).

    :class:`~kiln.domain.models.CoefficientTable` 은 값만 담는 frozen
    dataclass라 "왜 갱신했는지 / 무엇을 가정했는지"를 실을 자리가 없다.
    그 출처를 잃지 않으려고 갱신 함수의 본체는 이 자료형을 돌려주고,
    계약 함수 :func:`update_after_run` 이 ``.table`` 만 꺼내 준다
    (00절: 조용한 기본값 금지).
    """

    table: CoefficientTable
    #: 이 회차가 k1 갱신에 실제로 기여했는가
    applied: bool
    #: 이 회차 단독의 k1 추정치 [mm/√s]. 기여하지 못했으면 None
    k1_estimate: float | None
    notes: tuple[str, ...]
    solid: tuple[str, ...]
    dashed: tuple[str, ...]


def check_bisque_change(
    previous_bisque_c: float | None, ware: Ware, *, tolerance_c: float = 10.0
) -> RecalibrationTrigger:
    """초벌 온도 변경은 흡수가 아니라 **재캘리브레이션 트리거**다 (7-5절).

    v5는 초벌 온도 변화를 "캘리브레이션으로 흡수"한다고 적었다. 흡수율은
    k1과 곱으로만 식별되므로(부록 A) 거기에 밀어 넣으면 k1이 조용히
    틀어진다 — 회귀는 계속 수렴하는 것처럼 보이는데 값이 다른 물리량을
    가리키게 된다. 그래서 흡수하지 않고 **멈춘다**.

    ``tolerance_c`` 는 같은 소성으로 볼 수 있는 폭이다. 값을 주장하는 것이
    아니라 사용자가 조정할 파라미터로 노출한다(부록 C의 태도와 같다).
    """
    if previous_bisque_c is None:
        return RecalibrationTrigger(
            triggered=False,
            reason="이전 초벌 온도 기록이 없다 — 비교할 대상이 없으므로 트리거하지 않는다",
        )
    delta = ware.bisque_temperature - previous_bisque_c
    if abs(delta) <= tolerance_c:
        return RecalibrationTrigger(
            triggered=False,
            reason=(
                f"초벌 온도 변화 {delta:+.1f}℃가 허용폭 ±{tolerance_c:.1f}℃ 안이다"
            ),
        )
    return RecalibrationTrigger(
        triggered=True,
        reason=(
            f"초벌 온도가 {previous_bisque_c:.0f}℃ → {ware.bisque_temperature:.0f}℃"
            f"({delta:+.1f}℃) 바뀌었다. 7-5절: 흡수율 변화로 처리하지 말고 "
            f"타일 재캘리브레이션을 다시 하라 — 흡수율은 k1과 곱으로만 식별되므로 "
            f"여기에 밀어 넣으면 k1이 조용히 틀어진다"
        ),
    )


def run_update(
    table: CoefficientTable, record: GlazingRecord, ware: Ware
) -> RunUpdate:
    """회차 1건으로 k1을 갱신하고 그 사유를 함께 돌려준다 (10-2절, 7-3절).

    절차:

    1. 표면적 A — 왁스 면적 제외, 내부 시유 반영(7-5절). 왁싱을 무시하면
       총량 앵커가 깨진다.
    2. 평균 두께 ``W/(A·ρ_dry)``. ρ_dry는 테이블에 동정값이 있으면 그것을,
       없으면 대장 초기값(문헌 추정)을 **가정**하고 사유를 남긴다.
    3. ``k1 = 평균두께 / (√담금시간 · 흡수율 · g(ρ))``.
    4. 기존 k1과 회차 수 가중 평균으로 합친다:
       ``k1_new = (k1_old·n + k1_est)/(n+1)``. 회차가 쌓일수록 한 회차의
       흔들림이 줄어드는 것이 10-2절이 k1을 실선으로 그리는 근거다.

    **갱신하지 않는 경우** (그리고 그 이유를 ``notes`` 에 남긴다):

    - 담금이 아니다 — t_abs 모델과 담금시간이 없으면 방정식이 서지 않는다(7-5절).
    - 재시유·건조 미완 — 모델 적용 범위 밖이다(7-5절). 재습윤으로 흡수율이
      변한 회차를 k1에 먹이면 k1이 흡수율 변화를 대신 삼킨다.
    - 부착 무게가 0 이하이거나 담금시간이 0이다.
    """
    notes: list[str] = []
    applied = False
    k1_estimate: float | None = None

    bisque = check_bisque_change(table.calibrated_bisque_c, ware)

    if bisque.triggered:
        # 7-5절: 초벌 온도가 바뀌면 **흡수하지 않고 멈춘다.** 흡수율은 k1과
        # 곱으로만 식별되므로(부록 A) 이 회차를 그대로 먹이면 k1이 초벌 조건
        # 변화를 대신 삼키고, 회귀는 계속 수렴하는 것처럼 보이는데 값이 다른
        # 물리량을 가리키게 된다.
        notes.append(bisque.reason)
    elif record.method is not GlazingMethod.DIPPING or record.dip_seconds is None:
        notes.append(
            f"시유 방법이 {record.method.value}다 — k1은 담금의 t_abs 모델에서만 "
            "역산된다(7-5절). 이 회차로는 k1을 갱신하지 않는다"
        )
    elif not record.within_model_scope:
        if record.is_reglaze:
            notes.append(
                "재시유 회차다 — 재습윤으로 흡수율이 변해 모델 적용 범위 밖이다(7-5절). "
                "흡수율은 k1과 곱으로만 식별되므로(부록 A) 이 회차를 먹이면 k1이 "
                "흡수율 변화를 대신 삼킨다. 갱신하지 않는다"
            )
        if not record.drying_complete:
            notes.append(
                "건조 종료 판정을 통과하지 못했다 — 잔류 수분 2%면 두께가 2% 과대다"
                "(7-5절). 무게가 유약 무게가 아니므로 갱신하지 않는다"
            )
    elif record.glaze_weight <= 0 or record.dip_seconds <= 0:
        notes.append(
            f"부착 무게 {record.glaze_weight}g · 담금시간 {record.dip_seconds}s — "
            "방정식이 서지 않는다. 갱신하지 않는다"
        )
    else:
        area_m2 = surface_area_m2(
            ware.shape,
            exclude_waxed_m2=record.waxed_area_m2,
            include_interior=ware.glaze_interior,
        )

        if table.rho_dry is not None:
            rho_dry = table.rho_dry
            notes.append(f"ρ_dry={rho_dry:.4f} — 캘리퍼 캘리브레이션 동정값 사용")
        else:
            coeff = constants.get("rho_dry")
            rho_dry = coeff.value
            notes.append(
                f"ρ_dry={rho_dry} {coeff.annotation()}을 가정했다. 회차 데이터는 "
                "저울뿐이라 ρ_dry와 평균두께가 곱으로 붙는다(7-3절) — 이 가정이 X배면 "
                "k1도 1/X배로 움직인다. 캘리퍼 1회로 닫아야 한다"
            )

        if record.density is not None:
            rho = record.density.specific_gravity
        else:
            rho = _RHO_FALLBACK
            notes.append(
                f"비중 실측이 없다 — 정규화 기준값 {_RHO_FALLBACK}로 가정했다(g(ρ)=1.0)"
            )

        absorption = constants.get("absorption")
        mean_mm = mean_thickness_from_weight(record.glaze_weight, area_m2, rho_dry)
        denom = math.sqrt(record.dip_seconds) * absorption.value * g_rho(rho)
        k1_estimate = mean_mm / denom
        applied = True
        notes.append(
            f"이 회차의 k1 = {mean_mm:.4f}mm / (√{record.dip_seconds:.1f}s · "
            f"흡수율{absorption.value} · g(ρ={rho})) = {k1_estimate:.5f} mm/√s. "
            "부록 A: k1과 흡수율은 곱으로만 식별된다 — 분리 동정을 주장하지 않는다"
        )

    if applied and k1_estimate is not None:
        n = table.calibration_runs
        if table.k1 is None or n <= 0:
            new_k1 = k1_estimate
            notes.append(
                "기존 동정값이 없어 이 회차 추정치를 그대로 채택했다"
                if table.k1 is None
                else "회차 가중치가 0이라 이 회차 추정치가 기존 초기값을 대체한다"
            )
        else:
            new_k1 = (table.k1 * n + k1_estimate) / (n + 1)
            notes.append(
                f"k1 갱신: ({table.k1:.5f}·{n} + {k1_estimate:.5f})/{n + 1} "
                f"= {new_k1:.5f} mm/√s — 회차 수 가중 평균"
            )
        new_table = replace(
            table,
            k1=new_k1,
            calibration_runs=table.calibration_runs + 1,
            # 7-5절: "어떤 초벌 조건에서 동정했는가"가 표에 남아야 다음 회차에
            # 초벌 온도가 바뀐 것을 알아채고 멈출 수 있다.
            calibrated_bisque_c=ware.bisque_temperature,
        )
    else:
        new_table = replace(table)

    notes.append(
        "k2·s·ρ_dry·안전 두께 범위는 이 경로에서 갱신하지 않는다 — "
        "저울 신호로는 동정되지 않으므로 None(또는 기존값) 그대로 둔다(10-2절)"
    )
    for target in DASHED_TARGETS:
        notes.append(f"점선 — {target}: {DASHED_REASONS[target]}")

    solid: tuple[str, ...] = ("k1",) if applied else ()
    # CoefficientTable이 출처를 직접 들고 다닌다 — 되먹임이 여러 모듈을
    # 거치는 동안 "가정한 ρ_dry 위에서 낸 k1"인지가 지워지면 안 된다(00절).
    new_table = replace(new_table, provenance_notes=tuple(notes))
    return RunUpdate(
        table=new_table,
        applied=applied,
        k1_estimate=k1_estimate,
        notes=tuple(notes),
        solid=solid,
        dashed=DASHED_TARGETS,
    )


def update_after_run(
    table: CoefficientTable, record: GlazingRecord, ware: Ware
) -> CoefficientTable:
    """회차 1건으로 계수 테이블을 갱신한 **새 테이블**을 돌려준다 (10-2절).

    :class:`~kiln.domain.models.CoefficientTable` 은 frozen이므로 제자리
    수정하지 않고 새로 만든다. 갱신되는 것은 k1과 ``calibration_runs`` 뿐이며,
    동정되지 않은 계수(k2·s·ρ_dry)는 ``None`` 으로 남는다 — "아직 동정되지
    않았다"와 "0이다"는 다른 진술이고, 대장 초기값으로 조용히 채우면 그
    구분이 사라진다.

    갱신 사유·가정을 함께 보려면 :func:`run_update` 를 쓴다.
    """
    return run_update(table, record, ware).table
