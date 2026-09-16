# AICE 구현 진행 원장

이 문서는 `docs/AICE_REBUILD_TODO.md`의 Phase 순서와 완료 조건을 기준으로 갱신한다.
각 Phase 완료 뒤 변경 파일, 검증 결과와 완료 커밋을 기록한다.

## 전체 상태

| Phase | 상태 | 완료 커밋 |
|---|---|---|
| 0. 브랜치와 기준선 격리 | 완료 | `dfe39f5` |
| 1. 제품 범위와 사용자 흐름 | 완료 | 커밋 후 기록 |
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

`dfe39f5` (`phase-0: isolate rebuild baseline`)

### 다음 Phase 시작점

Phase 1 TODO와 완료 조건을 다시 읽고, 숫자 입력 없이 끝낼 수 있는 9화면 흐름,
화면별 정보 우선순위, 안전 문구와 저해상도 와이어프레임을 구현한다.

## Phase 1 — 제품 범위와 사용자 흐름 확정

상태: 완료

### 완료한 작업

- MVP 사용자를 수치 모델을 몰라도 시각 안내로 한 번의 가상 실험을 완료하는
  비전문가로 고정했다.
- 홈부터 결과 평가까지 9개 화면의 저해상도 와이어프레임과 정보 우선순위를
  문서화했다.
- React 기본 진입 화면을 숫자 중심 6탭에서 카드 선택 중심 9화면 프로토타입으로
  교체했다.
- 샘플 목표, 레시피, 기물, 도포 단면, 센서, 곡선, 가상 소성, 결과 평가를 숫자
  직접 입력 없이 완료할 수 있게 했다.
- 추천 화면에 이유, 가정, 다음 행동을 함께 제공하고 상세 정보는 `상세 보기`로
  분리했다.
- 모든 화면에 `데모 · 시뮬레이션 전용` 배지를 고정하고 실제 장치 비연결·품질
  비보장 문구를 넣었다.

### 남은 작업

- 현재 시각물과 데이터는 클릭 흐름 검증용이다. 공식 `AiceRun`, 출처 메타데이터,
  계산 코어 연결은 Phase 3 이후에 수행한다.
- 기물 전체 카탈로그, 실제 타입이 있는 단면/가마/곡선 시각화는 Phase 4~7에서
  확장한다.

### 주요 설계 결정

- 목표 색상은 계산 목적함수로 넣지 않고 사례 선택 메타데이터로만 취급한다.
- 외부 사진 대신 실제 사진처럼 보이지 않는 명시적 색상·질감 플레이스홀더를
  사용한다.
- 프로토타입 스냅샷에도 `simulation_only`, `quality_guaranteed: false`,
  `real_kiln_control: false`를 기록한다.
- 화면 설계 승인 근거는 문서의 인수 조건, 컴포넌트 테스트, 모바일 E2E와 캡처로
  객관화했다.

### 주요 파일

- `docs/AICE_USER_FLOW.md`
- `app/react/aice/AicePrototype.tsx`
- `app/react/aice/AicePrototype.test.tsx`
- `app/react/App.tsx`
- `app/app.css`
- `tests/browser/simulator.spec.ts`
- `docs/baseline/phase-1-prototype-mobile.png`

### 테스트와 결과

- `npm run typecheck`: 통과
- `npm run test:react`: 12 passed
- `npm run test:e2e`: 1 passed, 390×844 클릭형 전체 흐름
- `npm run build`: 통과, 초기 JS 471.50 kB

### 실패와 수정

- 기존 E2E는 폐기된 6탭 DOM과 숫자 입력을 전제했다. 9화면 접근 가능한 이름과
  모바일 클릭 흐름을 검증하도록 갱신했다.
- 컴포넌트 테스트로 선택 전 진행 차단, 숫자 입력 부재, 시뮬레이션 안전 스냅샷을
  확인했다.

### 완료 커밋

커밋 생성 후 해시를 보충한다.

### 다음 Phase 시작점

Phase 2 TODO와 완료 조건을 다시 읽고, 프로토타입 요소를 청회색 디자인 토큰과
타입 있는 공통 컴포넌트로 추출한다. 390/768/1280 반응형, 44px 목표, 키보드,
스크린리더 이름, 감소 모션, 비동기 상태를 자동 검증한다.
