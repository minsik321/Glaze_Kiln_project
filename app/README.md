# React 프런트엔드

저장소 루트에서 Node.js 22.12 이상으로 실행합니다.

```powershell
npm ci
npm run dev
```

앱은 `http://127.0.0.1:5173/`에서 실행합니다. 작업 기록을 사용하려면 FastAPI도 별도 터미널에서 실행해야 합니다.

```powershell
.\\.venv\\Scripts\\python.exe -m uvicorn backend.app.main:app --reload --port 8000
```

## 구조

- `react/Simulator.tsx`, `react/simulator/`: 6단계 React 시뮬레이터와 Pyodide 브리지
- `react/auth/`: Supabase Auth와 프로필 UI
- `react/records/`: FastAPI를 사용하는 개인·공개 작업 기록 UI
- `react/lib/api.ts`: FastAPI 클라이언트
- `react/lib/supabase.ts`: 브라우저 인증 클라이언트
- `../scripts/python-assets.mjs`: Python 소스를 개발 서버와 빌드에 포함

계산은 Python에서만 수행합니다. 프런트엔드는 `export_state` 스냅샷을 FastAPI에 저장합니다.
출처 표시, 판정 불가 표시, 미정 계수의 명시적 입력, 경고 시 진행 허용 규칙을 유지합니다.

## 검증

```powershell
npm run typecheck
npm run test:react
npm run test:e2e
npm run build
```

Pyodide는 CDN에서 받아오므로 최초 실행과 브라우저 회귀 테스트에 네트워크가 필요합니다.
상세 설정은 [개발 환경](../docs/DEVELOPMENT.md), 남은 작업은 [TODO](../docs/TODO.md)를 참고하세요.
