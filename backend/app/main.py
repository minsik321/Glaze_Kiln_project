from __future__ import annotations

from contextlib import asynccontextmanager
import logging
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
from .vectorstore import AiceVectorStore

logger = logging.getLogger(__name__)


def _aimlapi_settings(settings: Settings) -> AimlapiSettings:
    return AimlapiSettings(
        api_key=settings.aimlapi_api_key,
        base_url=settings.aimlapi_base_url,
        text_model=settings.aimlapi_text_model,
        target_model=settings.aimlapi_target_model,
        image_model=settings.aimlapi_image_model,
        embedding_model=settings.aimlapi_embedding_model,
        timeout_seconds=settings.aimlapi_timeout_seconds,
        connect_timeout_seconds=settings.aimlapi_connect_timeout_seconds,
        max_retries=settings.aimlapi_max_retries,
        retry_backoff_seconds=settings.aimlapi_retry_backoff_seconds,
    )


def _vectorstore(
    settings: Settings, gateway: SupabaseGateway, llm: AimlapiClient
) -> AiceVectorStore | None:
    return AiceVectorStore(gateway, embed_fn=llm.embed) if settings.configured else None


def create_app(
    settings: Settings | None = None,
    gateway: SupabaseGateway | None = None,
    llm: AimlapiClient | None = None,
    vectorstore: AiceVectorStore | None = None,
) -> FastAPI:
    resolved_settings = settings or get_settings()
    resolved_gateway = gateway or SupabaseGateway(resolved_settings)
    resolved_llm = llm or AimlapiClient(_aimlapi_settings(resolved_settings))
    resolved_vectorstore = vectorstore or _vectorstore(resolved_settings, resolved_gateway, resolved_llm)
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
    app.state.vectorstore = resolved_vectorstore
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
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        validation_errors = [
            {
                "type": error.get("type"),
                "loc": error.get("loc"),
                "msg": error.get("msg"),
            }
            for error in exc.errors()
        ]
        logger.warning(
            "Request validation failed for %s %s: %s",
            request.method,
            request.url.path,
            validation_errors,
        )
        first_error = validation_errors[0] if validation_errors else {}
        location = ".".join(
            str(part) for part in first_error.get("loc") or () if part != "body"
        )
        reason = first_error.get("msg")
        message = "요청 값이 올바르지 않습니다."
        if location and reason:
            message = f"{message} ({location}: {reason})"
        return JSONResponse(
            status_code=422,
            content={
                "detail": error_detail("validation_error", message)
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
