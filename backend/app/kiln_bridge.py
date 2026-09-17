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

from dataclasses import dataclass

from kiln import constants
from kiln.domain.models import KilnProfile
from kiln.firing.controller import SegmentedController
from kiln.firing.simulator import Disturbance, KilnSimulator

__all__ = ["KILN_30L", "E_ASSUMPTION_REASON", "ControlSample", "SimulationResult", "simulate"]

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
