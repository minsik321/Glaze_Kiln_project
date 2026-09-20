# AICE 회차 되먹임 수정 체크리스트

범위: 전기가마 1대·개인 1인·시뮬레이터. k1·k2·ρ_dry 실측 캘리브레이션은 추가하지 않는다.

1. [x] 레시피 식별: 배합·외배합으로 안정적인 ID 생성, 후보 순번과 분리, 기존 기록 호환.
2. [x] 개인화 소성: 추천·승인·시뮬레이션·저장에서 동일한 보정 곡선 사용.
3. [x] 결과 기반 추천: 성공·결함 관측으로 다음 비중·목표 두께를 제한된 규칙으로 조정하고 근거 보존.
4. [x] 평가 완료: 광택·투명도·결함 확인을 필수로 검증하고 불완전 기록을 학습에서 제외.
5. [x] 기록 왕복: 사진·시유 방법·담금시간·건조 확인·관측·레시피·실행 곡선 복원.
6. [x] 두께 계산: 입력 변경 시 이전 계산·승인 무효화, 최신 응답 및 건조 완료 확인 후 진행.
7. [x] 저장 안정성: 회차 저장 멱등성, 보정 원자적 갱신, 영속 대기 상태·재처리.
8. [x] 검증: 레시피 격리·실패 후 다음 회차·복원·동시 저장·재시도 회귀 테스트, 전체 관련 검사.

## 진행 기록

- 기존 작업 트리 수정사항을 보존한 상태로 시작(다른 세션이 /clear로 컨텍스트를 비운 뒤 이어받음).
- `kiln.aice.identity.canonical_recipe_id`(배합·외배합 해시, cand-N 순번과 분리)와
  `normalize_run_recipe`가 이미 구현·테스트되어 있었다(1). `routes.py`의
  `create_aice_run`이 이 해시를 `recipe_id`로 쓰도록 이미 연결돼 있었다.
- `src/kiln/calibration/density.py`(3·4)는 완전한 평가(광택·투명도·전체
  인상·결함확인)가 없으면 `applied=False`로 거부하고, 성공 시 ±0.02, 결함
  (흘러내림/기어감) 시 최초 관측 대비 -0.05 한도로 비중 범위를 제한적으로
  조정하는 로직이 이미 구현돼 있었다 — 테스트 파일이 구식("범위를 단순히
  넓힌다") 스펙이라 실패하던 것이었다. `tests/calibration/test_density_calibration.py`를
  실제 구현에 맞춰 재작성(포크 에이전트).
- 프런트엔드(2·5·6): `AicePrototype.tsx`의 `updateInputs`가 무게/방법/비중
  변경 시 승인된 곡선·시뮬레이션 완료 상태를 무효화하고(6), 복원 경로가
  사진·시유방법·담금시간·건조확인·평가·레시피·실행곡선을 전부 되돌리는 것을
  확인(5). `WeightInputs.tsx`의 건조 확인 체크박스가 두께 계산의 게이트가
  된 것도 확인(6) — `AicePrototype.test.tsx`가 이 체크박스 없이 무게만
  채우던 구버전 헬퍼였어서 실패하던 것이었다. `curvePlan.toFiringCurve`가
  내부 role "adjusted"를 노출 시 "candidate"(미승인)/"selected"(승인)로
  매핑하는 것도 테스트가 구버전 role 이름("next")을 찾고 있어 실패했다.
  이 세 가지를 테스트에 반영해 수정.
- 백엔드(7): `routes.py`의 `create_aice_run`이 `/rest/v1/aice_runs` 단순
  insert 대신 `/rest/v1/rpc/save_aice_run`(멱등, `p_request_id`)을,
  피드백 커밋은 `/rest/v1/rpc/commit_aice_feedback`(compare-and-swap)을
  쓰도록 이미 구현돼 있었고, `get_calibration`이 `_retry_pending_feedback`으로
  `aice_runs`의 대기 상태를 먼저 재처리한 뒤 `personal_calibrations`를
  읽는 것도 이미 구현돼 있었다 — 11개 백엔드 테스트가 전부 구버전
  REST 경로를 목킹하고 있어 실패하던 것이었다(진짜 로직 버그 아님, 포크
  에이전트가 근본 원인 확인 후 테스트를 RPC 계약에 맞춰 수정).
- 검증(8): 루트 `pytest`, `backend/tests` pytest, `npx vitest run`,
  `npx tsc --noEmit` 전부 통과 확인(회귀 없음). 커밋은 하지 않음 — 작업
  트리 변경사항만 존재.
