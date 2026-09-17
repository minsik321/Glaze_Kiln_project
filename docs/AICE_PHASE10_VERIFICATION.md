# AICE Phase 10 검증 보고서

검증일: 2026-09-17
브랜치: `aice-direction-plan`

## 결론

저장소에서 실행 가능한 자동 검증, 빌드, Edge E2E, PostgreSQL 호환 RLS와 논리
백업/복구는 통과했다. 실제 Supabase 로컬 스택과 두 실제 Auth 계정·Storage를
사용하는 수동 시나리오는 현재 호스트에 Docker가 없고 CLI 사용자 홈 쓰기가
차단되어 실행하지 못했다. 따라서 Phase 10 전체 완료로 표시하지 않는다.

## 자동 검증 결과

| 영역 | 결과 |
|---|---|
| Python 계산 코어 + AiceRun 계약 | 625 passed |
| DB/RLS/Python 자산/논리 복구 | 8 passed |
| React/TS 컴포넌트·상태·통합 | 52 passed |
| FastAPI 인증·AiceRun·공개/철회 | 10 passed |
| Edge E2E | 5 passed |
| TypeScript 검사 | 통과 |
| Vite 프로덕션 빌드 | 통과, 500 kB 초과 단일 청크 없음 |

E2E는 숫자 입력 없는 9화면 흐름, 390/768/1280px 가로 넘침과 44px 터치 목표,
중복 ID·이름 없는 버튼, 3초 이내 초기 표시, 저모션 대체를 검사한다. AiceRun 저장,
공개 동의, 목록·복원은 컴포넌트/API/백엔드/RLS 계층에서 자동 검증했다.

## 교차 화면·출처 회귀

- 도포 선택 하나를 바꾸면 두께 구간, 위험 문장, 곡선 후보 ID, 가마 기물
  추정온도가 함께 바뀌며 하나의 통합 버전으로 비교된다.
- `observed`, `patent_example`, `patent_range`, `literature`, `inferred`,
  `synthetic` 외 값은 계약과 DB 제약에서 거부된다.
- 문헌 소성 범위, 추정 평균, 합성 불확실성·사진·센서·곡선이 `observed`로
  승격되지 않는 회귀 테스트를 통과했다.
- 근거 없는 평균 두께, 센서 고장값, 실제 에너지는 `판정 불가` 또는 결측으로
  유지한다.

## 성능 점검

로컬 Vite 개발 서버, Windows Edge headless, 390×844 뷰포트에서 측정했다.

- DOMContentLoaded: 98.3 ms
- load event: 132.0 ms
- 가마 설명 애니메이션 60프레임: 평균 13.19 ms, 최대 13.8 ms
- 프로덕션 JS 청크:
  - Supabase vendor 223,730 bytes
  - React vendor 221,699 bytes
  - 초기 앱 73,444 bytes
  - 지연 로드 기록 화면 12,126 bytes

기록 화면을 실제 진입 시점에 지연 로드하고 React/Supabase vendor를 분리했다.
초기 앱 셸은 Pyodide 준비를 기다리지 않는다. `prefers-reduced-motion: reduce`에서는
대류 흐름을 사실상 정지시키며, 저사양 사용자는 정적 열지도·수치 읽기값만으로도
상태를 확인할 수 있다. 수치는 이 로컬 호스트의 회귀 기준이며 저사양 실기기
보장을 뜻하지 않는다.

## 백업·복구

- `scripts/aice-backup-restore.test.mjs`가 깨끗한 DB 두 개에 마이그레이션을 적용한
  뒤 AiceRun, 출처, 활성 동의를 논리 백업·복원하고 버전·출처·공개 상태를 비교했다.
- 실제 Supabase CLI 데이터 dump와 Storage 객체 복구는 실행하지 못했다.
- 운영 절차와 파괴적 단계의 경고는
  [`AICE_LOCAL_OPERATIONS.md`](AICE_LOCAL_OPERATIONS.md)에 기록했다.

## 실행하지 못한 수동 검증

다음 항목은 성공이 아니라 미검증이다.

1. Docker 기반 `supabase start/reset/migration up`
2. Supabase CLI `db dump`와 실제 PostgreSQL `psql` 복구
3. 실제 Auth 두 계정 가입·메일 확인·로그인
4. 계정 A 비공개 저장 → B 차단 → 동의 공개 → B 조회 → 철회 → B 차단
5. 실제 Storage 사진 업로드·권리 공개·철회·삭제와 객체 복구

차단 근거:

- `docker` 실행 파일이 현재 호스트에 없다.
- Supabase CLI가 `C:\Users\user\.supabase` 생성 중 `EPERM`으로 중단된다.

재현 절차는 `AICE_LOCAL_OPERATIONS.md`의 “두 계정 수동 보안 시나리오”를 따른다.
이 다섯 항목이 실제 환경에서 통과해야 Phase 10을 완전히 완료로 바꿀 수 있다.

## 롤백

- 개편 전 태그: `aice-pre-rebuild-20260916`
- 앱 롤백 시 신규 v2 테이블은 삭제하지 않고 기존 `work_records` 경로를 유지한다.
- v2는 v1 읽기 전용 payload로 내보낼 수 있다.
- 실제 원격 DB/Storage 삭제, push, PR과 merge는 수행하지 않았다.
