# AICE 구현 진행 원장

이 문서는 `docs/AICE_REBUILD_TODO.md`의 Phase 순서와 완료 조건을 기준으로 갱신한다.
각 Phase 완료 뒤 변경 파일, 검증 결과와 완료 커밋을 기록한다.

## 전체 상태

| Phase | 상태 | 완료 커밋 |
|---|---|---|
| 0. 브랜치와 기준선 격리 | 완료 | 커밋 후 기록 |
| 1. 제품 범위와 사용자 흐름 | 대기 | — |
| 2. 디자인 시스템과 앱 뼈대 | 대기 | — |
| 3. AiceRun 계약과 DB | 대기 | — |
| 4. 목표·기물·레시피 경험 | 대기 | — |
| 5. 유약 두께 종단면 | 대기 | — |
| 6. 가마·센서·열 시뮬레이터 | 대기 | — |
| 7. 곡선 보상과 제어 설명 | 대기 | — |
| 8. 특허·문헌 기반 AI MVP | 대기 | — |
| 9. 결과·피드백·공유 | 대기 | — |
| 10. 검증·성능·로컬 실행 | 대기 | — |

## Phase 0 — 새 브랜치와 기준선 격리

상태: 완료

### 완료한 작업

- 원격 브랜치 HEAD를 읽기 전용으로 확인했다.
- `design`의 기준 커밋에서 `aice-direction-plan` 브랜치를 만들었다.
- 기준 커밋에 로컬 annotated tag `aice-pre-rebuild-20260916`을 만들었다.
- 기존 미추적 AICE 기준 문서 두 개를 보존하고 새 브랜치의 구현 기준으로 포함했다.
- 계산 코어, DB/RLS, React, FastAPI, 타입/빌드, 실제 Edge/Pyodide 흐름을 검증했다.
- 390px 모바일 화면, DB 기준 스키마, 환경 변수와 로컬 실행 구성을 기록했다.

### 남은 작업

- 로컬 Supabase 실제 기동과 두 계정 Auth 검증은 Docker와 사용자 홈 쓰기가 가능한
  환경에서 Phase 10에 수행한다.
- Pyodide CDN 네트워크 의존과 초기 번들 크기 경고는 Phase 2/10에서 개선·측정한다.

### 주요 설계 결정

- 현재 공개 디자인 브랜치의 HEAD를 개편 기준으로 고정한다.
- 원격에 쓰지 않고 로컬 브랜치/태그만 사용한다.
- 기준선에서 검증하지 못한 실제 Supabase 항목은 통과로 표시하지 않는다.
- 저장소에 없는 `AICE Kiln App.dc.html`을 요구사항으로 가정하지 않고, 존재하는
  디자인 HTML은 시각 참고로만 사용한다.

### 주요 파일

- `docs/AICE_BASELINE.md`
- `docs/AICE_DIRECTION_PLAN.md`
- `docs/AICE_REBUILD_TODO.md`
- `docs/AICE_IMPLEMENTATION_PROGRESS.md`
- `docs/baseline/phase-0-mobile-390.png`

### 테스트와 결과

- `.\.venv\Scripts\python.exe -m pytest tests -q`: 621 passed
- `npm test`: DB/자산 4 passed, React 10 passed
- `.\.venv\Scripts\python.exe -m pytest backend/tests -q`: 6 passed
- `npm run build`: 통과
- `npm run test:e2e`: 최초 CDN 차단 실패, 네트워크 허용 재실행 1 passed

### 실패와 수정

- Git의 저장소 소유권 검사: 작업 경로를 safe directory로 등록했다.
- 샌드박스에서 Git refs 쓰기 거부: 승인된 Git 쓰기로 브랜치와 태그를 생성했다.
- Pyodide CDN fetch 실패: 네트워크 허용 환경에서 동일 E2E를 재검증했다.

### 완료 커밋

커밋 생성 후 해시를 보충한다.

### 다음 Phase 시작점

Phase 1 TODO와 완료 조건을 다시 읽고, 숫자 입력 없이 끝낼 수 있는 9화면 흐름,
화면별 정보 우선순위, 안전 문구와 저해상도 와이어프레임을 구현한다.

