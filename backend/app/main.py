from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .aimlapi import AimlapiClient, AimlapiSettings
from .config import Settings, get_settings
from .dependencies import error_detail
from .models import HealthResponse, ReadinessResponse
from .routes import router
from .supabase import SupabaseGateway


def _aimlapi_settings(settings: Settings) -> AimlapiSettings:
    return AimlapiSettings(
        api_key=settings.aimlapi_api_key,
        base_url=settings.aimlapi_base_url,
        text_model=settings.aimlapi_text_model,
        image_model=settings.aimlapi_image_model,
        timeout_seconds=settings.aimlapi_timeout_seconds,
    )


def create_app(
    settings: Settings | None = None,
    gateway: SupabaseGateway | None = None,
    llm: AimlapiClient | None = None,
) -> FastAPI:
    resolved_settings = settings or get_settings()
    resolved_gateway = gateway or SupabaseGateway(resolved_settings)
    resolved_llm = llm or AimlapiClient(_aimlapi_settings(resolved_settings))
    owns_gateway = gateway is None
    owns_llm = llm is None

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield
        if owns_gateway:
            await resolved_gateway.close()
        if owns_llm:
            await resolved_llm.close()

    app = FastAPI(title="Kiln API", version="1.0.0", lifespan=lifespan)
    app.state.settings = resolved_settings
    app.state.supabase = resolved_gateway
    app.state.llm = resolved_llm
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved_settings.cors_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.include_router(router)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(
        _request: Request, _exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "detail": error_detail("validation_error", "요청 값이 올바르지 않습니다.")
            },
        )

    @app.exception_handler(HTTPException)
    async def http_handler(_request: Request, exc: HTTPException) -> JSONResponse:
        detail = exc.detail
        if not isinstance(detail, dict) or "code" not in detail:
            detail = error_detail("http_error", str(detail))
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": detail},
            headers=exc.headers,
        )

    @app.get("/api/v1/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(status="ok")

    @app.get("/api/v1/readiness", response_model=ReadinessResponse)
    async def readiness() -> ReadinessResponse:
        if not resolved_settings.configured:
            raise HTTPException(
                503,
                detail=error_detail(
                    "supabase_not_configured", "Supabase 연결 정보가 설정되지 않았습니다."
                ),
            )
        return ReadinessResponse(status="ready", supabase_configured=True)

    return app


app = create_app()
