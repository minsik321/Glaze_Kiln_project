# AICE 개편 기준선

기록일: 2026-09-16  
작업 브랜치: `aice-direction-plan`  
기준 커밋: `a852f597605b8b195ef8fd40148e4308c3da0a16`  
복구 태그: `aice-pre-rebuild-20260916`

## 원격 상태

- `origin/design`: `a852f597605b8b195ef8fd40148e4308c3da0a16` — 기준 커밋과 일치
- `origin/main`: `6ed096da8dc7401acc87ba714c1c01591d1a2f15`
- 원격 확인은 읽기 전용 `git ls-remote --heads origin`으로 수행했다.
- 원격 push, PR, merge는 수행하지 않았다.

## 현행 검증 결과

| 검증 | 결과 |
|---|---|
| Python 계산 코어 | 621 passed |
| DB/RLS 및 Python 자산 | 4 passed |
| React | 10 passed |
| FastAPI | 6 passed |
| TypeScript + Vite 프로덕션 빌드 | 통과 |
| Edge/Pyodide 전체 흐름 E2E | 1 passed |

첫 E2E 실행은 샌드박스의 외부 네트워크 차단으로 Pyodide CDN 동적 import가
실패했다. 동일 테스트를 네트워크가 허용된 환경에서 재실행해 통과했다. 이는
현재 앱이 Pyodide CDN에 의존한다는 기준선 제약으로 남긴다.

Pytest에는 Python 3.14의 asyncio 정책 폐기 예정 경고와 캐시 폴더 생성 경고가
있었으나 테스트 실패는 없었다. Vite 빌드는 500 kB를 넘는 초기 JS 청크 경고를
냈다.

모바일 기준 화면은
[`baseline/phase-0-mobile-390.png`](baseline/phase-0-mobile-390.png)에 기록했다.

## 현행 데이터베이스 기준선

마이그레이션: `supabase/migrations/20260915000000_initial.sql`

- `profiles`: 인증 사용자 프로필. 본인만 CRUD 가능.
- `work_records`: `payload jsonb`, `schema_version`, `is_public`을 갖는 범용 기록.
- 익명 사용자는 두 테이블 모두 접근할 수 없다.
- 로그인 사용자는 본인 기록을 CRUD하고, 타인의 공개 기록만 읽을 수 있다.
- 공개 철회 뒤 타인 조회가 차단되는 정책을 PGlite 정책 테스트로 확인했다.
- 서비스 역할 키는 프런트엔드와 FastAPI에서 사용하지 않는다.

로컬 Supabase CLI는 이 실행 환경에서 사용자 홈 쓰기 제한과 Docker 부재 때문에
기동하지 못했다. 따라서 실제 Auth 메일, Data API, Storage, 두 계정 수동 시나리오는
기준선에서 검증하지 않았으며 성공으로 간주하지 않는다.

## 로컬 구성

1. Node.js 22.12 이상과 Python 3.11 이상을 사용한다.
2. `npm ci`와 `python -m venv .venv` 후
   `.\.venv\Scripts\python.exe -m pip install -e ".[backend-dev]"`를 실행한다.
3. `.env.example`을 `.env.local`로 복사한다. 브라우저 환경에는 Supabase publishable
   key만 넣고 secret/service-role 키를 넣지 않는다.
4. Docker를 사용할 수 있으면 `npm run db:start`, `npm run db:reset`으로 로컬
   Supabase를 준비한다. 데이터가 있으면 reset 대신 migration up을 사용한다.
5. 샘플 계산 흐름은 DB 없이도 실행할 수 있다. 로그인·저장 샘플은 로컬 Supabase
   URL과 publishable key가 필요하다.
6. 프런트엔드는 `npm run dev`, FastAPI는 `npm run dev:backend`로 실행한다.

현행 샘플 데이터는 앱의 기본 프리셋과 Python 코어의 결정적 후보 생성기를
사용한다. 외부 사진이나 특허 도면은 포함하지 않는다.

## 복구

- 코드 비교: `git diff aice-pre-rebuild-20260916..aice-direction-plan`
- 이전 앱 실행: 복구 태그에서 별도 브랜치를 만들어 실행한다.
- 실제 데이터 복구는 Phase 3 마이그레이션과 Phase 10 백업/복구 절차가 추가되기
  전까지 이 기준선의 `work_records` 스키마를 기준으로 한다.

