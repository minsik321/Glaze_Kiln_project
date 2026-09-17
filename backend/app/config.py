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
        )


@lru_cache
def get_settings() -> Settings:
    return Settings.from_env()
