"""kiln.calibration.registry — 레시피별 계수 계열 저장소 (Phase 5 · 11절).

`CoefficientTable.recipe_id` 는 이미 레시피로 키가 잡혀 있지만(11절 도메인
모델), 그것을 *여러 레시피에 걸쳐* 보관·조회하는 자리는 지금까지 없었다.
LLM 프런트도어 TODO Phase 5 3항("신규 레시피 유입 시 별도 계수 계열 생성")이
요구하는 것은 새 물리 모델이 아니라 이 보관 규칙 하나다:

    처음 보는 recipe_id → 대장 초기값(전부 ``None`` · 미동정) 새 테이블
    이미 본 recipe_id   → 그 레시피의 기존 테이블을 그대로 돌려준다

한 레시피의 회차 되먹임(:mod:`kiln.calibration.update`)이 다른 레시피의
`k1`/`rho_dry`를 건드리면 안 된다는 요건이 이 클래스의 전부다 — 그래서
일부러 작게 둔다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from kiln.calibration.update import RunUpdate, run_update
from kiln.domain.models import CoefficientTable, GlazingRecord, Ware

__all__ = ["CoefficientTableStore"]


@dataclass(slots=True)
class CoefficientTableStore:
    """``recipe_id -> CoefficientTable`` 매핑 (Phase 5 3항).

    ① 입력
        레시피별 갱신 요청(:meth:`get` 의 ``recipe_id``, 또는
        :meth:`apply_run_update` 의 회차 기록)뿐이다. 계수 초기값은
        직접 만들지 않고 `CoefficientTable` 의 필드 기본값(전부 미동정
        ``None``)에 위임한다 — 값 하나도 이 클래스가 새로 박아 넣지 않는다.

    ② 처리
        `dict` 하나. 처음 보는 `recipe_id`면 새 `CoefficientTable`을
        만들어 저장하고, 이미 있으면 그 객체를 그대로 돌려준다. 갱신은
        항상 그 레시피의 항목 **하나만** 바꾼다 — 다른 레시피의 딕셔너리
        항목에는 손도 대지 않는다(frozen dataclass의 `replace`가 새
        객체를 만들 뿐 다른 키를 건드릴 길이 없다).

    ③ 출력
        `get()` / `apply_run_update()` 가 그 레시피의 `CoefficientTable`
        (또는 `RunUpdate`, 갱신 사유 포함)을 돌려준다.

    ④ 차이
        물리 모델이 아니라 **격리 보증**이다. 여러 레시피를 동시에 굴리는
        화면(8~9절)에서 레시피 A가 몇 회차 쌓였다고 레시피 B의 k1이
        조용히 따라 움직이면 10-2절의 "저울 두 번으로 k1이 좁혀진다"는
        주장이 레시피 단위로 깨진다. 이 클래스가 막는 것은 그 오염
        하나뿐이다.
    """

    _tables: dict[str, CoefficientTable] = field(default_factory=dict)

    def get(self, recipe_id: str) -> CoefficientTable:
        """``recipe_id`` 의 계수 테이블을 돌려준다. 처음 보면 새로 만든다.

        새로 만드는 테이블은 ``CoefficientTable(recipe_id=recipe_id)`` —
        모든 계수가 미동정(``None``)인 상태다. "아직 캘리브레이션하지
        않았다"와 "다른 레시피 값을 빌려왔다"는 다른 진술이고, 이 메서드는
        전자만 낸다.
        """
        table = self._tables.get(recipe_id)
        if table is None:
            table = CoefficientTable(recipe_id=recipe_id)
            self._tables[recipe_id] = table
        return table

    def put(self, table: CoefficientTable) -> None:
        """테이블을 그 `table.recipe_id` 키에 그대로 덮어쓴다."""
        self._tables[table.recipe_id] = table

    def apply_run_update(
        self, recipe_id: str, record: GlazingRecord, ware: Ware
    ) -> RunUpdate:
        """``recipe_id`` 의 테이블에 회차 1건을 반영하고 저장소도 갱신한다.

        :func:`kiln.calibration.update.run_update` 를 그 레시피의 현재
        테이블 위에서 호출할 뿐이다 — 새 물리·새 갱신 규칙은 없다. 결과
        테이블을 저장소에 :meth:`put` 하므로, 다음 :meth:`get` 호출이
        이번 갱신을 본다.
        """
        result = run_update(self.get(recipe_id), record, ware)
        self.put(result.table)
        return result

    def recipe_ids(self) -> tuple[str, ...]:
        """지금까지 저장소가 만들어 준 레시피 id 전부."""
        return tuple(self._tables)

    def calibration_runs(self, recipe_id: str) -> int:
        """``recipe_id`` 의 `CoefficientTable.calibration_runs`.

        LLM 프런트도어 TODO Phase 5 1항("Prediction Model 출력과 연결")이
        가리키는 값이 이것이다 — 프런트엔드 `predictionModel.ts` 의
        `priorRunCount` 가 언젠가 이어질 자리는 이 숫자이지, 회차 자체의
        재구현이 아니다. 이 파일은 그 값을 **내놓을 뿐**이고, 지금은 아직
        어떤 백엔드 엔드포인트도 이 값을 프런트엔드로 나르지 않는다 — 그
        결선은 `docs/AICE_LLM_FRONTDOOR_TODO.md` Phase 5 1항 완료 메모에
        범위로 명시했다.
        """
        return self.get(recipe_id).calibration_runs
