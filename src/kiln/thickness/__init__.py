"""kiln.thickness — 07절 · 두께 산출.

기물 형태의 표면적·경사각(:mod:`kiln.thickness.geometry`)과, 그로부터
위치별 두께 분포를 산출하는 총량 제약 모델(:mod:`kiln.thickness.profile`)을
담는다. 사용자가 하는 일은 저울에 두 번 올리는 것(시유 전/건조 후)과
형태 유형을 고르는 것뿐이다(7-1절).

이 모듈은 :mod:`kiln.batch` (비중·담금시간)에 의존하고, :mod:`kiln.risk`·
:mod:`kiln.calibration` 이 이 모듈에 의존한다(docs/INTERFACES.md 의존 방향).
"""

from kiln.thickness.geometry import surface_area_m2, wall_angle
from kiln.thickness.profile import (
    ThicknessPoint,
    ThicknessProfile,
    compute_profile,
    fired_thickness,
)

__all__ = [
    "surface_area_m2",
    "wall_angle",
    "ThicknessPoint",
    "ThicknessProfile",
    "compute_profile",
    "fired_thickness",
]
