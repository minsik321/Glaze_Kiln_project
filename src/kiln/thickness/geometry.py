"""7-1절 · 파푸스·굴딘 표면적과 벽면 경사각.

기물 형태(:class:`~kiln.domain.models.WareShape`)는 굽(z=0)에서 구연부까지
이어지는 ``(z, r)`` 점열이다. 이 모듈은 그 점열을 **원추대(frustum)의 연속**
으로 보고, 각 구간의 측면적을 파푸스·굴딘 정리의 닫힌 형으로 정확히 계산한다.

    A = ∫ 2πr(z)·√(1+(dr/dz)²) dz

를 구간마다 이산화해 근사하지 않는다. 직선 구간(원추대) 하나의 회전 측면적은

    ΔA = π(r₀+r₁)·√((r₁−r₀)²+(z₁−z₀)²)

로 닫힌 형이 있고, 위 적분을 그 구간에서 정확히 계산한 값과 같다(파푸스·굴딘
정리: 모선을 회전축 둘레로 회전시킨 넓이 = 모선 길이 × 무게중심이 그리는
원둘레). 점열 자체가 실제 곡면을 선형 근사한 것이므로, 오차는 형태를
몇 개의 점으로 나누었는지에서만 온다 — 적분을 이산화해서 생기는 오차는
추가로 생기지 않는다.
"""

from __future__ import annotations

import math

from kiln.domain.models import WareShape

__all__ = ["surface_area_m2", "wall_angle"]

#: 두 면적이 사실상 0이 되는 것을 막는 하한 [m²]. 왁스 면적을 빼고 나면
#: 나눗셈(총량 제약, 위험 판정 등)에서 0으로 나누는 사고를 막는다.
_AREA_FLOOR_M2 = 1e-6


def _segment_lateral_areas_mm2(
    profile: tuple[tuple[float, float], ...],
) -> list[float]:
    """구간별(원추대) 측면적 [mm²] 목록. 길이는 ``len(profile)-1``.

    :func:`surface_area_m2` 와 :mod:`kiln.thickness.profile` 의 면적가중
    평균 계산이 이 목록을 공유한다 — 전체 면적과 부위별 가중치가 같은
    분할에서 나와야 총량 제약(7-2절)이 내적으로 일관된다.
    """
    areas = []
    for (z0, r0), (z1, r1) in zip(profile, profile[1:]):
        slant = math.hypot(r1 - r0, z1 - z0)
        areas.append(math.pi * (r0 + r1) * slant)
    return areas


def surface_area_m2(
    shape: WareShape,
    *,
    exclude_waxed_m2: float = 0.0,
    include_interior: bool = True,
) -> float:
    """파푸스·굴딘: A = ∫2πr(z)√(1+(dr/dz)²)dz. 반환 단위 m² (7-1절).

    ``include_interior=True`` 면 벽의 내측면과 외측면을 더한 것으로 보고
    파푸스·굴딘 값을 두 배 한다. **이것은 단순화다** — 실제로는 벽 두께만큼
    내측 반지름이 외측보다 작아 내측 곡면 넓이가 엄밀히는 조금 더 작지만,
    도자기 벽 두께(수 mm)가 기물 반지름(수십~수백 mm)에 비해 무시할 만해
    같은 파푸스·굴딘 값을 두 배 하는 것으로 근사한다. 내부를 시유하지 않으면
    (``ware.glaze_interior is False``) 외측면 하나만 필요하므로
    ``include_interior=False`` 로 호출한다 (7-5절 "내부 시유 여부 입력 →
    표면적 반영").

    ``exclude_waxed_m2`` 는 왁싱(발수제) 처리한 면적을 뺀다 — 왁스 부위는
    시유되지 않으므로 총량 제약의 분모 A에서 빼야 한다(7-5절). 뺀 결과가
    음수가 되면 계측 오류이므로 예외를 던지고, 아주 작은 양수까지는
    ``_AREA_FLOOR_M2`` 로 바닥을 둔다(0으로 나누는 사고 방지).
    """
    total_mm2 = sum(_segment_lateral_areas_mm2(shape.profile))
    if include_interior:
        total_mm2 *= 2.0
    area_m2 = total_mm2 / 1e6

    if exclude_waxed_m2 < 0:
        raise ValueError(f"왁스 면적이 음수다: {exclude_waxed_m2}")
    if exclude_waxed_m2 > area_m2:
        raise ValueError(
            f"왁스 면적({exclude_waxed_m2}m²)이 전체 표면적({area_m2}m²)보다 크다. "
            "계측을 확인하라"
        )
    area_m2 -= exclude_waxed_m2
    return max(area_m2, _AREA_FLOOR_M2)


def wall_angle(shape: WareShape, z: float) -> float:
    """θ(z) = arctan(dz/dr) [rad] — 벽면 경사각 (7-1절).

    v5의 실수를 반복하지 않도록 인자 순서를 주의한다: **arctan(dr/dz)가
    아니라 arctan(dz/dr)** 이다. 수직벽(dr=0, 기물 옆면)이면 θ=π/2이고,
    수평면(dz=0, 바닥처럼 평평한 면)이면 θ=0이다. t_flow(z)의
    ``sinθ(z)`` 항이 수직벽에서 최대가 되어야 흘러내림 막이 벽면에서
    두꺼워진다는 물리(6-2절)와 맞는다.

    ``dr=0`` 은 :func:`math.atan2` 로 처리해 ``ZeroDivisionError`` 를
    피한다. 경사 방향(볼록/오목)은 버리고 **크기만** 쓴다 — 부호 있는
    dr을 그대로 쓰면 위로 갈수록 좁아지는 목 부분에서 θ가 음수가 되어
    ``sinθ`` 가 음수인 두께가 나오는데, 벽이 안으로 휘든 밖으로 휘든
    흘러내림에 대한 경사 저항은 같은 크기로 다뤄야 한다.

    ``z`` 가 형태 범위 밖이면 양 끝 구간의 각도로 고정(clamp)한다.
    """
    profile = shape.profile
    z_min, z_max = profile[0][0], profile[-1][0]
    z_clamped = min(max(z, z_min), z_max)

    for (z0, r0), (z1, r1) in zip(profile, profile[1:]):
        if z0 <= z_clamped <= z1:
            dz = z1 - z0
            dr = abs(r1 - r0)
            return math.atan2(dz, dr)

    # 이론상 도달하지 않는다 (WareShape가 z 단조증가·2점 이상을 보장).
    z0, r0 = profile[0]
    z1, r1 = profile[1]
    return math.atan2(z1 - z0, abs(r1 - r0))
