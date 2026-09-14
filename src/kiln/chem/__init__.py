"""kiln.chem — 04절(4-3 Stull) · 05-1절 조성 화학.

원료 산화물 분석(:mod:`kiln.chem.materials`), UMF 계산
(:mod:`kiln.chem.umf`), Stull 참조 분류(:mod:`kiln.chem.stull`)를 묶는다.
경계·판정 규칙은 각 모듈과 ``CLAUDE.md`` 를 참조.
"""

from kiln.chem.materials import Material, MATERIALS, material
from kiln.chem.stull import ConePreset, StullReading, StullZone, classify
from kiln.chem.umf import UMF, unity_formula, unity_formula_from_materials

__all__ = [
    "Material",
    "MATERIALS",
    "material",
    "UMF",
    "unity_formula",
    "unity_formula_from_materials",
    "StullZone",
    "ConePreset",
    "StullReading",
    "classify",
]
