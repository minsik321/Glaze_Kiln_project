"""7-3절 · 캘리브레이션 — 저울 + 캘리퍼.

기획서 7-3절이 이 파일의 전부다:

    1. 평평한 타일 3~4장을 서로 다른 담금시간으로 시유
    2. 건조 후 무게 측정        → k1 회귀
    3. 건조 후 두께 캘리퍼 측정 → ρ_dry = W/(A·t)
       * 파괴 불필요, 소성 불필요, 도구는 캘리퍼 1개

**저울만으로는 ρ_dry를 식별할 수 없다.** 무게 데이터에서 ρ_dry와 평균두께는
곱으로 붙어 분리되지 않는다. 저울이 주는 것은 면적당 무게의 기울기

    C = W/(A·√t_dip)      [g/(m²·√s)]      = 1000·ρ_dry·k1·흡수율·g(ρ)

하나뿐이고, 여기서 k1을 꺼내려면 ρ_dry를 어딘가에서 가져와야 한다. 그래서
캘리퍼 실측이 하나도 없으면 이 모듈은 ``rho_dry=None`` 을 돌려주고 사유를
``notes`` 에 적는다. 조용히 대장 초기값으로 메우고 "ρ_dry를 동정했다"고
말하지 않는다 — 그 한 줄이 7-3절이 명세서의 핵심이라고 말하는 이유다.

**부록 A**: k1과 흡수율은 곱으로만 식별된다. 흡수율을 1.0으로 고정하고 k1이
곱을 흡수하며, 이 파일은 어디서도 둘을 분리했다고 주장하지 않는다.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from kiln import constants
from kiln.batch.density import g_rho

__all__ = [
    "TileSample",
    "CalibrationResult",
    "calibrate_from_tiles",
    "mean_thickness_from_weight",
    "rho_dry_from_caliper",
    "SOLID_TARGETS",
    "DASHED_TARGETS",
    "DASHED_REASONS",
]


#: 10-2절 실선 — 신호 획득 비용이 낮아 실제로 좁혀지는 계수.
#: k1: 무게 역산 · **매 회차, 저울만** / ρ_dry: 캘리퍼 1회.
SOLID_TARGETS: tuple[str, ...] = ("k1", "rho_dry")

#: 10-2절 점선 — 신호가 파괴적이거나(파단면), 이항 사건이 수십 회차 쌓여야
#: 움직이는 대상. **이 모듈은 이들을 동정하지 않는다.**
DASHED_TARGETS: tuple[str, ...] = (
    "k2",
    "stull_boundary",
    "safe_thickness_mm",
    "risk_priority",
)

#: 점선인 이유(10-2절 표의 「필요 신호 / 획득 비용」 열).
DASHED_REASONS: dict[str, str] = {
    "k2": "파단면 관찰 — 파괴 필요, s와 분리 동정 불가 (7-4절, 부록 A)",
    "stull_boundary": "표면 유형 라벨 축적 — 라벨 오차가 ±1단계를 넘으면 무의미 (4-3절)",
    "safe_thickness_mm": "실제 실패 발생 지점 — 이항 사건이라 수십 회차 필요 (08절)",
    "risk_priority": "실패 유형 분류 — 안전 두께 범위보다 더 많은 회차가 필요 (8-3절)",
}

#: 그램·제곱미터·밀리미터를 g/cm³ 와 잇는 환산 상수.
#: 부피[cm³] = A[m²]·t[mm]·1000 이므로 ρ[g/cm³] = W/(A·t·1000).
_MM_M2_TO_CM3 = 1000.0


@dataclass(frozen=True, slots=True)
class TileSample:
    """캘리브레이션 타일 1장 (7-3절).

    **평평한** 타일이라는 점이 조건이다 — 경사각 θ≈0이면
    ``t_flow = k2·m(ρ)·sinθ·(h_max−z)/h_max`` 항이 사라져 남는 것이
    ``t_abs = k1·√(담금시간)·흡수율·g(ρ)`` 뿐이다. k2를 모른 채 k1만
    회귀할 수 있는 이유가 여기 있다(7-1절).

    ``caliper_mm`` 은 건조 후 캘리퍼 실측 두께다. **없어도 k1 회귀는 돌지만
    ρ_dry는 나오지 않는다**(7-3절).
    """

    dip_seconds: float
    area_m2: float
    #: 건조 유약 무게 W [g] — 시유 전/건조 후 저울 2회의 차이
    glaze_weight_g: float
    #: 건조 후 캘리퍼 실측 두께 [mm]. 파괴·소성 불필요
    caliper_mm: float | None = None

    def __post_init__(self) -> None:
        if self.dip_seconds < 0:
            raise ValueError(f"담금 시간이 음수다: {self.dip_seconds}")
        if self.area_m2 <= 0:
            raise ValueError(f"타일 면적이 0 이하다: {self.area_m2}")
        if self.glaze_weight_g < 0:
            raise ValueError(f"부착 유약 무게가 음수다: {self.glaze_weight_g}")
        if self.caliper_mm is not None and self.caliper_mm <= 0:
            raise ValueError(f"캘리퍼 실측 두께가 0 이하다: {self.caliper_mm}")

    @property
    def areal_weight(self) -> float:
        """면적당 부착 무게 W/A [g/m²] — 저울만으로 관측되는 양."""
        return self.glaze_weight_g / self.area_m2


@dataclass(frozen=True, slots=True)
class CalibrationResult:
    """캘리브레이션 1회의 결과 (7-3절 · 10-2절).

    ``solid`` / ``dashed`` 가 10-2절 표를 그대로 나른다. **이 결과로 실제
    좁혀진 것만 실선**이고, 파단면·라벨·실패 사건이 있어야 움직이는 것들은
    이 모듈이 손대지 않으므로 언제나 점선으로 남는다. 화면이 k2를 k1과 같은
    굵기로 그리면 "저울 두 번으로 k1이 수렴한다"는 단 하나의 방어 가능한
    주장까지 같이 의심받는다(10-2절).
    """

    k1: float | None
    rho_dry: float | None
    #: 회귀 잔차의 RMS [mm]. ρ_dry가 가정값이면 그 가정에 비례해 스케일된다.
    residual_rms: float
    n_samples: int
    notes: tuple[str, ...]
    #: 10-2절 실선 표기 대상 — 이번 결과로 실제 동정된 것만 들어간다
    solid: tuple[str, ...]
    #: 10-2절 점선 표기 대상 — 이 모듈이 동정하지 않는 것
    dashed: tuple[str, ...]
    #: 저울만으로 식별되는 기울기 C = W/(A·√t_dip) [g/(m²·√s)].
    #: ``C = 1000·ρ_dry·k1·흡수율·g(ρ)`` 이므로 **ρ_dry 가정과 무관한 불변량**이다.
    #: ρ_dry를 무엇으로 가정하든 이 값은 같고 k1만 반비례로 움직인다(7-3절).
    areal_slope: float | None = None


def mean_thickness_from_weight(
    glaze_weight_g: float, area_m2: float, rho_dry: float
) -> float:
    """7-2절 총량 제약: 평균 두께 = ``W/(A·ρ_dry)`` [mm].

    v5의 "총량 제약 때문에 평균 두께는 항상 실측과 일치한다"는 서술은
    동어반복이자 거짓이었다. 실제로 계산되는 값은 ``W/(A·ρ_dry)`` 이고,
    **ρ_dry 하나로 08절 안전창(0.8–1.3mm)이 한 칸 통째로 이동한다**:

        W=96g, A=0.060 m²  →  ρ_dry=1.3 → 1.23mm  1.5 → 1.07mm  1.7 → 0.94mm

    캘리브레이션 쪽에서 이 함수가 필요한 이유는 방향이 반대이기 때문이다 —
    타일에서는 두께가 관측(캘리퍼)이고 ρ_dry가 미지수다.
    """
    if area_m2 <= 0:
        raise ValueError(f"면적이 0 이하다: {area_m2}")
    if rho_dry <= 0:
        raise ValueError(f"ρ_dry가 0 이하다: {rho_dry}")
    return glaze_weight_g / (rho_dry * area_m2 * _MM_M2_TO_CM3)


def rho_dry_from_caliper(
    glaze_weight_g: float, area_m2: float, caliper_mm: float
) -> float:
    """7-3절 3단계: ``ρ_dry = W/(A·t)`` [g/cm³].

    캘리퍼 1개, 파괴 불필요, 소성 불필요. 이 한 줄이 저울만으로는 닫히지
    않는 축퇴(ρ_dry × 평균두께)를 여는 유일한 관측이다.
    """
    if area_m2 <= 0:
        raise ValueError(f"면적이 0 이하다: {area_m2}")
    if caliper_mm <= 0:
        raise ValueError(f"캘리퍼 두께가 0 이하다: {caliper_mm}")
    return glaze_weight_g / (area_m2 * caliper_mm * _MM_M2_TO_CM3)


def _fit_slope_through_origin(xs: list[float], ys: list[float]) -> float | None:
    """원점을 지나는 1파라미터 최소제곱 (정규방정식).

    모델이 ``y = C·x`` 이므로 절편이 없다 — 담금시간이 0이면 부착량도 0이다.
    정규방정식은 ``C·Σx² = Σxy``. 순수 stdlib, 서드파티 없음.
    """
    sxx = sum(x * x for x in xs)
    if sxx <= 0:
        return None
    sxy = sum(x * y for x, y in zip(xs, ys))
    return sxy / sxx


def calibrate_from_tiles(
    samples,
    *,
    rho: float,
    absorption: float = 1.0,
) -> CalibrationResult:
    """타일 3~4장에서 k1과 ρ_dry를 동정한다 (7-3절 · 10-2절).

    ① 저울: ``y_i = W_i/A_i`` 를 ``x_i = √(담금시간_i)·흡수율·g(ρ)`` 에
    원점 통과 최소제곱으로 회귀해 기울기 ``C`` 를 얻는다. 이것이 저울이
    주는 전부이며, ``C = 1000·ρ_dry·k1·흡수율·g(ρ)`` 로 **ρ_dry와 k1이
    곱으로 붙어 있다**.

    ② 캘리퍼: ``ρ_dry = ΣW / Σ(A_i·t_i)`` (질량가중 = 총무게/총부피).
    캘리퍼 실측이 **하나도 없으면 ρ_dry는 None** 이고 사유가 ``notes`` 에
    남는다. 그 경우 k1은 대장 초기값 ρ_dry(문헌 추정)를 **가정해** 산출하고,
    가정했다는 사실 역시 ``notes`` 에 실린다(00절: 조용한 기본값 금지).

    ③ 10-2절 실선/점선: 이번 회에 실제 동정된 것만 ``solid`` 에 넣는다.
    k2·Stull 경계·안전 두께 범위·위험 분기 우선순위는 이 절차가 손대지
    못하므로 언제나 ``dashed`` 다.

    **주장하지 않는 것**: k1과 흡수율의 분리(부록 A — 곱으로만 식별된다),
    k2와 s의 분리(7-4절), g(ρ)의 함수형(부록 C — 멱함수로 잠정).

    :param rho: 시유 시점의 슬립 비중 [g/cm³]. g(ρ) 항에 들어간다.
    :param absorption: 소지 흡수 특성. 부록 A에 따라 1.0 고정이 기본이며,
        1.0이 아닌 값을 넣어도 k1과 곱으로만 식별된다는 사실은 변하지 않는다.
    """
    tiles = list(samples)
    notes: list[str] = []
    n = len(tiles)

    notes.append(
        f"부록 A: k1과 흡수율은 곱으로만 식별된다. 흡수율={absorption}로 고정하고 "
        f"k1이 곱을 흡수한다 — 둘을 분리 동정했다고 주장하지 않는다"
    )

    g_val = g_rho(rho)
    notes.append(
        f"g(ρ={rho}) = {g_val:.4f} — 부록 C: 함수형 미정, 멱함수로 잠정 "
        f"(문헌 추정 초기값 · 캘리브레이션 전)"
    )

    # ── ② 캘리퍼 → ρ_dry (7-3절 3단계) ──────────────────────────────────
    calipered = [t for t in tiles if t.caliper_mm is not None]
    rho_dry: float | None
    if calipered:
        total_w = sum(t.glaze_weight_g for t in calipered)
        total_volume_cm3 = sum(
            t.area_m2 * t.caliper_mm * _MM_M2_TO_CM3 for t in calipered
        )
        if total_volume_cm3 > 0 and total_w > 0:
            rho_dry = total_w / total_volume_cm3
            notes.append(
                f"ρ_dry = W/(A·t) = {rho_dry:.4f} g/cm³ — 캘리퍼 {len(calipered)}장 "
                f"질량가중(총무게/총부피). 파괴·소성 불필요 (7-3절)"
            )
        else:
            rho_dry = None
            notes.append(
                "캘리퍼 타일의 무게 또는 부피가 0이다 — ρ_dry를 산출할 수 없다"
            )
    else:
        rho_dry = None
        notes.append(
            "캘리퍼 실측이 하나도 없다 — 저울만으로는 ρ_dry를 식별할 수 없다. "
            "무게 데이터에서 ρ_dry와 평균두께는 곱으로 붙어 분리되지 않는다(7-3절). "
            "ρ_dry=None으로 남긴다. 평평한 타일 1장을 캘리퍼로 재면 열린다"
        )

    # ── ① 저울 → 기울기 C (7-3절 2단계) ────────────────────────────────
    xs: list[float] = []
    ys: list[float] = []
    used: list[TileSample] = []
    for t in tiles:
        if t.dip_seconds <= 0:
            notes.append(
                f"담금시간 0인 타일(W={t.glaze_weight_g}g)은 회귀에서 제외했다 "
                "— √0=0이라 기울기에 정보를 주지 않는다"
            )
            continue
        xs.append(math.sqrt(t.dip_seconds) * absorption * g_val)
        ys.append(t.areal_weight)
        used.append(t)

    areal_slope = _fit_slope_through_origin(xs, ys)

    if areal_slope is None:
        notes.append(
            "회귀 가능한 타일이 없다 — 서로 다른 담금시간의 타일 3~4장이 필요하다 (7-3절)"
        )
        for target in DASHED_TARGETS:
            notes.append(f"점선 — {target}: {DASHED_REASONS[target]}")
        return CalibrationResult(
            k1=None,
            rho_dry=rho_dry,
            residual_rms=0.0,
            n_samples=n,
            notes=tuple(notes),
            solid=("rho_dry",) if rho_dry is not None else (),
            dashed=DASHED_TARGETS,
            areal_slope=None,
        )

    if len(used) < 3:
        notes.append(
            f"회귀에 쓴 타일이 {len(used)}장이다 — 7-3절은 3~4장을 요구한다. "
            "기울기 1개를 1~2점으로 맞추면 잔차가 0이 되어 신뢰도를 가늠할 수 없다"
        )

    # ── ρ_dry로 기울기를 k1으로 환산 ────────────────────────────────────
    if rho_dry is not None:
        rho_dry_used = rho_dry
    else:
        coeff = constants.get("rho_dry")
        rho_dry_used = coeff.value
        notes.append(
            f"k1 산출에 ρ_dry={rho_dry_used} {coeff.annotation()}을 가정했다. "
            f"저울만으로 식별된 것은 기울기 C={areal_slope:.2f} g/(m²·√s) = "
            f"1000·ρ_dry·k1·흡수율·g(ρ) 뿐이며 이 값은 ρ_dry 가정과 무관한 불변량이다. "
            f"ρ_dry가 가정의 X배면 k1은 1/X배로 움직인다"
        )

    k1 = areal_slope / (_MM_M2_TO_CM3 * rho_dry_used)

    # 잔차는 두께 단위[mm]로 낸다 — 사용자가 읽는 단위가 mm이고, 08절 안전
    # 범위(0.8–1.3mm)와 같은 축 위에 있어야 크기를 가늠할 수 있다.
    sq = 0.0
    for t, x in zip(used, xs):
        observed_mm = mean_thickness_from_weight(
            t.glaze_weight_g, t.area_m2, rho_dry_used
        )
        predicted_mm = k1 * x
        sq += (predicted_mm - observed_mm) ** 2
    residual_rms = math.sqrt(sq / len(used))

    notes.append(
        f"k1 = C/(1000·ρ_dry) = {k1:.5f} mm/√s — 원점 통과 최소제곱, 타일 {len(used)}장. "
        f"10-2절: 이 신호는 매 회차·저울만으로 얻어지므로 실선이다"
    )

    solid = tuple(
        s
        for s in SOLID_TARGETS
        if s == "k1" or (s == "rho_dry" and rho_dry is not None)
    )
    for target in DASHED_TARGETS:
        notes.append(f"점선 — {target}: {DASHED_REASONS[target]}")

    return CalibrationResult(
        k1=k1,
        rho_dry=rho_dry,
        residual_rms=residual_rms,
        n_samples=n,
        notes=tuple(notes),
        solid=solid,
        dashed=DASHED_TARGETS,
        areal_slope=areal_slope,
    )
