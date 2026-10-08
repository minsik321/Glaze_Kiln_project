"""07절 · 두께 산출 — 7-1 ~ 7-5절.

두 층 모델(t_abs + t_flow)로 모양(위치별 상대 두께)을 만들고, 저울 두 번
(시유 전/건조 후)에서 나오는 총량 제약으로 절대 크기를 고정한다.

    t(z)      = t_abs + t_flow(z)
    t_abs     = k1·√(담금시간)·흡수율·g(ρ)            위치 무관
    t_flow(z) = k2·m(ρ)·sinθ(z)·(h_max−z)/h_max        경사각 의존, 굽쪽이 두껍다
    총량 제약  ∫ t(z)·dA(z) = W / ρ_dry                 (7-1, 7-2절)

**7-2절이 고친 것**: v5는 "총량 제약 덕분에 평균 두께가 k2 오차와 무관하게
항상 실측과 일치한다"고 썼다. 이건 두 가지가 틀렸다.

1. 동어반복이다 — 평균은 총부피/총면적이고, 제약을 그렇게 걸었으니
   당연히 일치한다. 모델이 맞힌 게 아니라 나눗셈이다.
2. "실측과 일치"가 거짓이다 — 실제로 계산되는 값은 ``W/(A·ρ_dry)`` 인데
   ρ_dry가 v5에 없었다.

옳은 서술: **평균 두께는 W/(A·ρ_dry)로 산출되고, k2 오차와는 무관하지만
ρ_dry와 A의 정확도에는 직접 의존한다.** 총량 제약이 보장하는 것은
"모델이 분포를 어떻게 그리든 총량은 일치한다"는 **내적 정합성**이지,
실측과의 일치가 아니다. 이 모듈이 다시는 그 실수로 돌아가지 않도록,
:attr:`ThicknessProfile.mean_mm` 은 raw 모양 항을 적분한 값이 아니라
``W/(A·ρ_dry)`` 그 자체를 직접 담는다 — raw 적분값은 스케일 계수를 구하는
중간값으로만 쓰고 최종 mean_mm에는 관여하지 않는다.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from kiln import constants
from kiln.domain.models import CoefficientTable, GlazingRecord, Ware
from kiln.thickness.geometry import _segment_lateral_areas_mm2, surface_area_m2, wall_angle

__all__ = ["ThicknessPoint", "ThicknessProfile", "compute_profile", "fired_thickness"]

#: 비중 실측이 없을 때(레코드에 DensityMeasurement가 없는 경우) 쓰는 대체값.
#: g(ρ)/m(ρ) 정규화 기준점과 같다 — "비중이 딱 정규화 지점"이라고 가정하는
#: 것과 같은 뜻이므로 g(ρ)=m(ρ)=1.0이 되어 왜곡이 최소가 된다.
_RHO_FALLBACK = 1.45


@dataclass(frozen=True, slots=True)
class ThicknessPoint:
    """형태 프로파일의 한 점에서 예측한 두께 (7-1절).

    ``t_abs`` 와 ``t_flow`` 를 따로 들고 있어 나중에도 "이 두께가 흡수
    기여인지 흘러내림 기여인지" 분해해 볼 수 있다 — 7-2절의 핵심 주장
    (평균은 k2 오차와 무관, 국소값은 k2에 의존)을 사후에 검증하려면
    분해된 값이 필요하다.
    """

    z: float
    radius: float
    t_abs: float
    t_flow: float

    @property
    def total(self) -> float:
        """이 점의 예측 두께 합 [mm]."""
        return self.t_abs + self.t_flow


@dataclass(frozen=True, slots=True)
class ThicknessProfile:
    """기물 한 장의 두께 산출 결과 (7-1 ~ 7-5절)."""

    points: tuple[ThicknessPoint, ...]
    #: 시유 표면적 [m²] (왁스 제외, 내부 시유 반영 후)
    area_m2: float
    #: W/(A·ρ_dry) — 7-2절 총량 제약. k2 오차와 무관, ρ_dry·A에 직접 의존.
    mean_mm: float
    glaze_weight_g: float
    rho_dry: float
    #: 담금이 아니면 False — 부위별 분포를 지어내지 않는다 (7-5절)
    has_distribution: bool
    within_model_scope: bool
    #: 문헌 추정값 사용, 신뢰도 하향 사유 등을 담는다 (00절, 7-5절)
    provenance_notes: tuple[str, ...]

    @property
    def local_max_mm(self) -> float:
        """국소 최대 두께 [mm] — 흘러내림 판정의 근거(08절).

        분포가 없으면(``has_distribution=False``) 모든 점이 평균값으로
        채워져 있으므로 ``mean_mm`` 과 같다.
        """
        if not self.points:
            return self.mean_mm
        return max(p.total for p in self.points)

    @property
    def local_min_mm(self) -> float:
        """국소 최소 두께 [mm] — 미용융 판정의 근거(08절)."""
        if not self.points:
            return self.mean_mm
        return min(p.total for p in self.points)

    @property
    def spread_mm(self) -> float:
        """국소 최대 − 국소 최소 [mm] — 응력 균열 판정에 쓰는 편차."""
        return self.local_max_mm - self.local_min_mm

    @property
    def areal_density_g_m2(self) -> float:
        """면적당 시유량 [g/m²] — glaze_weight_g / area_m2 (LLM 프런트도어
        TODO Phase 1). mean_mm과 달리 ρ_dry 가정에 기대지 않는 불변량이다 —
        저울로 잰 무게와 시유 면적만으로 정의된다.
        """
        if self.area_m2 <= 0:
            return 0.0
        return self.glaze_weight_g / self.area_m2


def _point_area_weights_mm2(profile: tuple[tuple[float, float], ...]) -> list[float]:
    """각 프로파일 점에 인접 구간 면적의 절반씩을 배분한 가중치 [mm²].

    사다리꼴 배분: 내부 점은 앞뒤 두 구간의 절반씩, 양 끝 점은 하나뿐인
    인접 구간의 절반을 받는다. 합은 항상 전체 측면적(내외벽 배가 전)과
    같다 — :func:`kiln.thickness.geometry.surface_area_m2` 와 같은 구간
    분할(`_segment_lateral_areas_mm2`)을 공유하기 때문이다. 총량 제약의
    "면적가중 평균"이 이 가중치로 정의된다(7-2절).
    """
    seg_areas = _segment_lateral_areas_mm2(profile)
    n = len(profile)
    weights = [0.0] * n
    for i, area in enumerate(seg_areas):
        half = area / 2.0
        weights[i] += half
        weights[i + 1] += half
    return weights


def _coefficient_value(
    symbol: str, override: float | None, notes: list[str]
) -> float:
    """``override`` 가 있으면 그 값을, 없으면 대장 초기값을 쓰고 출처를 남긴다.

    부록 C 문헌 추정 초기값을 그대로 쓴 계수는 반드시 결과의
    ``provenance_notes`` 에 실려야 한다(00절 공통 규칙 1).
    """
    if override is not None:
        return override
    coeff = constants.get(symbol)
    notes.append(f"{symbol}={coeff.value} {coeff.annotation()} 사용 (미보정)")
    return coeff.value


def compute_profile(
    record: GlazingRecord, ware: Ware, coeffs: CoefficientTable | None = None
) -> ThicknessProfile:
    """시유 기록과 기물로부터 두께 분포를 산출한다 (7-1 ~ 7-5절).

    절차:

    1. 표면적 A — 왁스 면적 제외, 내부 시유 여부 반영(7-5절).
    2. 시유 방법이 분포 모델을 지원하지 않으면(``has_distribution_model``
       False, 즉 부기·분무·붓칠) **부위별 분포를 지어내지 않는다** — 모든
       점을 평균값으로 채우고 ``has_distribution=False`` 로 둔다(7-5절).
    3. 담금이면 모양 항(t_abs, t_flow)을 위치별로 계산하고, 그 면적가중
       평균이 ``W/(A·ρ_dry)`` 와 같아지도록 **전체를 한 배율로 스케일**한다
       (7-2절 총량 제약). t_abs·t_flow는 같은 배율로 스케일하므로 둘의
       합이 정확하고, 둘 사이 분해(어디서 왔는지)도 그대로 남는다.
    4. ``record.within_model_scope`` 가 False면(재시유 또는 건조 미완)
       신뢰도 하향 사유를 ``provenance_notes`` 에 남긴다(7-5절).
    """
    notes: list[str] = []

    area_m2 = surface_area_m2(
        ware.shape,
        exclude_waxed_m2=record.waxed_area_m2,
        include_interior=ware.glaze_interior,
    )

    rho_dry = _coefficient_value(
        "rho_dry", coeffs.rho_dry if coeffs is not None else None, notes
    )
    glaze_weight_g = record.glaze_weight

    # 7-2절 총량 제약의 핵심값. k2에 무관, ρ_dry·A에 직접 의존한다.
    mean_mm = glaze_weight_g / (rho_dry * area_m2 * 1000.0)

    if not record.within_model_scope:
        if record.is_reglaze:
            notes.append(
                "재시유 — 재습윤으로 흡수율이 변해 모델 적용 범위 밖이다. "
                "예측 신뢰도를 하향한다 (7-5절, 8-4절)"
            )
        if not record.drying_complete:
            notes.append(
                "건조 종료 판정을 통과하지 못했다 — 잔류 수분이 남아 있으면 "
                "두께가 과대 추정될 수 있다 (7-5절: 잔류 수분 2%면 두께 2% 과대)"
            )

    profile_pts = ware.shape.profile

    if not record.method.has_distribution_model:
        # 7-5절: 담금이 아니면 분포 모델이 작동하지 않는다. 부위별 분포를
        # 지어내는 대신 총량(=평균)만 신뢰하고 모든 점을 평균값으로 채운다.
        points = tuple(
            ThicknessPoint(z=z, radius=r, t_abs=mean_mm, t_flow=0.0)
            for z, r in profile_pts
        )
        return ThicknessProfile(
            points=points,
            area_m2=area_m2,
            mean_mm=mean_mm,
            glaze_weight_g=glaze_weight_g,
            rho_dry=rho_dry,
            has_distribution=False,
            within_model_scope=record.within_model_scope,
            provenance_notes=tuple(notes),
        )

    # ── 여기서부터는 담금 전용 분포 모델 ────────────────────────────────
    k1 = _coefficient_value("k1", coeffs.k1 if coeffs is not None else None, notes)
    k2 = _coefficient_value("k2", coeffs.k2 if coeffs is not None else None, notes)
    absorption = _coefficient_value("absorption", None, notes)
    m_exp = _coefficient_value(
        "m_rho", coeffs.m_rho if coeffs is not None else None, notes
    )
    g_exp = _coefficient_value("g_rho", None, notes)

    if record.density is not None:
        rho = record.density.specific_gravity
    else:
        rho = _RHO_FALLBACK
        notes.append(
            f"비중 실측 없음 — 정규화 기준값 {_RHO_FALLBACK}로 가정 (g(ρ)=m(ρ)=1.0)"
        )

    dip_seconds = record.dip_seconds
    assert dip_seconds is not None  # GlazingRecord.__post_init__이 보장한다

    g_val = (rho / 1.45) ** g_exp
    m_val = (rho / 1.45) ** m_exp
    t_abs_raw = k1 * math.sqrt(dip_seconds) * absorption * g_val

    h_max = ware.shape.h_max
    raw_points: list[tuple[float, float, float, float]] = []  # z, r, t_abs, t_flow
    for z, r in profile_pts:
        if h_max > 0:
            theta = wall_angle(ware.shape, z)
            height_factor = max(h_max - z, 0.0) / h_max
            t_flow_raw = k2 * m_val * math.sin(theta) * height_factor
        else:
            t_flow_raw = 0.0
        raw_points.append((z, r, t_abs_raw, t_flow_raw))

    weights = _point_area_weights_mm2(profile_pts)
    total_weight = sum(weights)
    raw_weighted_sum = sum(
        w * (t_abs_raw + t_flow_raw)
        for w, (_, _, t_abs_raw, t_flow_raw) in zip(weights, raw_points)
    )
    raw_mean = raw_weighted_sum / total_weight if total_weight > 0 else 0.0

    if raw_mean > 0:
        scale = mean_mm / raw_mean
        points = tuple(
            ThicknessPoint(
                z=z, radius=r, t_abs=t_abs_raw * scale, t_flow=t_flow_raw * scale
            )
            for z, r, t_abs_raw, t_flow_raw in raw_points
        )
    else:
        # 모양 항이 모두 0인 퇴화 사례(예: 담금시간 0). 총량만 신뢰해
        # 균일 분포로 대체한다 — 분포 모델이 지어낼 형태가 없기 때문이다.
        notes.append("모양 항(t_abs+t_flow)이 0이라 균일 분포로 대체했다")
        points = tuple(
            ThicknessPoint(z=z, radius=r, t_abs=mean_mm, t_flow=0.0)
            for z, r, _, _ in raw_points
        )

    return ThicknessProfile(
        points=points,
        area_m2=area_m2,
        mean_mm=mean_mm,
        glaze_weight_g=glaze_weight_g,
        rho_dry=rho_dry,
        has_distribution=True,
        within_model_scope=record.within_model_scope,
        provenance_notes=tuple(notes),
    )


def fired_thickness(green_mm: float, s: float | None = None) -> float:
    """7-4절: 소성 후 두께 = 생 두께 × s (s < 1, 압밀 계수).

    예측 모델이 계산하는 것은 **생유약 두께**이고, 파단면 실측으로 얻는
    것은 **소성 후 유리질층 두께**다. 소성 중 유약층은 압밀되어 얇아지므로
    그대로 빼서 오차로 쓰면 k2가 반대 방향으로 수렴한다 — 그래서 반드시
    이 함수를 거쳐 같은 단위로 맞춘 뒤 비교해야 한다.

    **s와 k2는 분리 동정되지 않는다.** 둘 다 같은 신호인 파단면 두께에만
    영향을 준다 — s가 크면(덜 압밀) k2가 작아도 되고, s가 작으면(더 압밀)
    k2가 커야 같은 파단면 두께가 나온다. 이 축퇴 때문에 s는 회차마다
    역산하지 않고 **유약별 고정 상수**로 부록 C에 등록해 둔다(7-4절).
    """
    s_val = s if s is not None else constants.get("s").value
    return green_mm * s_val
