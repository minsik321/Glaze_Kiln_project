# React 프런트엔드

저장소 루트에서 Node.js 22.12 이상으로 실행합니다.

```powershell
npm ci
npm run dev
```

앱은 `http://127.0.0.1:5173/`에서 실행합니다. 작업 기록과 LLM 레시피 추천을
사용하려면 FastAPI도 별도 터미널에서 실행해야 합니다.

```powershell
.\\.venv\\Scripts\\python.exe -m uvicorn backend.app.main:app --reload --port 8000
```

## 구조

- `react/aice/`: AICE 안내형 화면(목표→레시피→도포→점검→소성→결과) — 두께·
  소성곡선·비중 판정을 TypeScript로 직접 계산한다(각 파일 상단에 대응하는
  `src/kiln` 모듈을 명시).
- `react/auth/`: Supabase Auth와 프로필 UI
- `react/records/`: FastAPI를 사용하는 개인·공개 작업 기록 UI
- `react/lib/api.ts`: FastAPI 클라이언트
- `react/lib/supabase.ts`: 브라우저 인증 클라이언트

AICE 화면의 물리 판정 계산은 TypeScript로 재구현되어 있으며(Pyodide 브리지
없음), `src/kiln`의 대응 모듈을 원본으로 삼아 동일한 상수·문구를 유지한다.
LLM 레시피 후보 생성과 이미지 생성은 FastAPI 백엔드(`backend/app`, `kiln.llm`)
를 거친다. 출처 표시, 판정 불가 표시, 미정 계수의 명시적 입력, 경고 시 진행
허용 규칙을 유지합니다.

## 검증

```powershell
npm run typecheck
npm run test:react
npm run test:e2e
npm run build
```

상세 설정은 [개발 환경](../docs/DEVELOPMENT.md), 현재 작업 상태는
[LLM 프런트도어 TODO](../docs/AICE_LLM_FRONTDOOR_TODO.md)를 참고하세요.
