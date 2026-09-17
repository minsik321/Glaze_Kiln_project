"""AICE 화면의 가상 제어기 패널이 부르는 물리 판정 코어 경계.

`app/react/aice/curvePlan.ts`의 `simulateController`가 예전에는 브라우저
안에서 순수 TypeScript 합성 PID로 계산했다. 이 모듈은 그 자리를
`kiln.firing.controller.SegmentedController`(9-4·9-5절 구간별 제어)와
`kiln.firing.simulator.KilnSimulator`(12-2절 오지정 3노드 생성기)로
대체한다 — Pyodide 브리지가 아니라 백엔드 API 경계로 연결한다
(`src/kiln`은 이제 백엔드에서만 쓰인다, `densityAdvice.ts` 참고).

가마 프로필은 9-6절 예제("30L 전기가마", C=58kJ/K, 1220℃ 유지전력 2.5kW에서
UA 역산)를 그대로 쓴다 — `tests/firing/test_controller.py::KILN_30L`과
값이 같다. 이 화면은 특정 사용자의 등록된 가마가 아니라 비교용 예시이므로
고정 프로필이 맞다.

``E``는 부록 C 미정 계수라 반드시 ``.assume()``으로 가정을 세워야 하고,
그 사실이 ``e_note``/``provenance_notes``에 실려 응답과 함께 나간다.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from kiln import constants
from kiln.batch.dip_time import DipRecommendation, recommend_dip_time as _recommend_dip_time
from kiln.calibration.firing import (
    FiringCoefficientTable,
    FiringRunUpdate,
    update_after_evaluated_run,
)
from kiln.calibration.update import RunUpdate, run_update
from kiln.domain.enums import GlazingMethod
from kiln.domain.models import (
    CoefficientTable,
    DensityMeasurement,
    GlazingRecord,
    KilnProfile,
    Ware,
    WareShape,
)
from kiln.firing.controller import SegmentedController
from kiln.firing.simulator import Disturbance, KilnSimulator
from kiln.thickness.profile import ThicknessProfile, compute_profile

__all__ = [
    "KILN_30L",
    "E_ASSUMPTION_REASON",
    "ControlSample",
    "SimulationResult",
    "simulate",
    "WARE_PROFILES",
    "compute_thickness",
    "recommend_dip_time",
    "coefficient_table_to_dict",
    "coefficient_table_from_dict",
    "apply_calibration_run",
    "firing_coefficient_table_to_dict",
    "firing_coefficient_table_from_dict",
    "apply_firing_calibration_update",
]

#: 7개 AICE `WarePreset`의 대표 형태 — 굽(z=0)에서 구연부까지 (z, r) [mm].
#: `src/kiln/webapp/bridge.py::PRESET_SHAPES`(cylinder/bowl/vase/tile)를
#: 그대로 재사용하고, AICE 카탈로그(`app/react/aice/catalog.ts`)에만 있는
#: plate/mug/bottle/other는 같은 정신(문헌·대표값 근사, 정밀 치수 아님)으로
#: 새로 추가한다. 치수는 `app/react/aice/arealDensity.ts`의
#: `REPRESENTATIVE_AREA_M2` 스케일과 크게 어긋나지 않도록 잡았다 — 두
#: 근사가 같은 자릿수를 가리켜야 이번 배선 전후로 화면 수치가 연속적이다.
WARE_PROFILES: dict[str, tuple[tuple[float, float], ...]] = {
    "bowl": ((0.0, 25.0), (15.0, 45.0), (40.0, 65.0), (70.0, 75.0)),
    "plate": ((0.0, 20.0), (5.0, 90.0), (12.0, 100.0)),
    "mug": ((0.0, 30.0), (90.0, 30.0)),
    "cylinder_vase": ((0.0, 30.0), (40.0, 55.0), (120.0, 60.0), (170.0, 25.0)),
    "bottle": ((0.0, 28.0), (40.0, 55.0), (110.0, 55.0), (140.0, 20.0)),
    "tile": ((0.0, 40.0), (3.0, 40.0)),
    # 형상 미상 — 카탈로그 중앙값에 해당하는 사발 근사를 그대로 쓴다
    # (`arealDensity.ts`의 `other: 0.045`와 같은 taktik: 미상일 때 중간값).
    "other": ((0.0, 25.0), (15.0, 45.0), (40.0, 65.0), (70.0, 75.0)),
}

#: `GlazingMethod` 라벨(한국어) → enum. `app/react/aice/*`에서 오는 요청 바디는
#: 한국어 라벨을 그대로 쓴다(`domain/enums.py::GlazingMethod` 값과 동일).
_METHOD_BY_LABEL: dict[str, GlazingMethod] = {m.value: m for m in GlazingMethod}

#: 9-6절 예제 그대로. `tests/firing/test_controller.py::KILN_30L`과 동일.
KILN_30L = KilnProfile(
    profile_id="30L",
    name="30L 전기가마 (9-6절 예제)",
    heat_capacity=58_000.0,
    ua=2500.0 / (1220.0 - 20.0),
    max_power=6000.0,
)

#: `tests/test_constants.py::test_assume_keeps_provenance_undetermined`와
#: `tests/exchange/test_prescription.py::_E`가 이미 쓰는 가정과 같은 문구를
#: 재사용한다 — 같은 가정을 여러 곳에서 다른 말로 적으면 그 자체가 조용한
#: 값 확정처럼 읽힌다.
E_ASSUMPTION_REASON = "9-5절 외측 루프 운용을 위한 가정"
E_ASSUMED_VALUE = 300_000.0


@dataclass(frozen=True, slots=True)
class ControlSample:
    """한 스텝의 응답 — `SimStep`과 그 스텝을 만든 `ControlDecision`을 합친다."""

    t_s: float
    sensor_c: float
    ware_c: float
    power_w: float
    phase: str
    outer_mode: str
    hold_extension_s: float
    message: str
    paused: bool


@dataclass(frozen=True, slots=True)
class SimulationResult:
    samples: tuple[ControlSample, ...]
    provenance_notes: tuple[str, ...]
    e_note: str
    target_heat_work: float
    peak_c: float
    max_power_w: float


def simulate(
    schedule_minutes: list[tuple[float, float]],
    disturbance: Disturbance,
    dt_s: float,
) -> SimulationResult:
    """`schedule_minutes`((분, 목표온도[℃]) 점열)을 초 단위로 바꿔 돌린다.

    `KilnSimulator.run()`을 그대로 쓰지 않는 이유: `run()`은
    `SimStep`만 반환하고, 그 스텝을 만든 `ControlDecision`(구간·모드·문구)은
    버린다. 화면은 둘 다 필요하므로 `run()`의 본문과 같은 루프를 직접
    돌면서 매 스텝의 결정과 결과를 함께 담는다.
    """
    schedule_s = tuple((minute * 60.0, temp_c) for minute, temp_c in schedule_minutes)
    profile = KILN_30L
    e_coeff = constants.get("E").assume(E_ASSUMED_VALUE, E_ASSUMPTION_REASON)
    controller = SegmentedController(profile, schedule_s, E=e_coeff.value)
    sim = KilnSimulator(profile, disturbance, initial_c=schedule_s[0][1])

    duration_s = schedule_s[-1][0]
    last_sensor_c = schedule_s[0][1]
    samples: list[ControlSample] = []
    remaining = duration_s
    while remaining > 1e-9:
        span = min(dt_s, remaining)
        decision = controller.decide(sim.t, last_sensor_c, span)
        step = sim.step(decision.power_w, span)
        samples.append(
            ControlSample(
                t_s=step.t,
                sensor_c=step.sensor_c,
                ware_c=step.ware_c,
                power_w=step.power_w,
                phase=decision.phase.value,
                outer_mode=decision.outer_mode.value,
                hold_extension_s=decision.hold_extension_s,
                message=decision.message,
                paused=decision.paused,
            )
        )
        last_sensor_c = step.sensor_c
        remaining -= span

    return SimulationResult(
        samples=tuple(samples),
        provenance_notes=sim.provenance_notes,
        e_note=controller.e_note,
        target_heat_work=controller.target_heat_work,
        peak_c=controller.peak_c,
        max_power_w=profile.max_power,
    )


# ─── 07절 두께 산출 — AICE 두께 종단면 화면의 물리 판정 코어 경계 ─────────────


def compute_thickness(
    *,
    ware_preset: str,
    weight_before_g: float,
    weight_after_g: float,
    method: str,
    dip_seconds: float | None = None,
    specific_gravity: float | None = None,
    waxed_area_m2: float = 0.0,
    is_reglaze: bool = False,
    drying_complete: bool = True,
    glaze_interior: bool = True,
) -> ThicknessProfile:
    """`app/react/aice/thicknessView.ts`·`arealDensity.ts`가 부르는 07절 경계.

    `WARE_PROFILES`의 대표 형상(문헌·대표값 근사, 실측 치수 아님)으로
    `WareShape`를 만들고 `kiln.thickness.profile.compute_profile`을 그대로
    돌린다 — 07절 공식(t_abs/t_flow/총량 제약)을 다시 구현하지 않는다.
    비중·담금시간이 없으면 `compute_profile` 자체가 안전한 가정으로
    떨어지고 그 사실을 `provenance_notes`에 남긴다(profile.py 참고).
    """
    try:
        method_enum = _METHOD_BY_LABEL[method]
    except KeyError:
        raise ValueError(
            f"알 수 없는 시유 방법: {method!r}. 허용: {sorted(_METHOD_BY_LABEL)}"
        ) from None
    try:
        profile_points = WARE_PROFILES[ware_preset]
    except KeyError:
        raise ValueError(
            f"알 수 없는 기물 프리셋: {ware_preset!r}. 허용: {sorted(WARE_PROFILES)}"
        ) from None

    shape = WareShape(shape_id=ware_preset, name=ware_preset, profile=profile_points)
    ware = Ware(
        ware_id=ware_preset,
        shape=shape,
        clay_body="unspecified",
        bisque_temperature=950.0,
        glaze_interior=glaze_interior,
    )
    density = (
        None
        if specific_gravity is None
        else DensityMeasurement(
            batch_id="aice-request",
            measured_at=_now(),
            specific_gravity=specific_gravity,
            minutes_since_stirring=0.0,
        )
    )
    record = GlazingRecord(
        record_id="aice-request",
        ware_id=ware_preset,
        batch_id="aice-request",
        method=method_enum,
        weight_before=weight_before_g,
        weight_after=weight_after_g,
        dip_seconds=dip_seconds,
        density=density,
        waxed_area_m2=waxed_area_m2,
        is_reglaze=is_reglaze,
        drying_complete=drying_complete,
    )
    return compute_profile(record, ware)


# ─── 06절 담금시간 역산 ─────────────────────────────────────────────────────


def recommend_dip_time(
    *, target_mm: float, specific_gravity: float, t_flow_mm: float = 0.0
) -> DipRecommendation:
    """`kiln.batch.dip_time.recommend_dip_time` 그대로. 흡수율은 대장 고정값."""
    absorption = constants.get("absorption").value
    return _recommend_dip_time(
        target_mm, rho=specific_gravity, absorption=absorption, t_flow_mm=t_flow_mm
    )


# ─── 10-2절 회차 되먹임 — 캘리브레이션 배선 ──────────────────────────────────

#: `CoefficientTable`의 필드 이름 그대로 jsonb에 직렬화한다 — 별도 매핑을
#: 두면 한쪽만 고쳐졌을 때 조용히 어긋난다(00절과 같은 이유).
_COEFFICIENT_FIELDS = (
    "recipe_id", "k1", "k2", "rho_dry", "s", "m_rho",
    "safe_thickness_mm", "calibration_runs", "calibrated_bisque_c",
    "provenance_notes",
)


def coefficient_table_to_dict(table: CoefficientTable) -> dict:
    """Supabase `personal_calibrations.coefficients` jsonb에 그대로 넣을 사전."""
    data = asdict(table)
    data["safe_thickness_mm"] = list(data["safe_thickness_mm"])
    data["provenance_notes"] = list(data["provenance_notes"])
    return data


def coefficient_table_from_dict(recipe_id: str, data: dict | None) -> CoefficientTable:
    """저장된 jsonb(없으면 빈 사전)에서 `CoefficientTable`을 복원한다.

    `recipe_id`는 호출부(라우트 경로 파라미터)가 정본이다 — 저장된 값과
    다르면 조용히 덮어써 저장소 키와 테이블 내용이 갈라지는 것을 막는다.
    """
    if not data:
        return CoefficientTable(recipe_id=recipe_id)
    safe = data.get("safe_thickness_mm")
    return CoefficientTable(
        recipe_id=recipe_id,
        k1=data.get("k1"),
        k2=data.get("k2"),
        rho_dry=data.get("rho_dry"),
        s=data.get("s"),
        m_rho=data.get("m_rho"),
        safe_thickness_mm=tuple(safe) if safe else (0.8, 1.3),
        calibration_runs=data.get("calibration_runs", 0),
        calibrated_bisque_c=data.get("calibrated_bisque_c"),
        provenance_notes=tuple(data.get("provenance_notes", ())),
    )


def apply_calibration_run(
    table: CoefficientTable,
    *,
    ware_preset: str,
    bisque_temperature_c: float,
    weight_before_g: float,
    weight_after_g: float,
    method: str,
    dip_seconds: float | None = None,
    specific_gravity: float | None = None,
    waxed_area_m2: float = 0.0,
    is_reglaze: bool = False,
    drying_complete: bool = True,
    glaze_interior: bool = True,
) -> RunUpdate:
    """시유 회차 1건으로 `table`을 갱신한다 — `kiln.calibration.update.run_update` 그대로.

    `compute_thickness`와 같은 방식으로 `WARE_PROFILES` 대표 형상 위에
    `GlazingRecord`/`Ware`를 조립한다(중복이지만, 두 경로가 각자 다른
    도메인 객체 수명 주기를 가져서 — 하나는 응답 직후 버려지고 하나는
    저장소에 들어간다 — 공유 헬퍼로 묶으면 그 차이가 흐려진다).
    """
    try:
        method_enum = _METHOD_BY_LABEL[method]
    except KeyError:
        raise ValueError(
            f"알 수 없는 시유 방법: {method!r}. 허용: {sorted(_METHOD_BY_LABEL)}"
        ) from None
    try:
        profile_points = WARE_PROFILES[ware_preset]
    except KeyError:
        raise ValueError(
            f"알 수 없는 기물 프리셋: {ware_preset!r}. 허용: {sorted(WARE_PROFILES)}"
        ) from None

    shape = WareShape(shape_id=ware_preset, name=ware_preset, profile=profile_points)
    ware = Ware(
        ware_id=ware_preset,
        shape=shape,
        clay_body="unspecified",
        bisque_temperature=bisque_temperature_c,
        glaze_interior=glaze_interior,
    )
    density = (
        None
        if specific_gravity is None
        else DensityMeasurement(
            batch_id="aice-calibration",
            measured_at=_now(),
            specific_gravity=specific_gravity,
            minutes_since_stirring=0.0,
        )
    )
    record = GlazingRecord(
        record_id="aice-calibration",
        ware_id=ware_preset,
        batch_id="aice-calibration",
        method=method_enum,
        weight_before=weight_before_g,
        weight_after=weight_after_g,
        dip_seconds=dip_seconds,
        density=density,
        waxed_area_m2=waxed_area_m2,
        is_reglaze=is_reglaze,
        drying_complete=drying_complete,
    )
    return run_update(table, record, ware)


# ─── 소성조건 개인화 보정 — 목표-실제 광택 오차 누적 (kiln.calibration.firing) ──

#: `FiringCoefficientTable`의 필드 이름 그대로 jsonb에 직렬화한다 —
#: `personal_calibrations.coefficients`의 **같은 행 안에 `"firing"` 키로
#: 중첩**한다(별도 테이블·마이그레이션 없이 기존 jsonb 컬럼을 그대로 쓴다).
#: 두께 계수(coefficient_table_to_dict가 만드는 평면 키들)와 이름이
#: 겹치지 않아 한 행에 공존할 수 있다.
_FIRING_COEFFICIENT_FIELDS = ("recipe_id", "gloss_bias_level", "calibration_runs", "provenance_notes")


def firing_coefficient_table_to_dict(table: FiringCoefficientTable) -> dict:
    """`personal_calibrations.coefficients["firing"]`에 그대로 넣을 사전."""
    data = asdict(table)
    data["provenance_notes"] = list(data["provenance_notes"])
    return data


def firing_coefficient_table_from_dict(recipe_id: str, data: dict | None) -> FiringCoefficientTable:
    """저장된 `coefficients["firing"]`(없으면 빈 사전)에서 복원한다.

    `coefficient_table_from_dict`와 같은 이유로 `recipe_id`는 호출부가
    정본이다."""
    if not data:
        return FiringCoefficientTable(recipe_id=recipe_id)
    return FiringCoefficientTable(
        recipe_id=recipe_id,
        gloss_bias_level=data.get("gloss_bias_level"),
        calibration_runs=data.get("calibration_runs", 0),
        provenance_notes=tuple(data.get("provenance_notes", ())),
    )


def apply_firing_calibration_update(
    table: FiringCoefficientTable,
    *,
    goal_gloss: str | None,
    result_gloss: str | None,
    defects: tuple[str, ...] = (),
) -> FiringRunUpdate:
    """평가 완료 회차 1건으로 `table`을 갱신한다 —
    `kiln.calibration.firing.update_after_evaluated_run` 그대로."""
    return update_after_evaluated_run(
        table, goal_gloss=goal_gloss, result_gloss=result_gloss, defects=defects
    )


def _now() -> datetime:
    return datetime.now(timezone.utc)
