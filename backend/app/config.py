from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from dotenv import dotenv_values, load_dotenv
from pydantic import BaseModel, ConfigDict, Field, field_validator

BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = BACKEND_DIR.parent


class Settings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    request_timeout_seconds: float = Field(default=10.0, gt=0, le=60)
    #: LLM 프런트도어(TODO Phase 2, §8) — aimlapi.com 단일 게이트웨이.
    #: 프런트엔드로 절대 전달하지 않는다(backend/.env 전용).
    aimlapi_api_key: str = ""
    aimlapi_base_url: str = "https://api.aimlapi.com/v1"
    aimlapi_text_model: str = ""
    aimlapi_image_model: str = ""
    aimlapi_timeout_seconds: float = Field(default=30.0, gt=0, le=120)
    #: 일시적 오류(429·502·503·504) 재시도 — aimlapi.py._RETRYABLE_STATUSES 참고.
    aimlapi_max_retries: int = Field(default=2, ge=0, le=5)
    aimlapi_retry_backoff_seconds: float = Field(default=1.0, gt=0, le=10)

    #: RAG(TODO Phase 3 후속) — Docker로 띄운 Qdrant 벡터 DB(vectorstore.py).
    #: 비어 있으면(기본값) RAG는 조용히 꺼진다 — 레시피 추천 자체는 그대로
    #: 동작한다(콜드스타트와 같은 태도, aimlapi_configured와 대칭).
    qdrant_url: str = ""
    qdrant_collection: str = "aice_knowledge"

    @field_validator("supabase_url", "supabase_publishable_key")
    @classmethod
    def strip_values(cls, value: str) -> str:
        return value.strip().rstrip("/")

    @property
    def configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_publishable_key)

    @property
    def aimlapi_configured(self) -> bool:
        return bool(self.aimlapi_api_key and self.aimlapi_text_model)

    @property
    def qdrant_configured(self) -> bool:
        return bool(self.qdrant_url)

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv(BACKEND_DIR / ".env", override=False)
        vite_env = dotenv_values(ROOT_DIR / ".env.local")
        origins = tuple(value.strip() for value in os.getenv(
            "BACKEND_CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173",
        ).split(",") if value.strip())
        return cls(
            supabase_url=os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
            or vite_env.get("VITE_SUPABASE_URL") or "",
            supabase_publishable_key=os.getenv("SUPABASE_PUBLISHABLE_KEY")
            or os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY")
            or vite_env.get("VITE_SUPABASE_PUBLISHABLE_KEY")
            or vite_env.get("VITE_SUPABASE_ANON_KEY") or "",
            cors_origins=origins,
            request_timeout_seconds=float(os.getenv("BACKEND_REQUEST_TIMEOUT_SECONDS", "10")),
            aimlapi_api_key=os.getenv("AIMLAPI_API_KEY", ""),
            aimlapi_base_url=os.getenv("AIMLAPI_BASE_URL", "https://api.aimlapi.com/v1"),
            aimlapi_text_model=os.getenv("AIMLAPI_TEXT_MODEL", ""),
            aimlapi_image_model=os.getenv("AIMLAPI_IMAGE_MODEL", ""),
            aimlapi_timeout_seconds=float(os.getenv("AIMLAPI_TIMEOUT_SECONDS", "30")),
            aimlapi_max_retries=int(os.getenv("AIMLAPI_MAX_RETRIES", "2")),
            aimlapi_retry_backoff_seconds=float(
                os.getenv("AIMLAPI_RETRY_BACKOFF_SECONDS", "1.0")
            ),
            qdrant_url=os.getenv("QDRANT_URL", ""),
            qdrant_collection=os.getenv("QDRANT_COLLECTION", "aice_knowledge"),
        )


@lru_cache
def get_settings() -> Settings:
    return Settings.from_env()
