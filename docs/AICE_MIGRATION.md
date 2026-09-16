# AiceRun v2 마이그레이션과 호환성

## 적용 순서

1. 기존 `work_records`를 백업한다.
2. `20260915000000_initial.sql` 뒤에
   `20260916010000_aice_runs.sql`을 적용한다.
3. 새 실행은 `aice_runs`에 저장한다. 검색에 필요한 목표, 레시피, 기물, 상태만
   정규화하고 전체 계약은 `payload`에 보존한다.
4. 기존 `work_records`는 수정하지 않으며 `legacy_work_records_readonly` 뷰와
   TS/Python v1→v2 변환기로 읽는다.

실제 원격 DB에는 자동 적용하지 않는다. 로컬에서는 `npm run db:reset`이 데이터를
삭제하므로 백업이 필요 없는 새 개발 DB에서만 사용한다. 기존 데이터가 있으면
`npx supabase migration up`을 사용한다.

## 호환 변환

- v1 → v2: 누락 필드는 `inferred` 또는 `synthetic`으로 명시하고 관측하지 않은
  수치는 `null`로 둔다. 기존 범용 payload를 `observed`로 승격하지 않는다.
- v2 → v1: 전체 AiceRun을 `payload.aice_run`에 넣은 읽기 전용 레코드를 만든다.
  자동 공개하지 않으며 `compatibility: read_only`를 표시한다.

## 사진 저장과 삭제

- 버킷은 `aice-recipe-photos`, `aice-result-photos`이며 모두 비공개다.
- 경로 첫 구간은 사용자 UUID여야 한다.
- 메타데이터는 `aice_photos`에 저장하며 권리 확인 없는 사진은 공개할 수 없다.
- 공개 읽기는 실행 공개 상태, 활성 동의, 사진 공개 상태, 권리 확인이 모두
  충족될 때만 허용된다.
- 사용자가 삭제하면 먼저 `deleted_at`으로 외부 조회를 차단하고 Storage 객체를
  제거한다. 실행 삭제 시 메타데이터는 cascade 삭제된다. Storage 객체 정리는
  소유자 권한으로 별도 수행하고 실패 시 재시도 대상으로 남긴다.

## RLS 경계

- 개인 실행과 개인 보정치는 소유자만 읽고 쓸 수 있다.
- `is_public`만으로 공개되지 않는다. 네 가지 동의 항목과 미철회 상태가 필요하다.
- 동의 철회 즉시 타 사용자 실행·출처·사진 조회가 차단된다.
- 익명 사용자는 기존/신규 테이블과 사진 버킷을 읽지 못한다.
- 프런트엔드와 FastAPI는 service-role 키를 사용하지 않는다.

## 복구/되돌리기

안전한 기본 복구는 애플리케이션을 `aice-pre-rebuild-20260916`으로 되돌리고 기존
`work_records`만 읽는 것이다. 신규 테이블을 즉시 삭제하지 않는다. v2 데이터를
v1 읽기 전용 payload로 내보낸 뒤 별도 백업을 확인한 경우에만 신규 테이블과
버킷 제거를 검토한다. 실제 원격 데이터 삭제는 별도 승인 없이는 수행하지 않는다.

