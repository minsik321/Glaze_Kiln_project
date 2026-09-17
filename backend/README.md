# Kiln API

FastAPI verifies and forwards the user Supabase access token. Supabase keeps
authentication, PostgreSQL, and row-level security; no service-role key is used.

```powershell
Copy-Item backend/.env.example backend/.env
py -m pip install -e ".[backend-dev]"
py -m uvicorn backend.app.main:app --reload --port 8000
py -m pytest backend/tests -q
```

The root `.env.local` with `VITE_SUPABASE_*` is also supported.

## RAG (원료 화학·성분 상관관계·과거 레시피 검색)

레시피 후보 서술(2차 LLM 호출)에 참고 문서를 붙이려면 Docker로 Qdrant
벡터 DB를 띄운다. 안 띄워도 API는 그대로 동작한다(RAG는 있으면 좋은
보강일 뿐, 없으면 조용히 꺼진다 — `Settings.qdrant_configured` 참고).

```powershell
docker compose up -d          # 레포 루트에서, 최초 1회
py backend/scripts/ingest_corpus.py   # 원료 화학 + 성분 상관관계 시딩(최초 1회, 재실행해도 안전)
```

과거 레시피 코퍼스는 별도 스크립트가 아니라, 평가 완료(evaluated)된
회차를 `/api/v1/aice-runs`로 저장할 때마다 자동으로 그 사용자의 개인
컬렉션에 색인된다(`backend/app/routes.py`의 `create_aice_run` 참고).
