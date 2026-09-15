# 프론트엔드·백엔드 단계별 개발 계획

완료 표시는 코드 구현과 자동 검증 기준입니다. 실제 이메일 링크와 실제 사용자 간 데이터 분리는 수동 검증 항목으로 따로 둡니다.

## 1. 실행 환경과 데이터베이스

- [x] React 19 + TypeScript + Vite 실행 환경
- [x] 기존 Python 계산 엔진을 Pyodide로 유지하고 빌드에 자동 포함
- [x] Supabase PostgreSQL 초기 스키마와 RLS 정책
- [x] 실제 Supabase 인증 API, `profiles`, `work_records` 연결 확인
- [x] 재사용 가능한 연결 검사 명령 `npm run db:check`

## 2. 프론트엔드 시뮬레이터 전환

- [x] Pyodide 호출을 `simulator/engine.ts`의 단일 순차 브리지로 분리
- [x] 목표 → 레시피 → 시유 → 점검 → 소성 → 결과 6단계를 React state/hooks로 이전
- [x] 구형 `app/app.js` DOM 컨트롤러 제거 및 StrictMode 활성화
- [x] 비동기 취소, 중복 실행 차단, E 미입력 제어, 출처·판정 불가 표시 유지
- [x] 실제 Pyodide를 사용하는 Edge 전체 흐름 회귀 테스트

## 3. 로그인과 프로필

- [x] Supabase Auth 이메일 가입, 로그인, 로그아웃
- [x] 가입 확인 메일 안내, 비밀번호 재설정/변경
- [x] 세션 복원과 복구 링크 경합 처리
- [x] 표시 이름 프로필 생성/수정
- [ ] 실제 이메일 확인·재설정 링크 수동 검증
- [ ] 실제 Supabase의 두 테스트 계정으로 데이터 분리 수동 검증

## 4. FastAPI 백엔드

- [x] `/api/v1/health`, `/readiness`
- [x] Supabase access token 검증과 사용자 토큰 기반 RLS 전달
- [x] 프로필 조회/저장 API
- [x] 개인 작업 기록 CRUD API
- [x] 로그인 사용자의 공개 기록 목록/상세 API
- [x] CORS, 입력 검증, 오류 응답, API 테스트
- [x] 관리자/service-role 키 없이 실제 Supabase 연결 확인

## 5. 개인 작업 기록 프론트엔드

- [x] Python `export_state` 기반 schema version 1 스냅샷
- [x] 현재 작업 저장, 목록, 상세 JSON, 제목 수정, 삭제
- [x] 저장 중 중복 제출 방지와 서버 성공 후 완료 표시
- [x] 기본 비공개 및 공개/비공개 전환
- [ ] 저장된 스냅샷을 시뮬레이터 상태로 복원
- [ ] 20개 초과 기록의 이전/다음 페이지 UI

## 6. 공개 공유 프론트엔드

- [x] 다른 로그인 사용자의 공개 기록 목록과 상세 조회
- [x] 공개 해제 후 목록에서 제외하는 DB 정책 테스트
- [x] 타인의 수정·삭제 차단 DB/API 테스트
- [ ] 작성자 표시용 공개 프로필 뷰 또는 별도 테이블 마이그레이션
- [ ] 공개 기록 페이지네이션 UI
- [ ] 익명 공개가 필요할 경우 별도 정책 결정

## 7. 배포 준비

- [ ] 개발용/운영용 Supabase 프로젝트 분리
- [ ] 운영 Auth redirect URL과 이메일 발송 설정
- [ ] FastAPI 호스팅과 프런트엔드 `VITE_API_URL` 설정
- [ ] DB 백업·복구 및 마이그레이션 배포 절차
- [ ] 실제 두 계정으로 가입 → 저장 → 공개 → 타인 조회 전체 흐름 검증
