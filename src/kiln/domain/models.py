"""11절 · 데이터 모델.

기획서 11절의 트리를 그대로 옮긴다. 두 가지가 설계 결정이다.

**가마 프로필은 복수로 유지한다.** 등록 실물은 1대지만 처방 변환 검증에
프로필 2종이 필요하다(12-2절). "가마 1대"는 사용자 소유 대수이지
스키마 제약이 아니다.

**비중은 배치가 아니라 순간에 귀속된다.** 비중을 재고 몇 분 뒤 담그면 이미
다르다(6-3절). 그래서 ``Batch`` 가 비중 필드를 갖지 않고
``DensityMeasurement`` 가 별도 엔티티다.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime

from kiln.domain.enums import (
    FailureType,
    GlazingMethod,
    Gloss,
    Grade,
    Transparency,
)

__all__ = [
    "TargetCoordinate",
    "GlazeRecipe",
    "Batch",
    "DensityMeasurement",
    "WareShape",
    "Ware",
    "GlazingRecord",
    "QUARTZ_INVERSION_C",
    "CoolingSegment",
    "FiringResult",
    "FiringRun",
    "KilnProfile",
    "CoefficientTable",
    "SearchState",
]


# ─── 04절 목표 좌표계 ────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class TargetCoordinate:
    """광택도 × 투명도 격자의 한 칸 (4-1절).

    사용자 화면의 좌표이자 소성 결과의 라벨이다. **둘이 같은 자료형이어야**
    5-4절 목적함수 d가 정의되고 ⑬ 되먹임이 성립한다.
    """

    gloss: Gloss
    transparency: Transparency

    def distance(
        self, other: "TargetCoordinate", w_gloss: float = 1.0, w_transparency: float = 1.0
    ) -> float:
        """5-4절 목적함수 d.

        ``d = w1·|광택도_목표 − 광택도_결과| + w2·|투명도_목표 − 투명도_결과|``

        부수 관측(색·흐름·핀홀·결정)은 d에 넣지 않는다. 가중치를 정의할 근거가
        없는 항목을 목적함수에 억지로 넣는 것보다 필터로 쓰는 편이 정직하다.
        """
        return (
            w_gloss * self.gloss.distance(other.gloss)
            + w_transparency * self.transparency.distance(other.transparency)
        )

    def __str__(self) -> str:
        return f"{self.gloss.label}/{self.transparency.label}"


# ─── 유약 레시피 · 배치 · 측정 이벤트 ────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class GlazeRecipe:
    """유약 레시피. 원료 비율만이 레시피가 정하는 것이다 (01절).

    ``materials`` 는 원료명 → 중량비(%). 합이 100이어야 한다.
    UMF·Stull 좌표는 저장하지 않고 :mod:`kiln.chem` 이 필요할 때 계산한다 —
    원료 DB가 갱신되면 저장된 좌표가 조용히 낡기 때문이다.
    """

    recipe_id: str
    name: str
    materials: dict[str, float]
    #: 8-3절: 이 유약이 기포형인지 흘러내림형인지. 등록 시 사용자 지정,
    #: 이력이 쌓이면 실제 실패 유형으로 자동 분기.
    failure_mode_hint: FailureType | None = None

    def __post_init__(self) -> None:
        if not self.materials:
            raise ValueError("레시피에 원료가 없다")
        total = sum(self.materials.values())
        if not math.isclose(total, 100.0, abs_tol=0.5):
            raise ValueError(f"원료 비율 합이 {total:.2f}%다. 100%여야 한다")
        for name, pct in self.materials.items():
            if pct < 0:
                raise ValueError(f"원료 {name!r}의 비율이 음수다: {pct}")


@dataclass(frozen=True, slots=True)
class Batch:
    """배치 — 한 번 개어둔 유약통 (6-3절).

    비중은 여기 없다. 배치가 아니라 **순간**에 귀속되기 때문이다.
    원료 로트는 산지·로트 편차 추적용 (7-5절).
    """

    batch_id: str
    recipe_id: str
    mixed_at: datetime
    #: 원료명 → 로트 번호
    material_lots: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class DensityMeasurement:
    """측정 이벤트 (6-3절).

    비중을 재고 몇 분 뒤 담그면 이미 다르다. 점토가 적은 배합일수록 침강이
    빠르다. 그래서 측정 시각과 **교반 후 경과 시간**을 함께 남긴다.
    """

    batch_id: str
    measured_at: datetime
    #: 실측 비중 [g/cm³]
    specific_gravity: float
    #: 교반 후 경과 시간 [분]
    minutes_since_stirring: float

    def __post_init__(self) -> None:
        if self.specific_gravity <= 1.0:
            raise ValueError(
                f"비중 {self.specific_gravity}는 물(1.0) 이하다. 측정을 확인하라"
            )
        if self.minutes_since_stirring < 0:
            raise ValueError("교반 후 경과 시간이 음수다")


# ─── 기물 · 시유 기록 ────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class WareShape:
    """회전체 기물의 형태 — 축 방향 제어점 열 (7-1절).

    ``profile`` 은 굽(z=0)에서 구연부로 올라가는 ``(z, r)`` 점열 [mm].
    파푸스·굴딘 표면적과 벽면 경사각이 여기서 나온다.

    회전체가 아닌 형태는 이 모델의 적용 범위 밖이다.
    """

    shape_id: str
    name: str
    profile: tuple[tuple[float, float], ...]

    def __post_init__(self) -> None:
        if len(self.profile) < 2:
            raise ValueError("형태 프로파일에 점이 2개 미만이다")
        zs = [z for z, _ in self.profile]
        if any(b <= a for a, b in zip(zs, zs[1:])):
            raise ValueError("형태 프로파일의 z가 단조증가가 아니다")
        if any(r < 0 for _, r in self.profile):
            raise ValueError("형태 프로파일에 음수 반지름이 있다")

    @property
    def h_max(self) -> float:
        """구연부 높이 [mm]. t_flow의 (h_max − z)/h_max 항에 쓴다."""
        return self.profile[-1][0]


@dataclass(frozen=True, slots=True)
class Ware:
    """기물 (11절).

    ``bisque_temperature`` 변경은 **재캘리브레이션 트리거**다 (7-5절).
    흡수율 변화로 처리하지 않는다 — 흡수율은 k₁과 곱으로만 식별되므로
    거기에 밀어 넣으면 k₁이 조용히 틀어진다.
    """

    ware_id: str
    shape: WareShape
    #: 소지 종류. 흡수율·가스방출·열팽창이 달라진다 (7-5절)
    clay_body: str
    #: 초벌 온도 [℃]
    bisque_temperature: float
    #: 투영 면적 [m²] — 9-2절 적재 점유율 산출용
    footprint_area: float = 0.0
    #: 내부 시유 여부 → 표면적에 반영 (7-5절)
    glaze_interior: bool = True


@dataclass(frozen=True, slots=True)
class GlazingRecord:
    """시유 기록 — 저울 2회가 전부다 (7-1절).

    사용자가 하는 일은 저울에 두 번 올리는 것(시유 전 / 건조 후)과
    형태 유형을 고르는 것뿐이다.
    """

    record_id: str
    ware_id: str
    batch_id: str
    method: GlazingMethod
    #: 시유 전 무게 [g]. 굽 닦기 **직전** 고정 (7-5절)
    weight_before: float
    #: 건조 후 무게 [g]
    weight_after: float
    #: 담금 시간 [s]. 담금이 아니면 None
    dip_seconds: float | None = None
    #: 시유 시점의 비중 측정 이벤트
    density: DensityMeasurement | None = None
    #: 왁스 무게는 시유 전 무게에 포함, 왁스 부위 면적은 A에서 제외 (7-5절).
    #: 미처리 시 총량 앵커가 깨진다.
    waxed_area_m2: float = 0.0
    #: 재시유 여부. True면 재습윤으로 흡수율이 변해 **모델 적용 범위 밖** (7-5절)
    is_reglaze: bool = False
    #: 건조 종료 판정 통과 여부. 잔류 수분 2%면 두께 2% 과대 (7-5절)
    drying_complete: bool = True

    @property
    def glaze_weight(self) -> float:
        """부착된 건조 유약 무게 W [g]. 총량 제약의 앵커."""
        return self.weight_after - self.weight_before

    @property
    def within_model_scope(self) -> bool:
        """모델 적용 범위 안인가 (7-5절). 아니면 신뢰도를 하향 표기한다."""
        return not self.is_reglaze and self.drying_complete

    def __post_init__(self) -> None:
        if self.weight_after < self.weight_before:
            raise ValueError(
                f"건조 후 무게({self.weight_after}g)가 시유 전"
                f"({self.weight_before}g)보다 가볍다"
            )
        if self.method is GlazingMethod.DIPPING and self.dip_seconds is None:
            raise ValueError("담금인데 담금 시간이 없다")


# ─── 결과 · 소성 회차 ────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class FiringResult:
    """10-1절 · 결과 기록 3축.

    등급과 목표 좌표는 **다른 축이다**. 좌표는 목적함수 입력이고 등급은
    전반적 방향 신호다. 부수 관측은 d에 넣지 않고 필터로만 쓴다 (5-4절).
    """

    record_id: str
    #: 축 1 — 목적함수 입력
    coordinate: TargetCoordinate
    #: 축 2 — 만족도
    grade: Grade
    #: 축 3 — 등급=실패일 때 다중 선택
    failures: frozenset[FailureType] = frozenset()
    #: 부수 관측 — 필터로만 사용
    observations: dict[str, str] = field(default_factory=dict)
    #: 파단면 실측 두께 [mm]. 있을 때만 7-7절 사후 진단과 k₂ 보정이 열린다
    fracture_thickness_mm: float | None = None
    #: 파단면을 **어디서** 쟀는가 — 굽(z=0)에서의 높이 [mm].
    #:
    #: 두께만 있고 위치가 없으면 그 값이 국소 최대인지 알 수 없어, 07절
    #: 예측과 비교할 때 "국소 최대의 하한" 이상으로 읽지 못한다. k₂는 위치별
    #: 분포에만 영향을 주는 계수이므로(7-2절 대비표), 위치가 없으면 k₂ 방향
    #: 신호가 흐려진다. 없어도 진단은 돌지만 신뢰도가 내려간다 (7-7절).
    fracture_z_mm: float | None = None

    def __post_init__(self) -> None:
        if self.fracture_z_mm is not None and self.fracture_thickness_mm is None:
            raise ValueError(
                "파단면 측정 위치만 있고 두께가 없다. 위치는 두께의 해석을 돕는 "
                "부가 정보이지 그 자체로 관측이 아니다 (7-7절)"
            )
        if self.grade is Grade.FAILED and not self.failures:
            raise ValueError("등급이 '실패'인데 실패 유형이 비어 있다")
        if self.grade is not Grade.FAILED and self.failures:
            raise ValueError(
                f"등급이 {self.grade.value!r}인데 실패 유형이 있다. "
                f"실패 유형은 등급=실패일 때만 기록한다"
            )


#: 석영 α↔β 전이 온도 [℃] (9-6절). 빠르게 통과하면 소지가 균열된다.
QUARTZ_INVERSION_C = 573.0


@dataclass(frozen=True, slots=True)
class CoolingSegment:
    """냉각 스케줄의 한 구간 (9-6절).

    ``purpose`` 는 "결정 성장" / "석영 전이 통과" 처럼 이 구간이 왜 있는지를
    적는다. 9-6절이 두 구간을 나눈 이유가 **목적이 다르기 때문**이므로,
    목적을 자료형에 남겨야 나중에 우선순위 충돌(부록 B)을 다룰 수 있다.

    **왜 도메인에 있는가**: 냉각은 H로 접히지 않고 온도–시간 곡선 그대로
    회차에 귀속되는 자료다(9-4절, 10-3절). :class:`FiringRun` 이 직접 들고
    있어야 "설정 스케줄 vs 달성 열이력"의 냉각 쪽이 데이터 모델에 표현된다.
    판정 로직(자연냉각률 상한·573℃ 분리)은 :mod:`kiln.firing.cooling` 에
    있고, 이 자료형은 거기서 그대로 재수출된다.
    """

    #: 구간 시작 온도 [℃] (높은 쪽)
    from_c: float
    #: 구간 종료 온도 [℃] (낮은 쪽)
    to_c: float
    #: 요청 냉각률 [℃/h] — 양수. 자연냉각률을 넘을 수 없다
    rate_c_per_h: float
    purpose: str = ""

    @property
    def span_c(self) -> float:
        """구간 온도 폭 [℃]."""
        return self.from_c - self.to_c

    @property
    def hours(self) -> float:
        """요청 냉각률로 이 구간을 지나는 데 걸리는 시간 [h]."""
        if self.rate_c_per_h <= 0:
            return float("inf")
        return self.span_c / self.rate_c_per_h

    @property
    def crosses_quartz_inversion(self) -> bool:
        """573℃ 석영 전이를 세그먼트 **내부**에서 가로지르는가 (9-6절)."""
        return self.from_c > QUARTZ_INVERSION_C > self.to_c


@dataclass(frozen=True, slots=True)
class FiringRun:
    """소성 회차 (11절).

    한 소성에 조성은 여러 개 시험할 수 있지만 **소성 조건은 하나뿐이다**
    (5-3절). 그래서 ``results`` 는 여럿이고 스케줄은 하나다.
    """

    run_id: str
    kiln_profile_id: str
    started_at: datetime
    #: 설정 스케줄 — (시각[s], 목표온도[℃]) 점열
    schedule: tuple[tuple[float, float], ...] = ()
    #: 실측 곡선 — (시각[s], 센서온도[℃]) 점열
    measured: tuple[tuple[float, float], ...] = ()
    #: 이 회차에 들어간 시유 기록
    record_ids: tuple[str, ...] = ()
    #: 결과 3축
    results: tuple[FiringResult, ...] = ()
    #: 적재 점유율 [0..1]
    packing_ratio: float = 0.0
    #: 냉각 계획 — **온도–시간 그대로**. H에 합산하지 않는다 (9-4절, 10-3절).
    #: ``schedule`` 과 따로 두는 이유: H는 급냉과 서냉을 구분하지 못하므로
    #: (9-4절: 둘 다 H=7801) 냉각은 접히지 않는 축으로 남아야 한다.
    cooling: tuple[CoolingSegment, ...] = ()
    #: 사용자가 등록한 적재 총 질량 [kg]. 9-2절 총량 이상 감지의 입력이다
    declared_kg: float = 0.0
    #: 선반 면적 [m²]. ``packing_ratio`` 산출의 분모 (9-2절)
    shelf_area_m2: float = 0.0


# ─── 가마 프로필 · 계수 테이블 · 탐색 상태 ───────────────────────────────────


@dataclass(frozen=True, slots=True)
class KilnProfile:
    """가마 프로필 (11절, 9-6절).

    처방 변환 검증(12-2절)에 프로필 2종이 필요하므로 복수로 유지한다.
    ``natural_cooling`` 이 9-6절의 **제어 상한**이다 — 전기가마는 서냉만
    제어 가능하고 급냉은 제어 대상이 아니다.
    """

    profile_id: str
    name: str
    #: 유효 열용량 C [J/K]
    heat_capacity: float
    #: 벽체 손실 계수 UA [W/K]
    ua: float
    #: 최대 출력 [W]
    max_power: float
    #: 자연냉각률 곡선 — 온도[℃] → 냉각률[℃/h]. 제어 상한 (9-6절)
    natural_cooling: tuple[tuple[float, float], ...] = ()
    #: 기물–센서 온도차 [K]. 미정이면 None (9-3절, 부록 C)
    sensor_offset: float | None = None
    #: 주위 온도 T_amb [℃]. 자연냉각률 물리 역산과 서냉 비용 계산이 같은
    #: 값을 써야 하므로 프로필에 둔다 — 두 곳에 따로 상수로 두면 한쪽만
    #: 바뀌었을 때 9-6절 표와 비용 계산이 조용히 어긋난다.
    ambient_c: float = 20.0
    #: 빈 가마 기준 유지전력 [W]. 9-2절 총량 이상 감지의 기준선이며,
    #: 회차마다 이 값과 관측 유지전력을 비교한다. 0이면 미등록이다.
    baseline_power_w: float = 0.0

    def natural_cooling_rate(self, temperature_c: float) -> float:
        """주어진 온도에서의 자연냉각률 [℃/h] — 선형 보간.

        곡선이 등록되지 않았으면 ``UA·(T−T_amb)/C`` 로 물리 역산한다.
        """
        if not self.natural_cooling:
            watts = self.ua * max(temperature_c - self.ambient_c, 0.0)
            return watts / self.heat_capacity * 3600.0
        pts = sorted(self.natural_cooling)
        if temperature_c <= pts[0][0]:
            return pts[0][1]
        if temperature_c >= pts[-1][0]:
            return pts[-1][1]
        for (t0, r0), (t1, r1) in zip(pts, pts[1:]):
            if t0 <= temperature_c <= t1:
                w = (temperature_c - t0) / (t1 - t0)
                return r0 + w * (r1 - r0)
        return pts[-1][1]


@dataclass(frozen=True, slots=True)
class CoefficientTable:
    """유약별 계수 테이블 (11절).

    부록 C 대장이 전역 초기값을 주고, 이 표가 **유약별로 동정된 값**을 덮는다.
    ``None`` 인 항목은 아직 동정되지 않아 대장 초기값을 쓴다는 뜻이다.
    """

    recipe_id: str
    k1: float | None = None
    k2: float | None = None
    rho_dry: float | None = None
    s: float | None = None
    m_rho: float | None = None
    #: 이 유약의 안전 두께 범위 [mm]. 실패 발생 지점 축적으로 좁혀진다 (10-2절)
    safe_thickness_mm: tuple[float, float] = (0.8, 1.3)
    #: 계수 동정에 쓰인 회차 수. 신뢰도 표기의 근거
    calibration_runs: int = 0
    #: 이 표를 동정할 때의 초벌 온도 [℃].
    #:
    #: 7-5절: **초벌 온도 변경은 재캘리브레이션 트리거다.** 흡수율 변화로
    #: 처리하면 안 된다 — 흡수율은 k₁과 곱으로만 식별되므로 거기에 밀어
    #: 넣으면 k₁이 조용히 틀어진다. 그 판정을 하려면 "언제 동정했는가"가
    #: 아니라 "**어떤 초벌 조건에서** 동정했는가"가 표에 남아 있어야 한다.
    calibrated_bisque_c: float | None = None
    #: 각 계수가 어떻게 얻어졌는지 (00절 공통 규칙 1).
    #:
    #: 값만 나르면 "가정한 ρ_dry 위에서 낸 k₁"과 "캘리퍼로 닫은 k₁"이
    #: 구분되지 않는다. 되먹임이 여러 모듈을 거치는 동안 출처가 끊기지
    #: 않게 하려고 표 자체가 들고 다닌다.
    provenance_notes: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class SearchState:
    """탐색 상태 (11절, 5-5절).

    **축적 데이터는 목표별이 아니라 조성→결과 매핑으로 저장한다.**
    목표별로 저장하면 사용자가 목표를 바꿀 때마다 리셋된다.
    """

    target: TargetCoordinate
    #: 조성(원료명→%의 정렬된 튜플) → 관측된 결과 좌표
    observations: tuple[tuple[tuple[tuple[str, float], ...], TargetCoordinate], ...] = ()
    #: 현재 격자 간격 [%p]. 10 → 5 → 2 (5-2절)
    grid_step: float = 10.0
    #: 목적함수 가중 (5-4절)
    w_gloss: float = 1.0
    w_transparency: float = 1.0
