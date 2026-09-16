# AICE 구현 진행 원장

이 문서는 `docs/AICE_REBUILD_TODO.md`의 Phase 순서와 완료 조건을 기준으로 갱신한다.
각 Phase 완료 뒤 변경 파일, 검증 결과와 완료 커밋을 기록한다.

## 전체 상태

| Phase | 상태 | 완료 커밋 |
|---|---|---|
| 0. 브랜치와 기준선 격리 | 완료 | `dfe39f5` |
| 1. 제품 범위와 사용자 흐름 | 완료 | `05568fa` |
| 2. 디자인 시스템과 앱 뼈대 | 완료 | `2836a5a` |
| 3. AiceRun 계약과 DB | 완료 | `97780f9` |
| 4. 목표·기물·레시피 경험 | 완료 | `d0dacea` |
| 5. 유약 두께 종단면 | 완료 | 커밋 후 기록 |
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

`05568fa` (`phase-1: deliver guided simulation flow`)

### 다음 Phase 시작점

Phase 2 TODO와 완료 조건을 다시 읽고, 프로토타입 요소를 청회색 디자인 토큰과
타입 있는 공통 컴포넌트로 추출한다. 390/768/1280 반응형, 44px 목표, 키보드,
스크린리더 이름, 감소 모션, 비동기 상태를 자동 검증한다.

## Phase 2 — 디자인 시스템과 반응형 앱 뼈대

상태: 완료

### 완료한 작업

- 문서 우선순위에 따라 청회색 강조, 밝은 중성 배경, 가는 경계와 절제된 그림자를
  의미 기반 CSS 토큰으로 확정했다.
- `AppShell`, 진행 상태, 하단 내비게이션, 카드, 선택 칩, 상태 배지, 설명 패널,
  상세 서랍, 경고와 판정 불가, 공통 비동기 상태 컴포넌트를 만들었다.
- 빈 상태, 로딩, 오류, 판정 불가, 완료 상태를 실제 데이터 없이 한 갤러리에서
  렌더링하고 자동 테스트했다.
- 390px은 1열, 768px과 1280px은 시각화·설명 병렬 배치가 가능한 2열 셸로
  반응하도록 했다.
- 모든 표시 조작 요소에 44px 최소 높이, 명시적 포커스, 접근 가능한 이름,
  색 외의 기호·패턴, 감소 모션 설정을 적용했다.
- 선택 화면은 계산 엔진과 독립적으로 즉시 렌더링된다. 계산 엔진 실패가 앱 셸과
  선택 작업을 막지 않는 구조다.

### 남은 작업

- 실제 계산 로딩 상태와 오류 복구는 Phase 3 이후 AiceRun/계산 어댑터 연결 때
  공통 상태 컴포넌트에 연결한다.
- 완전한 접근성 자동 감사와 성능 예산은 Phase 10에서 추가한다.

### 주요 설계 결정

- 디자인 HTML의 얇은 경계·한 화면 한 작업·하단 행동 구조만 참고하고, 문서와
  충돌하는 갈색 팔레트·작은 글자·작은 조작 영역은 복제하지 않았다.
- 상태를 색상만으로 전달하지 않고 텍스트, 테두리 모양, 기호 또는 패턴을 함께
  사용한다.
- 진행 단계와 선택 상태는 `aria-current`, `aria-pressed`로 표현한다.

### 주요 파일

- `app/react/aice/ui.tsx`
- `app/react/aice/ui.test.tsx`
- `app/react/aice/design-system.css`
- `app/react/aice/AicePrototype.tsx`
- `app/react/App.tsx`
- `app/react/main.tsx`
- `tests/browser/simulator.spec.ts`
- `docs/baseline/phase-2-responsive-{390,768,1280}.png`

### 테스트와 결과

- `npm run typecheck`: 통과
- `npm run test:react`: 15 passed
- `npm run test:e2e`: 4 passed
  - 9화면 전체 흐름
  - 390/768/1280 가로 넘침 없음
  - 각 뷰포트의 표시 조작 요소 높이 44px 이상

### 실패와 수정

- 기존 CSS의 두 번 정의된 갈색 토큰이 뒤에서 덮어쓰고 있었다. 별도
  `design-system.css`를 마지막에 로드해 의미 토큰과 반응형 규칙을 단일 우선
  계층으로 고정했다.

### 완료 커밋

`2836a5a` (`phase-2: establish accessible responsive shell`)

### 다음 Phase 시작점

Phase 3 TODO와 완료 조건을 다시 읽고 TS, Python, FastAPI, PostgreSQL이 공유하는
버전 2 `AiceRun` 계약, legacy 변환, 정규화 필드, Storage 정책과 RLS 테스트를
구현한다.

## Phase 3 — AiceRun 데이터 계약과 DB 마이그레이션

상태: 완료

### 완료한 작업

- TypeScript와 stdlib Python에 동일한 AiceRun v2 하위 모델을 정의하고 런타임
  검증 및 결정적 샘플을 추가했다.
- `observed`, `patent_example`, `patent_range`, `literature`, `inferred`,
  `synthetic` 여섯 출처 유형과 단위·신뢰도·한계를 계약에 고정했다.
- 프런트엔드 프로토타입 스냅샷을 정식 AiceRun v2로 전환했다.
- FastAPI에 AiceRun 생성·목록·상세 API를 추가하고 공유 Python 계약으로 요청과
  Supabase 응답을 검증한다.
- `aice_runs`의 검색 필드를 정규화하고 출처, 동의, 개인 보정, 사진 메타데이터,
  비공개 Storage 버킷과 RLS를 마이그레이션으로 추가했다.
- v1→v2 및 v2→v1 읽기 전용 변환과 기존 기록 호환 뷰를 구현했다.
- 공개 플래그만으로 외부 조회되지 않으며 활성 동의가 있어야 하고, 철회 즉시
  실행·출처·사진 조회가 차단되는 것을 PGlite로 검증했다.

### 남은 작업

- 실제 Supabase CLI/Docker와 실제 Auth·Storage API 검증은 현재 환경 제약 때문에
  Phase 10 수동 검증으로 남긴다.
- 사진 업로드 UI와 철회 흐름은 Phase 9에서 연결한다.

### 주요 설계 결정

- 범용 `work_records`는 삭제하거나 자동 변환하지 않고 읽기 전용 호환 경로로
  보존한다.
- `is_public`과 동의를 분리하고 RLS 조회 조건에서 활성 동의를 필수로 한다.
- 사진 버킷은 공개 버킷으로 만들지 않으며 사용자 UUID 경로와 메타데이터 정책을
  함께 검사한다.
- 개인 보정치는 공개 실행과 별도 테이블·소유자 전용 정책으로 격리한다.
- v2→v1은 정보 손실을 숨기지 않도록 전체 v2 payload를 읽기 전용으로 감싼다.

### 주요 파일

- `app/react/aice/contract.ts`, `contract.test.ts`
- `src/kiln/aice/contract.py`, `CLAUDE.md`, `tests/aice/test_contract.py`
- `backend/app/models.py`, `backend/app/routes.py`, `backend/tests/test_api.py`
- `app/react/lib/api.ts`, `api.test.ts`
- `supabase/migrations/20260916010000_aice_runs.sql`
- `scripts/aice-database.test.mjs`
- `docs/AICE_MIGRATION.md`
- `app/kiln-manifest.json`

### 테스트와 결과

- AiceRun Python 계약: 4 passed
- 웹앱/manifest 포함 선택 테스트: 70 passed
- 전체 Python 계산/계약 회귀: 625 passed
- FastAPI: 8 passed
- DB/RLS/Storage 정책: 신규 3 포함 7 passed
- React/TS 계약·API: 19 passed
- TypeScript 검사와 Vite 빌드: 통과

### 실패와 수정

- JSON 왕복 시 tuple이 list로 바뀌어 Python 객체 동등성이 깨졌다. 단위 범위 값을
  복원할 때 tuple로 정규화했다.
- legacy 변환이 frozen tuple에 append하려 해 실패했다. 새 tuple을 만들어
  출처를 추가하도록 수정했다.
- 브라우저 manifest 순수 stdlib 검사가 상대 import를 외부 모듈로 오인했다.
  패키지 절대 import로 교체하고 재검증했다.
- Windows에서 Playwright가 직접 시작한 Vite 자식 프로세스를 테스트 완료 뒤
  종료하지 못해 대기했다. Vite를 명시적으로 시작한 뒤 동일 E2E를 실행해 4개
  테스트 통과와 정상 종료를 확인하고 서버를 정리했다.

### 완료 커밋

`97780f9` (`phase-3: establish versioned AiceRun contract`)

### 다음 Phase 시작점

Phase 4 TODO와 완료 조건을 다시 읽고 전체 7종+기타 기물 카탈로그, 사진/스와치
목표 선택, 최대 3개 레시피 비교, 출처·불확실성·위험 요약을 AiceRun 상태에
연결한다.

## Phase 4 — 선택 중심의 목표·기물·레시피 경험

상태: 완료

### 완료한 작업

- 광택·투명도·색상·질감을 한눈에 이해할 수 있는 세 가지 스와치 목표 카드를
  유지하고 AiceRun 목표 상태에 연결했다.
- 사발, 접시, 컵/머그, 원통 화병, 병, 타일/평판, 기타의 7종 카탈로그를 만들고
  실루엣, 대표 크기, 시유 면을 표시했다.
- 백색 석기, 산화 석기, 도기 소지를 선택하도록 하고 AiceRun의 `clay_body`에
  연결했다.
- `기타`는 간단한 설명과 둥근형/세로형/평판형 실루엣만 받고 정밀 치수나 메시를
  요구하지 않는다.
- 레시피 후보를 최대 3개로 제한하고 유사 이유, 소성 범위, 출처 유형, 데이터 수,
  불확실성, 위험 요약을 기본 카드에 표시했다.
- 실제 사진이 없는 모든 후보에 `사진 없음 · 플레이스홀더`를 직접 표시하고,
  배합·화학 내용은 상세 보기로 분리했다.

### 남은 작업

- 외부 실제 사진은 권리와 라이선스가 확인된 데이터가 없으므로 의도적으로
  포함하지 않았다.
- 대표 형상의 실제 면적·분포 연결은 Phase 5의 단면 모델에서 수행한다.

### 주요 설계 결정

- 목표 색상은 검색 메타데이터이며 기존 광택×투명도 목적함수를 대체하지 않는다.
- `patent_range`와 `synthetic` 후보를 관측 레시피처럼 보이지 않게 명시한다.
- 표본 0건인 합성 후보도 숨기지 않고 데이터 수와 매우 높은 불확실성을 표시한다.

### 주요 파일

- `app/react/aice/catalog.ts`, `catalog.test.ts`
- `app/react/aice/AicePrototype.tsx`, `AicePrototype.test.tsx`
- `app/react/aice/design-system.css`
- `tests/browser/simulator.spec.ts`
- `docs/baseline/phase-4-recipe-selection.png`

### 테스트와 결과

- `npm run typecheck`: 통과
- `npm run test:react`: 21 passed
- `npm run test:e2e`: 4 passed
- 카탈로그 회귀: 요구 기물 7종 정확히 포함, 후보 3개 이하, 사진 부재 명시

### 실패와 수정

- 기물 단계에 소지 선택이 추가되어 기존 클릭 흐름의 다음 버튼이 비활성화됐다.
  컴포넌트 및 E2E에서 소지를 명시적으로 선택하도록 갱신했다.

### 완료 커밋

`d0dacea` (`phase-4: deliver visual selection catalogs`)

### 다음 Phase 시작점

Phase 5 TODO와 완료 조건을 다시 읽고 기물별 정규화 단면 자산, 패턴·레이블이
있는 두께 상태, 위치 근거 수준, 위험 콜아웃과 입력→위험→곡선 연결을 구현한다.

## Phase 5 — 유약 두께 종단면 시각화

상태: 완료

### 완료한 작업

- 일곱 기물 프리셋 각각에 정규화 SVG 몸체, 세 표면 구간, 위험 콜아웃 좌표를
  데이터 자산으로 정의했다.
- 선택 기물과 얇게/목표 근처/두껍게 도포 선택을 단면에 즉시 반영한다.
- 얇음, 목표 근처, 두꺼움, 판정 불가를 색과 함께 점선·점·교차선·가로선
  패턴과 직접 레이블로 표시한다.
- `두께 표현은 이해를 위해 과장됨`과 `형상 기반 가상 분포`, 위치 불확실성을
  단면 아래 상시 표시한다.
- 전체 무게만 있는 모델에서는 평균만 추정값으로 두고 세 위치 구간은 모두
  `synthetic`으로 유지한다. 위치 관측 모드에서만 `observed`로 강화한다.
- 굽, 모서리, 구연부, 안쪽 바닥 등 기물별 위험 지점을 그림과 목록으로
  설명한다.
- 도포 선택이 단면 상태, 위험 문장, AiceRun 두께 경고와 후보곡선 변경 이유에
  함께 전파되도록 했다.

### 남은 작업

- 샘플 흐름에는 실제 무게·면적·건조밀도 관측이 없으므로 평균은 `판정 불가`로
  유지한다. 테스트에서만 명시적으로 0.90 mm를 넣어 mass-only 분기를 검증한다.
- 사진 분석·스캔 위치 근거는 MVP 입력 경로가 없어 모델 분기와 테스트만 둔다.

### 주요 설계 결정

- `mass_only`, `position_observed`, `unavailable`을 명시적으로 분리한다.
- 위치 관측이 없으면 상대 분포의 색이 강해도 출처는 합성이며 ±35% 설명용
  불확실성을 표시한다.
- 근거가 없을 때 모든 구간을 `판정 불가`로 만들며 정상/안전으로 내리지 않는다.

### 주요 파일

- `app/react/aice/thicknessView.ts`, `thicknessView.test.ts`
- `app/react/aice/ThicknessSection.tsx`
- `app/react/aice/AicePrototype.tsx`, 관련 테스트
- `app/react/aice/design-system.css`
- `docs/baseline/phase-5-thickness-section.png`

### 테스트와 결과

- `npm run typecheck`: 통과
- `npm run test:react`: 25 passed
- `npm run test:e2e`: 4 passed
- 단면 모델 회귀: 7자산, mass-only 합성 위치, 관측 근거 강화, 판정 불가,
  도포 입력에 따른 위험·곡선 이유 변경 검증

### 실패와 수정

- 새 도포 선택을 필수로 만들면서 기존 샘플 경로에 선택 단계가 빠졌다. 컴포넌트와
  E2E에서 목표 근처 도포를 선택한 뒤 확인하도록 갱신했다.

### 완료 커밋

커밋 생성 후 해시를 보충한다.

### 다음 Phase 시작점

Phase 6 TODO와 완료 조건을 다시 읽고 가마 세로 단면, 선반/기물, 센서 프리셋과
위치 조절, 시간 재생, 물리 데이터와 설명용 열·대류 시각 효과를 분리해 구현한다.
