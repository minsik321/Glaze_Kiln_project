# AICE 로컬 실행, 마이그레이션, 백업과 복구

기준일: 2026-09-17
대상: AiceRun schema v2 로컬 MVP

## 안전 경계

- 실제 가마·센서·컨트롤러에는 연결하지 않는다.
- `.env.local`에는 publishable key만 두며 service-role/secret key를 브라우저에
  넣지 않는다.
- `db:reset`은 로컬 DB 데이터를 삭제한다. 검증된 백업이 없으면 실행하지 않는다.
- DB dump에는 Storage 파일 본문이 포함되지 않는다. `aice_photos` 메타데이터와
  비공개 버킷 객체는 별도로 함께 백업해야 한다.

## 새 로컬 환경 실행

```powershell
npm ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[backend-dev]"
Copy-Item .env.example .env.local
npm run db:start
npm run db:reset
npm run dev:backend
```

다른 터미널에서 `npm run dev`를 실행한다. Supabase 시작 출력의 로컬 URL과
publishable key를 `.env.local`에 넣고 프런트엔드를 다시 시작한다.

## 기존 로컬 DB 마이그레이션

1. 아래 백업 절차로 데이터와 Storage 객체를 먼저 보존한다.
2. 현재 적용 상태를 확인한다.
3. 데이터 삭제 없이 새 마이그레이션만 적용한다.

```powershell
npx supabase migration list --local
npx supabase migration up --local
npm run db:types
```

적용 순서는 `20260915000000_initial.sql` 다음
`20260916010000_aice_runs.sql`이다. 기존 `work_records`는 삭제·변환하지 않고
`legacy_work_records_readonly`로 계속 읽는다.

## 백업

저장소 밖의 접근 제한 폴더를 권장한다. 아래 예시의 날짜와 경로는 직접 정한다.

```powershell
New-Item -ItemType Directory -Force .local-backups\2026-09-17
npx supabase db dump --local --data-only --use-copy --file .local-backups\2026-09-17\aice-data.sql
Copy-Item supabase\migrations .local-backups\2026-09-17\migrations -Recurse
Get-FileHash .local-backups\2026-09-17\aice-data.sql -Algorithm SHA256
```

사진을 실제로 사용했다면 DB dump만으로 완료 처리하지 않는다. 로컬 Supabase
Storage의 `aice-recipe-photos`, `aice-result-photos` 객체를 소유자 UUID 경로를
유지해 별도 내보내고 파일 목록·크기·해시를 함께 기록한다. 이 MVP의 사진 입력은
비활성 상태이므로 현재 저장소에는 백업할 실제 사진 객체가 없다.

## 빈 로컬 DB로 복구 검증

이 절차는 파괴적이다. 원본 로컬 DB가 아니라 복구 시험용 환경에서만 수행한다.

1. dump 해시가 백업 시 기록과 같은지 확인한다.
2. 새 로컬 스택에서 마이그레이션을 적용한다.
3. 로컬 PostgreSQL 클라이언트로 데이터 dump를 복원한다.
4. 아래 검증 쿼리와 두 계정 시나리오를 수행한다.

```powershell
npm run db:start
npm run db:reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f .local-backups\2026-09-17\aice-data.sql
npm run db:types
npm run test:database
```

Storage 백업이 있다면 DB 복구 뒤 동일한 비공개 버킷과 소유자 UUID 경로로 객체를
복원한다. `aice_photos.storage_path`와 실제 객체가 일치하는지, 삭제 표시된 사진이
외부에 보이지 않는지 확인한다.

저장소 자동 테스트 `scripts/aice-backup-restore.test.mjs`는 깨끗한 PostgreSQL 호환
DB에 두 마이그레이션을 적용하고 AiceRun·출처·동의를 논리 백업한 뒤 새 DB에
복원해 버전과 출처를 비교한다. 실제 Supabase CLI, Docker volume, Auth와 Storage
객체 복구를 대체하지 않는다.

## 두 계정 수동 보안 시나리오

각 단계의 HTTP 상태와 화면 캡처를 기록한다.

1. 계정 A와 B를 만들고 서로 다른 브라우저 프로필로 로그인한다.
2. A가 AiceRun을 비공개 저장한다. B의 내 기록/공개 기록에서 보이지 않아야 한다.
3. A가 네 동의 항목을 모두 확인하기 전에는 공개 버튼이 비활성인지 확인한다.
4. A가 공개한다. 로그인한 B만 공개 목록/상세를 볼 수 있고 익명 사용자는 볼 수
   없어야 한다.
5. B가 공유 곡선을 선택하면 원본 복사가 아니라 내 가마 조건의 `inferred`
   변환 후보와 재시뮬레이션 안내가 나와야 한다.
6. A가 공유를 철회한다. B의 목록과 기존 상세 재요청이 즉시 차단되어야 한다.
7. A가 실행을 삭제한다. A의 복원 목록에서 사라지고 연결 메타데이터가 cascade
   삭제되는지 확인한다. 실제 사진이 있었다면 Storage 객체 삭제도 별도 확인한다.
8. 백업을 복구 시험 환경에 넣고 A의 실행·출처·버전·동의 상태가 보존되는지,
   철회 기록은 여전히 B에게 보이지 않는지 확인한다.

## 현재 환경에서 확인한 범위

- PGlite에 실제 마이그레이션을 적용한 RLS/철회/논리 백업·복구는 자동 검증했다.
- FastAPI의 동의 강제, 공개, 철회 순서와 프런트 API 계약을 자동 검증했다.
- 이 작업 환경에는 Docker 명령이 설치되어 있지 않고 Supabase CLI가
  `C:\Users\user\.supabase`를 만들 권한도 없어 실제 로컬 스택, `db dump`, `psql`,
  Auth 메일과 두 계정 시나리오는 실행하지 못했다. 이 항목은 성공으로 간주하지
  않는다.

## 코드 롤백

- 개편 전 기준: annotated tag `aice-pre-rebuild-20260916`
- Phase별 복구: `git log --oneline aice-direction-plan`에서 해당 Phase 완료 커밋을
  기준으로 새 브랜치를 만든다.
- 앱만 롤백해도 신규 v2 테이블은 즉시 삭제하지 않는다. 기존 앱은
  `work_records`를 계속 사용할 수 있다.
- 신규 데이터를 제거해야 하는 실제 원격 변경은 백업 확인과 별도 승인 없이
  수행하지 않는다.
