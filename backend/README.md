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

레시피 참고 문서는 같은 Supabase 프로젝트의 pgvector 테이블에 저장됩니다.
`20261005020000_aice_vectors.sql`과 `20261005030000_aice_vector_corpus.sql`
마이그레이션을 적용하면 공용 참고 문서까지 준비됩니다.

```powershell
.venv\Scripts\python.exe backend/scripts/ingest_corpus.py --output-sql corpus.sql
```

과거 레시피 코퍼스는 별도 스크립트가 아니라, 평가 완료(evaluated)된
회차를 `/api/v1/aice-runs`로 저장할 때마다 자동으로 그 사용자의 개인
벡터 문서로 색인됩니다. 위 명령은 참고 문서 SQL을 다시 생성할 때 사용하며,
공용 문서 변경은 관리자 마이그레이션으로 적용합니다.
