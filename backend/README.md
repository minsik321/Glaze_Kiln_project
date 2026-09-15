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
