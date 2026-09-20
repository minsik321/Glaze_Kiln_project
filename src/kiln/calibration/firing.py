"""소성조건 개인화 보정 — 목표-실제 오차 누적 (LLM 프런트도어 TODO Phase 5 후속).

사용자 요구사항: "Optimization Model은 실제 결과와 목표 결과의 오차를
누적하여 다음 소성조건을 개인화 보정하는 역할을 담당하도록 구성합니다."

:mod:`kiln.calibration.update` 가 "저울 실측 vs 두께 모델 예측"의 오차를
회차 수 가중 평균으로 누적해 유약 두께 계수(k1)를 개인화하는 것과 **같은
형태의 되먹임**을, 이 모듈은 다른 신호에 적용한다: **목표 광택도
(``Goal.gloss``) vs 사용자가 기록한 실제 결과 광택도(``ResultEvaluation
.gloss``)**.

**이게 필요한 이유.** :mod:`kiln.chem.stull` 의 ``StullZone
.LOW_SILICA_AMBIGUOUS`` 문서가 이미 명시하듯("저실리카 매트 vs 미용융은
차트만으로 갈리지 않는다"), 조성 좌표가 같아도 광택의 실제 용융 정도는
소성조건(콘·유지시간·냉각)이 가른다. 그런데 이 프로젝트에는 지금까지
"목표한 광택도가 실제로 안 나왔다"는 신호를 다음 소성조건에 되먹이는
경로가 없었다 — ``predictionModel.ts`` 의 ``predictNextRun`` 은 기물
크기·레시피 소성범위·회차 "수"만 보고, 회차의 **결과**는 전혀 읽지
않는 결정론적 합성 규칙이었다(``kiln/calibration/CLAUDE.md`` Phase 5절
참고).

**이 모듈이 하는 일은 정확히 하나다.** 회차마다 (실제 광택 레벨 − 목표
광택 레벨)의 부호 있는 순서형 거리를 계산해, 기존 누적값과 회차 수
가중 평균으로 합친다 — ``kiln.calibration.update.run_update`` 와 동일한
``(old·n + new)/(n+1)`` 형태다. 양수로 쌓이면 실제가 목표보다 계속 더
유광(과용융) 쪽으로 나왔다는 뜻이고, 음수로 쌓이면 계속 더 무광(미용융)
쪽으로 나왔다는 뜻이다. 이 누적치(``gloss_bias_level``)를 다음 회차 유지
온도 보정에 어떻게 반영할지(부호를 뒤집어 반대 방향으로 보정 제안)는
프런트엔드 ``predictionModel.ts`` 몫이다 — 이 모듈은 신호를 정직하게
누적해서 낼 뿐, "그래서 몇 도를 바꿔라"는 판단까지 내리지 않는다(부록 D:
판단 주체가 아니다. ``kiln.calibration.registry.calibration_runs`` 가
"값 자체를 배선하지 않고 낼 뿐"인 것과 같은 태도).

**다루지 않는 것(조용히 확장하지 않는다).**

- **투명도**는 다루지 않는다 — 불투명/반투명/투명은 주로 조성(유백제·
  기포 분포)이 좌우하고, 유지온도 하나로 설명할 근거가 약하다.
- **결함(defects)** 은 이 누적치에 섞지 않는다 — ``running``(흘러내림)
  같은 결함은 분명 과소성 신호이지만, 원인이 조성·시유 두께·소성 곡선
  전체 등 여러 갈래로 갈려 광택도 순서형 거리와 같은 척도로 합칠 근거가
  없다(부록 A와 같은 태도: 곱으로 붙어 식별 안 되는 것을 억지로 분리
  주장하지 않는다). 결함은 ``notes`` 에 참고 신호로만 남긴다.
- **레시피가 다르면 섞지 않는다** — :mod:`kiln.calibration.registry` 와
  같은 이유로 레시피별로 격리한다(다른 배합은 다른 소성곡선 위에 있다).
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from kiln.domain.enums import Gloss

__all__ = [
    "FiringCoefficientTable",
    "FiringRunUpdate",
    "update_after_evaluated_run",
]


@dataclass(frozen=True, slots=True)
class FiringCoefficientTable:
    """레시피 1개의 소성조건 개인화 상태 (11절 ``CoefficientTable`` 과 같은
    자리이지만, 이 프로젝트 기획서 11절 트리에는 없던 Phase 5 후속 필드라
    ``kiln.domain.models`` 가 아니라 이 모듈에 둔다 — Phase 5의 다른
    추가물(``registry.py``·``demo_convergence.py``)과 같은 선례다.

    ``gloss_bias_level`` 이 ``None`` 이면 "아직 관측 없음"이다 — 0과는
    다른 진술이다(부록 D: 조용한 기본값 금지). 최초 관측 1건이 그대로
    초기 편향이 된다.
    """

    recipe_id: str
    gloss_bias_level: float | None = None
    calibration_runs: int = 0
    provenance_notes: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class FiringRunUpdate:
    """평가 완료 회차 1건의 갱신 결과와 그 사유."""

    table: FiringCoefficientTable
    #: 이 회차가 편향 갱신에 실제로 기여했는가(목표·실제 광택이 둘 다
    #: 알려진 등급으로 해석됐는가).
    applied: bool
    #: 이 회차 단독의 (실제 − 목표) 광택 레벨 차. 반영 못 했으면 None.
    observed_error_level: int | None
    notes: tuple[str, ...]


def _gloss_level(label: str | None) -> int | None:
    """저장된 광택 라벨(예: "satin"/"SATIN")을 :class:`Gloss` 레벨로.

    ``goal_gloss``는 대소문자 무시 ``.strip().upper()`` 매핑으로 충분하다
    — 프런트엔드 문자열과 열거형 멤버 이름이 이미 같은 어휘다(목표는
    화면이 고른 값 그대로 올라온다). ``result_gloss``는 사용자가
    ``ResultFeedback``에서 직접 고른 값이라 어휘가 다를 수 있지만, 이
    함수는 두 입력 모두 같은 매핑을 쓴다 — 모르는 값이면 ``None``
    (판정 불가를 지어내지 않는다).
    """
    if not label:
        return None
    try:
        return Gloss[label.strip().upper()].level
    except (KeyError, AttributeError):
        return None


def update_after_evaluated_run(
    table: FiringCoefficientTable,
    *,
    goal_gloss: str | None,
    result_gloss: str | None,
    defects: tuple[str, ...] = (),
) -> FiringRunUpdate:
    """평가 완료 회차 1건으로 광택 편향을 갱신한다.

    목표 또는 실제 결과의 광택 라벨을 모르면(둘 중 하나가 비어 있거나
    알려지지 않은 값이면) 갱신하지 않는다 — 판정 불가를 지어내지 않는다
    (``kiln.calibration.update.run_update`` 가 조건 미충족 회차를
    조용히 건너뛰는 것과 같은 태도).
    """
    notes: list[str] = []

    if any(defect not in {"pinholes", "crawling", "crazing", "running"} for defect in defects):
        return FiringRunUpdate(
            table=replace(table), applied=False, observed_error_level=None,
            notes=("알 수 없는 결함 기록은 자동 소성 보정에 사용하지 않습니다.",),
        )
    notes.append("광택 차이는 관측의 순서형 오차입니다. 온도 보정은 다음 실험 가설이며 과용융·미용융의 원인을 입증하지 않습니다.")

    goal_level = _gloss_level(goal_gloss)
    if goal_level is None:
        notes.append(f"목표 광택 값 {goal_gloss!r}을 알려진 등급으로 해석할 수 없다 — 갱신하지 않는다")
        return FiringRunUpdate(table=replace(table), applied=False, observed_error_level=None, notes=tuple(notes))

    result_level = _gloss_level(result_gloss)
    if result_level is None:
        notes.append(
            "실제 결과 광택 기록이 없거나 해석할 수 없다"
            if not result_gloss
            else f"실제 결과 광택 값 {result_gloss!r}을 알려진 등급으로 해석할 수 없다"
        )
        notes.append("갱신하지 않는다")
        return FiringRunUpdate(table=replace(table), applied=False, observed_error_level=None, notes=tuple(notes))

    error_level = result_level - goal_level
    notes.append(
        f"목표 {goal_gloss}(레벨 {goal_level}) vs 실제 {result_gloss}(레벨 {result_level}) "
        f"= 오차 {error_level:+d} (양수: 목표보다 더 유광, 음수: 더 무광)"
    )
    if "running" in defects:
        notes.append("'흘러내림' 결함이 함께 기록됨 — 조성·두께·소성 중 원인은 미확정이며 광택 오차에 합산하지 않는다")

    n = table.calibration_runs
    if table.gloss_bias_level is None or n <= 0:
        new_bias = float(error_level)
        notes.append("기존 누적치가 없어 이 회차 오차를 그대로 채택했다")
    else:
        new_bias = (table.gloss_bias_level * n + error_level) / (n + 1)
        notes.append(
            f"편향 갱신: ({table.gloss_bias_level:.3f}·{n} + {error_level})/{n + 1} "
            f"= {new_bias:.3f} — 회차 수 가중 평균(kiln.calibration.update.run_update와 같은 형태)"
        )

    new_table = FiringCoefficientTable(
        recipe_id=table.recipe_id,
        gloss_bias_level=new_bias,
        calibration_runs=n + 1,
        provenance_notes=tuple(notes),
    )
    return FiringRunUpdate(table=new_table, applied=True, observed_error_level=error_level, notes=tuple(notes))
