"""kiln.calibration.demo_convergence — 동일 레시피 20회차 합성 수렴 시연.

LLM 프런트도어 TODO Phase 5 2항: *"동일 레시피 반복 시 계수 수렴 시연 (기존
v7 '더미 20회차 수렴' 방식 재사용)"*. 체크리스트 문구가 시키는 v5/v7의
"더미 20회차 수렴"은 `docs/DECISIONS.md` §12-2, `docs/kiln-plan-v7.md`
부록 E가 이미 폐기한 설계다 — **생성기와 추정 모델이 같으면 어떤 수렴도
자명하다.** 그래서 이 모듈은 그 방식을 문자 그대로 재사용하지 않는다.
대신 `kiln.firing.simulator.KilnSimulator` 가 12-2절을 지키는 것과 같은
원칙을 `kiln.calibration.update.run_update` 에 적용한다:

==============  ==========================================  ================================
구분             추정 모델 (`run_update`)                      생성기 (이 모듈, `_synthetic_round`)
==============  ==========================================  ================================
부착량 함수      √(담금시간)에만 비례                            √(담금시간) + 크러스트 항(담금시간에 **선형**)
정지성           회차마다 같은 참값을 가정                         저울 무게에 회차별 가우스 잡음
==============  ==========================================  ================================

크러스트 항은 "긴 담금은 표면에 얇은 막이 앉아 diffusion(√t) 모델이 잡지
못하는 추가 부착을 만든다"는 가상의 2차 효과다 — 부록 C 계수가 아니라
이 생성기 내부에서만 쓰는 오지정 파라미터이며 실물 값을 주장하지 않는다
(`_CRUST_BIAS_MM_PER_S` 참고).

:func:`run_convergence_demo` 가 내놓는 것은 "k1이 참값에 수렴했다"가
아니라 **"앞 N회차 대비 뒤 N회차 평균 절대오차가 X% 줄었고, 크러스트
항이 만든 편향 Y%가 남는다"** 다(부록 E 문체). `synthetic_target_k1`
은 생성기가 내부적으로 아는 합성 참값일 뿐 문헌값이 아니고, `run_update`
가 이 값을 정확히 복원한다고 주장하지 않는다 — 애초에 생성기 자체가
√t 항 하나로는 안 맞게 만들어져 있다.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from datetime import datetime

from kiln import constants
from kiln.batch.density import g_rho
from kiln.calibration.registry import CoefficientTableStore
from kiln.domain.enums import GlazingMethod
from kiln.domain.models import DensityMeasurement, GlazingRecord, Ware, WareShape
from kiln.thickness.geometry import surface_area_m2

__all__ = ["ConvergenceRound", "ConvergenceDemoResult", "run_convergence_demo"]

#: 생성기 내부 합성 참값 [mm/√s]. 부록 C `k1` 문헌값(0.55)과 일부러
#: 다르게 두어, 시연이 "대장 초기값을 그대로 돌려받았다"는 우연과 섞이지
#: 않게 한다. 실물 값을 주장하지 않는다.
_TRUE_K1 = 0.62

#: 크러스트 항 계수 [mm/s] — 담금시간에 선형으로 붙는, 추정 모델(√t만 봄)
#: 이 잡지 못하는 오지정 성분. 전형적 담금시간(20~90s)에서 √t 항의 수 %
#: 수준 편향을 내도록 작게 잡았다 — 편향이 신호를 통째로 집어삼키면
#: "narrowing"을 보일 여지가 아예 없어져 시연 자체가 무의미해진다.
_CRUST_BIAS_MM_PER_S = 0.0035

#: 저울 잡음의 표준편차 [g] — 시유 전/건조 후 저울 각 1회, 두 번의 오차가
#: 겹쳐 W에 실린다.
_SCALE_NOISE_G = 0.15

#: 슬립 비중 실측의 회차별 흔들림 표준편차 [g/cm³] — 매 회차 다시 재는
#: 값이라 정확히 같지 않다.
_RHO_NOISE = 0.01

_RHO_SLIP_BASE = 1.45  # g(ρ)=1.0이 되는 정규화 기준점
_DIP_SECONDS_RANGE = (20.0, 90.0)


def _demo_ware() -> Ware:
    shape = WareShape(
        shape_id="demo-cyl", name="시연용 원통", profile=((0.0, 35.0), (110.0, 35.0))
    )
    return Ware(
        ware_id="demo-ware",
        shape=shape,
        clay_body="백자토",
        bisque_temperature=780.0,
        glaze_interior=True,
    )


def _synthetic_round(rng: random.Random, ware: Ware, record_id: str) -> GlazingRecord:
    """오지정 생성기 1회차 — 추정 모델(`run_update`)이 모르는 크러스트 항 포함.

    부록 A: 흡수율은 k1과 곱으로만 식별되므로 여기서도 1.0으로 고정한다
    (추정 모델이 흡수율을 분리하지 못하는 것과 같은 축퇴를 생성기 쪽에서
    다시 풀어주면 오지정이 사라진다).
    """
    dip_seconds = rng.uniform(*_DIP_SECONDS_RANGE)
    rho = _RHO_SLIP_BASE + rng.gauss(0.0, _RHO_NOISE)
    absorption = constants.get("absorption").value  # 1.0, 부록 A

    true_mean_mm = _TRUE_K1 * math.sqrt(dip_seconds) * absorption * g_rho(rho)
    crust_mm = _CRUST_BIAS_MM_PER_S * dip_seconds  # 추정 모델에 없는 항
    mean_mm = true_mean_mm + crust_mm

    rho_dry = constants.get("rho_dry").value  # 대장 초기값 — 캘리퍼 없이 진행
    area_m2 = surface_area_m2(ware.shape, include_interior=ware.glaze_interior)
    weight_g = mean_mm * rho_dry * area_m2 * 1000.0
    weight_g += rng.gauss(0.0, _SCALE_NOISE_G) * 2  # 저울 2회(전/후) 잡음 합

    return GlazingRecord(
        record_id=record_id,
        ware_id=ware.ware_id,
        batch_id="demo-batch",
        method=GlazingMethod.DIPPING,
        weight_before=500.0,
        weight_after=500.0 + max(weight_g, 0.1),
        dip_seconds=dip_seconds,
        density=DensityMeasurement(
            batch_id="demo-batch",
            measured_at=datetime(2026, 1, 1, 9, 0),
            specific_gravity=rho,
            minutes_since_stirring=3.0,
        ),
    )


@dataclass(frozen=True, slots=True)
class ConvergenceRound:
    """20회차 시연의 한 회차 기록."""

    round_index: int
    dip_seconds: float
    #: 이 회차 단독의 k1 추정치. `run_update` 가 갱신하지 않은 회차면 None
    k1_estimate: float | None
    #: 이 회차 직후 테이블의 누적 k1(회차 수 가중 평균)
    table_k1: float | None
    #: |table_k1 − 합성 참값| — 참값 자체가 시연 전용 허구임을 잊지 않도록
    #: 필드명에 "error"가 아니라 "gap"을 쓴다
    gap_to_synthetic_target: float | None


@dataclass(frozen=True, slots=True)
class ConvergenceDemoResult:
    """20회차 시연의 요약 (부록 E 문체 — "수렴"이 아니라 "narrowing")."""

    rounds: tuple[ConvergenceRound, ...]
    synthetic_target_k1: float
    #: 앞 `window` 회차 |gap| 평균
    mean_gap_first_window: float
    #: 뒤 `window` 회차 |gap| 평균
    mean_gap_last_window: float
    #: (첫 창 − 마지막 창)/첫 창 · 100. 음수면 오히려 벌어졌다는 뜻이라
    #: 그대로 낸다 — 양수로 접어 보여주지 않는다
    narrowing_pct: float
    #: 마지막 창 평균 gap이 합성 참값 대비 몇 %인가 — "편향이 남는다"의 수치
    remaining_bias_pct: float
    notes: tuple[str, ...]


def run_convergence_demo(
    *, seed: int = 20260917, rounds: int = 20, window: int = 5
) -> ConvergenceDemoResult:
    """오지정 생성기로 `rounds` 회차를 굴리고 narrowing/편향을 보고한다.

    매 회차 `_synthetic_round` 가 만든 `GlazingRecord` 를 같은 레시피의
    `CoefficientTableStore` 에 `apply_run_update` 로 먹인다 — 12-2절
    `KilnSimulator.run` 이 제어기에 센서값만 넘기듯, 여기서도 `run_update`
    는 자신이 오지정 생성기 위에서 돌고 있다는 사실을 모른 채 저울값만
    받는다.

    ``seed`` 로 재현 가능하다(12-2절과 같은 요구). `window` 는 앞/뒤 비교에
    쓰는 회차 폭이며 기본 5 — 20회차를 5씩 4구간으로 나눌 때 첫/마지막
    구간이다.
    """
    if rounds < 2 * window:
        raise ValueError(f"rounds={rounds}가 2*window={2 * window}보다 작다")

    rng = random.Random(seed)
    ware = _demo_ware()
    store = CoefficientTableStore()
    recipe_id = "demo-recipe-phase5"

    round_records: list[ConvergenceRound] = []
    for i in range(1, rounds + 1):
        record = _synthetic_round(rng, ware, record_id=f"demo-{i}")
        result = store.apply_run_update(recipe_id, record, ware)
        table_k1 = result.table.k1
        gap = abs(table_k1 - _TRUE_K1) if table_k1 is not None else None
        round_records.append(
            ConvergenceRound(
                round_index=i,
                dip_seconds=record.dip_seconds or 0.0,
                k1_estimate=result.k1_estimate,
                table_k1=table_k1,
                gap_to_synthetic_target=gap,
            )
        )

    first_gaps = [
        r.gap_to_synthetic_target
        for r in round_records[:window]
        if r.gap_to_synthetic_target is not None
    ]
    last_gaps = [
        r.gap_to_synthetic_target
        for r in round_records[-window:]
        if r.gap_to_synthetic_target is not None
    ]
    mean_first = sum(first_gaps) / len(first_gaps) if first_gaps else 0.0
    mean_last = sum(last_gaps) / len(last_gaps) if last_gaps else 0.0
    narrowing_pct = (
        (mean_first - mean_last) / mean_first * 100.0 if mean_first > 0 else 0.0
    )
    remaining_bias_pct = mean_last / _TRUE_K1 * 100.0

    notes = (
        "부록 E: 생성기(√t + 크러스트 선형항 + 저울·비중 잡음)는 추정 모델"
        "(run_update, √t만 봄)과 구조적으로 다르게 오지정되어 있다 — "
        "이 위에서의 narrowing은 자기 생성기 역추적이 아니다",
        f"앞 {window}회차 평균 |k1_table − 합성참값| = {mean_first:.5f} mm/√s, "
        f"뒤 {window}회차 = {mean_last:.5f} mm/√s "
        f"(narrowing {narrowing_pct:+.1f}%)",
        f"뒤 {window}회차 평균 gap은 합성 참값의 {remaining_bias_pct:.1f}%다 — "
        "크러스트 항이 만드는 구조적 편향은 회차를 더 쌓아도 회차 수 가중 "
        "평균만으로는 지워지지 않는다(선형 항을 √t 모델로 흡수할 수 없다)",
        "synthetic_target_k1은 생성기 내부 허구값이다 — 부록 C 문헌값(0.55)과 "
        "다르며, run_update가 이 값을 '참값 복원'했다고 주장하지 않는다",
        "이 시연은 kiln.calibration 단독이며 UI 화면은 만들지 않았다"
        "(Phase 5 체크리스트 2항 완료 메모 참조)",
    )

    return ConvergenceDemoResult(
        rounds=tuple(round_records),
        synthetic_target_k1=_TRUE_K1,
        mean_gap_first_window=mean_first,
        mean_gap_last_window=mean_last,
        narrowing_pct=narrowing_pct,
        remaining_bias_pct=remaining_bias_pct,
        notes=notes,
    )
