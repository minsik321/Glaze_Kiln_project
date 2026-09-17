# kiln.aice — AiceRun 경계 계약

기준: `docs/AICE_DIRECTION_PLAN.md` 3·9절, `docs/AICE_REBUILD_TODO.md` Phase 3.

## ① 입력

프런트엔드 선택, 계산 코어 출력, 가상 소성 로그, 결과 평가, 출처·동의·버전.

## ② 처리

계산하지 않는다. 스키마 불변식, 여섯 `source_type`, 단위, 사진 권리, 곡선 선택
참조와 버전을 검증하고 v1 범용 기록을 읽기 전용 v2 계약으로 변환한다.

## ③ 출력

JSON 직렬화 가능한 `AiceRun` v2. 근거 없는 값은 `None`이며 `observed`로 올리지
않는다.

### LLM 프런트도어 TODO Phase 1 (진행 중)

- `RecipeCandidate` / `RecipeCandidateSet` — 화면 1(LLM 채팅)이 내놓는 레시피
  후보 묶음. `RecipeSelection`(단일·확정)과 다른 타입이며,
  `RecipeCandidateSet.select(id)` 로만 `RecipeSelection`에 이어진다. 후보를
  억지로 하나로 접거나, 확정 타입을 리스트로 늘리지 않는다.
- `ChatIntake` — 화면 1의 자연어 원문·첨부 이미지·후보 묶음을 한데 묶어
  `AiceRun.intake`에 담는다. 채팅에서 시작하지 않은 실행(레거시 변환 등)은
  `None`이다.
- `ThicknessEstimate.areal_density` — mean(mm)과 별개 단위(g/m²)의 1급
  `SourcedValue` 필드. `kiln.thickness.profile.ThicknessProfile.areal_density_g_m2`
  와 대응한다.
- **완료(Phase 3, 2026-09-17)** `PidExecution.preset`(fast/balanced/stable)을
  `decision: Literal["accepted", "regenerate"]`로 교체했다 — `AICE_SCHEMA_VERSION`을
  2→3으로 올렸다(마이그레이션 경로는 만들지 않음 — 데모/비상용 스코프, §8).
  이름 붙은 게인 3벌(빠른 반응/균형/안정 우선)은 `app/react/aice/curvePlan.ts`
  내부 구현으로만 남고, 사용자에게는 더 이상 이름으로 노출되지 않는다
  (`app/react/aice/CurveControlPanel.tsx`). **TypeScript 쪽도 완료**:
  `app/react/aice/contract.ts`의 `AICE_SCHEMA_VERSION`도 3으로 올렸고
  `AiceRun.pid.preset` → `.decision`으로 맞췄다. `AicePrototype.tsx`는
  `CurveControlPanel`이 승인 시 넘기는 실제 samples/parameters를 그대로
  저장해 스냅숏에 반영하며, 더 이상 어떤 게인이 쓰였는지 이름으로 들고
  있지 않는다.

## ④ 차이

범용 스냅샷과 달리 실행 전 과정을 분리된 하위 모델과 출처·동의·버전으로 함께
운반한다. 실제 품질 또는 실제 가마 제어를 보장하지 않는다.

