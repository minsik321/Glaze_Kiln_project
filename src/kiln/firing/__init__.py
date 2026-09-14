"""kiln.firing — 09절 · 적재와 소성 제어.

09절이 제어를 두 이유로 요구한다(9-1절). **① 품질** — 컨트롤러는 벽 센서
하나로 판단하지만 기물이 받은 열은 다르다. **② 데이터** — 소성이 통제되지
않으면 결과에 "그날 그 가마가 어땠는지"가 잡음으로 섞여 03절 바깥 루프의
신호가 무너진다. 제어는 품질을 위한 장치이면서 동시에 **데이터 계층을
성립시키는 전제**다.

구성:

- :mod:`kiln.firing.heatwork` — 센서 기준 열일 H_s와 등가 유지시간 Δt_eq (9-3·9-5절)
- :mod:`kiln.firing.loading` — 적재 점유율과 총량 이상 감지 (9-2절)
- :mod:`kiln.firing.cooling` — 자연냉각률 상한과 서냉 비용 (9-6절)
- :mod:`kiln.firing.simulator` — 오지정 생성기와 외란 주입 (12-2절)
- :mod:`kiln.firing.controller` — 구간별 제어와 외측 루프 모드 전환 (9-4·9-5절)

이 모듈은 :mod:`kiln.domain` · :mod:`kiln.constants` 에만 의존하고,
:mod:`kiln.exchange` 가 이 모듈에 의존한다(docs/INTERFACES.md 의존 방향).
"""

from kiln.firing.controller import (
    WATCHING_FRACTION,
    ControlDecision,
    OuterMode,
    Phase,
    SegmentedController,
)
from kiln.firing.cooling import (
    AMBIENT_C,
    QUARTZ_INVERSION_C,
    CoolingPlan,
    CoolingSegment,
    natural_cooling_hours,
    plan_cooling,
)
from kiln.firing.heatwork import (
    R_GAS,
    AssumedE,
    assume_E,
    equivalent_hold_seconds,
    heat_work,
    heat_work_curve,
)
from kiln.firing.loading import (
    RESPONSE_PER_KG,
    SYSTEMATIC_UNCERTAINTY,
    LoadingCheck,
    check_loading,
    packing_ratio,
)
from kiln.firing.simulator import Disturbance, KilnSimulator, SimStep

__all__ = [
    # heatwork
    "R_GAS",
    "AssumedE",
    "assume_E",
    "heat_work",
    "heat_work_curve",
    "equivalent_hold_seconds",
    # loading
    "SYSTEMATIC_UNCERTAINTY",
    "RESPONSE_PER_KG",
    "LoadingCheck",
    "packing_ratio",
    "check_loading",
    # cooling
    "AMBIENT_C",
    "QUARTZ_INVERSION_C",
    "CoolingSegment",
    "CoolingPlan",
    "natural_cooling_hours",
    "plan_cooling",
    # simulator
    "Disturbance",
    "SimStep",
    "KilnSimulator",
    # controller
    "Phase",
    "OuterMode",
    "ControlDecision",
    "SegmentedController",
    "WATCHING_FRACTION",
]
