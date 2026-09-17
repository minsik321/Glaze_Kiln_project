"""kiln.calibration — 7-3절 · 10-2절 · 계수 보정.

되먹임 고리의 마지막 칸이다. 회차가 남긴 저울 눈금과(있다면) 캘리퍼·파단면
실측을 받아 :class:`~kiln.domain.models.CoefficientTable` 을 조금 좁힌다.

이 모듈이 주장하는 것은 하나다 — **저울 두 번으로 k1이 좁혀지고, 캘리퍼
1회로 ρ_dry가 닫힌다.** 10-2절: "그것만 주장하면 반박당하지 않는다."

주장하지 **않는** 것:

- ρ_dry를 저울만으로 동정한다 (7-3절 — 곱으로 붙어 분리되지 않는다.
  캘리퍼가 없으면 ``rho_dry=None``)
- k1과 흡수율의 분리 (부록 A — 곱으로만 식별된다)
- k2와 s의 분리 (7-4절 — 같은 신호에만 영향을 준다)
- k2·Stull 경계·안전 두께 범위·위험 분기 우선순위의 수렴 (10-2절 점선)

파일 구성:

- :mod:`kiln.calibration.tiles` — 7-3절 타일 캘리브레이션(저울 회귀 + 캘리퍼)
- :mod:`kiln.calibration.update` — 10-2절 회차 되먹임, 7-5절 재캘리브레이션 트리거
- :mod:`kiln.calibration.diagnosis` — 7-4절 단위 일치 잔차, 7-7절 사후 진단
- :mod:`kiln.calibration.registry` — Phase 5 3항, 레시피별 계수 계열 저장소
- :mod:`kiln.calibration.demo_convergence` — Phase 5 2항, 20회차 합성 narrowing 시연
"""

from kiln.calibration.diagnosis import (
    DeviationDiagnosis,
    diagnose_deviation,
    residual_mm,
)
from kiln.calibration.tiles import (
    DASHED_REASONS,
    DASHED_TARGETS,
    SOLID_TARGETS,
    CalibrationResult,
    TileSample,
    calibrate_from_tiles,
    mean_thickness_from_weight,
    rho_dry_from_caliper,
)
from kiln.calibration.update import (
    RecalibrationTrigger,
    RunUpdate,
    check_bisque_change,
    run_update,
    update_after_run,
)
from kiln.calibration.registry import CoefficientTableStore
from kiln.calibration.demo_convergence import (
    ConvergenceDemoResult,
    ConvergenceRound,
    run_convergence_demo,
)

__all__ = [
    "TileSample",
    "CalibrationResult",
    "calibrate_from_tiles",
    "mean_thickness_from_weight",
    "rho_dry_from_caliper",
    "SOLID_TARGETS",
    "DASHED_TARGETS",
    "DASHED_REASONS",
    "RunUpdate",
    "RecalibrationTrigger",
    "run_update",
    "update_after_run",
    "check_bisque_change",
    "residual_mm",
    "DeviationDiagnosis",
    "diagnose_deviation",
    "CoefficientTableStore",
    "ConvergenceDemoResult",
    "ConvergenceRound",
    "run_convergence_demo",
]
