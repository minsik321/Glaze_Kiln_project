# 개발 환경

## 선택한 구성

React 19 + TypeScript + Vite, 계산은 기존 Python 3.11+ / Pyodide,
데이터베이스는 Supabase PostgreSQL, 인증은 Supabase Auth를 사용합니다.
관계형 사용자/기록 모델과 JSONB 실험 스냅샷을 함께 저장하고 RLS로 소유권을 제한합니다.

공식 문서: https://supabase.com/docs/guides/getting-started/quickstarts/reactjs
권한: https://supabase.com/docs/guides/database/postgres/row-level-security

## 프런트엔드

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

DB 설정 없이도 시뮬레이션은 실행할 수 있습니다. 로그인과 작업 기록에는 Supabase와 FastAPI가 필요합니다.
다른 터미널에서 백엔드를 실행하세요.

```powershell
.\\.venv\\Scripts\\python.exe -m pip install -e ".[backend-dev]"
npm run dev:backend
```

프런트엔드는 `VITE_API_URL`(기본값 `http://127.0.0.1:8000`)로 FastAPI를 호출합니다.

## DB: 두 실행 방법 중 하나

### 로컬 (Docker Desktop 필요)

```powershell
npm run db:start
npm run db:reset
```

`db:reset`은 로컬 데이터 삭제 후 마이그레이션을 다시 적용합니다. 보존할 데이터가 있는 경우
reset 대신 `npx supabase migration up`을 사용하세요. 시작 출력의 API URL과 publishable key를
`.env.local`에 복사하고 Vite를 재시작합니다. 종료: `npm run db:stop`.
Docker가 없는 환경에서는 이 방법을 실행할 수 없습니다.

### Supabase 클라우드

1. 자신의 Supabase 프로젝트를 생성합니다.
2. SQL Editor에서 `supabase/migrations/20260915000000_initial.sql`과
   `20260916010000_aice_runs.sql`을 순서대로 한 번 실행합니다.
3. Project URL과 publishable key를 아래 값에 넣습니다.
4. 인증을 구현할 때 Auth URL Configuration의 Site URL과 Redirect URLs를 개발/운영 주소에 맞춥니다.

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

브라우저에 전달되는 VITE 변수에는 secret/service_role 키를 넣지 않습니다.
클라우드 프로젝트는 사용자가 생성/설정했습니다. `npm run db:check`로 인증 API 응답과 두 테이블의 익명 조회 차단을 확인했습니다. 실제 계정의 로그인/메일 발송은 별도 검증 대상입니다.
로컬 스키마 적용 뒤 `npm run db:types`로 실제 DB 타입을 생성하고 클라이언트에 연결합니다.

## 데이터 모델

- profiles: Auth 사용자 ID, 표시 이름, 생성 시간. 현재 본인만 접근.
- work_records: 작성자 ID, 제목, JSONB payload, schema_version, is_public, 생성/수정 시간.
- aice_runs: AiceRun v2 전체 payload와 목표·레시피·기물·상태 검색 필드.
- aice_run_sources / aice_consents / aice_photos: 출처, 공개 동의·철회, 비공개 사진
  메타데이터. 공개 조회에는 활성 동의와 사진 권리가 모두 필요합니다.
- personal_calibrations: 사용자 소유 가마·소지 보정. 공개 실행과 분리됩니다.
- 모든 기록은 기본 비공개. 본인만 작성/수정/삭제. 다른 로그인 사용자는 공개된 기록만 조회.
- 익명 사용자는 기록을 조회할 수 없습니다. 공개는 payload 전체를 다른 로그인 사용자에게 공유합니다.
- 사용자 삭제 시 연결된 프로필/기록은 함께 삭제됩니다.
- 프로필은 로그인 후 표시 이름을 저장할 때 생성/갱신됩니다.
- FastAPI는 사용자 access token을 검증한 뒤 같은 토큰으로 Supabase Data API를 호출하므로 RLS가 그대로 적용됩니다.
- FastAPI와 프런트엔드에 service-role 키를 사용하지 않습니다.
- 현재 공개 기록은 작성자 UUID와 프로필을 노출하지 않습니다.

## 검증

```powershell
npm run build
npm test
npm run test:backend
npm run test:e2e
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe -m pytest
```

SQL 테스트는 임베디드 PostgreSQL(PGlite)에서 실제 마이그레이션을 적용하고 RLS 권한을
검증합니다. auth.users/auth.uid는 테스트에서 최소 형태로 제공하며 실제 Supabase Auth,
메일 발송, 네트워크 연동을 검증하는 테스트는 아닙니다.

2026-09-17 검증 결과: TypeScript/Vite 빌드, React 테스트 52개, DB/자산 테스트
8개, FastAPI 테스트 10개, Python 계산/계약 테스트 625개, Edge E2E 5개가
통과했습니다. 실제 Supabase Auth/Storage와 두 계정 수동 시나리오는 Docker가 없는
현재 환경에서 실행하지 못했으며 성공으로 간주하지 않습니다. 자세한 실행·백업·복구와
수동 검증 절차는 [AICE_LOCAL_OPERATIONS.md](AICE_LOCAL_OPERATIONS.md)를 따릅니다.

## 연결 확인

```powershell
npm run db:check
```

키는 출력하지 않습니다. 인증 설정 API의 HTTP 200 및 이메일 활성화, 두 테이블의
익명 접근 거부(SQLSTATE 42501)를 확인합니다. 테이블의 존재/접근 제한 확인이며,
전체 스키마 일치나 실제 사용자별 RLS 동작을 증명하는 검사는 아닙니다.
실제 사용자 테스트 전까지는 로컬 PostgreSQL 정책 테스트와 구분합니다.

## 로그인 기능 테스트

개발 주소를 하나로 통일하는 것을 권장합니다: `http://127.0.0.1:5173/`.
Supabase Dashboard → Authentication → URL Configuration에서 Site URL과 Redirect URLs에
이 주소를 등록하세요. localhost를 사용한다면 `http://localhost:5173/`도 등록합니다.
클라우드 프로젝트에는 로컬 `supabase/config.toml` 설정이 자동 반영되지 않습니다.

1. 앱 상단에서 회원가입하고 본인의 이메일로 온 확인 링크를 엽니다.
2. 로그인 후 표시 이름을 저장하고 새로고침해 세션/프로필 유지 여부를 확인합니다.
3. 로그아웃한 뒤 비밀번호 찾기 메일 링크에서 새 비밀번호를 설정합니다.
4. 다른 본인 테스트 계정으로 프로필이 분리되는지 확인합니다.

메일 발송은 사용자가 앱에서 요청할 때만 수행됩니다. 실제 메일 도달/링크 인증과
두 계정 간 공개 기록 조회는 자동 테스트에서 수행하지 않습니다.

## 프런트엔드 및 브라우저 테스트

```powershell
npm run test:react
npm run test:e2e
```

브라우저 테스트는 Windows에 설치된 Edge를 사용합니다. 다른 환경에서는
`playwright.config.ts`의 channel 설정을 변경하고 해당 브라우저를 설치하세요.
현재 AICE 안내 흐름 E2E는 앱 셸과 TypeScript 합성 모델을 검증하며 초기 표시에서
Pyodide 로드를 기다리지 않습니다. 기존 Python 브리지 경로를 직접 검증할 때는 Pyodide
CDN 인터넷 연결이 필요합니다. Windows에서는 Playwright가 시작한 Vite 자식 프로세스가
남을 수 있어, 개발 서버를 먼저 시작한 뒤 `npm run test:e2e`를 실행하는 방법이 가장 안정적입니다.
