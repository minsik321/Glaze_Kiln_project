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
from .vectorstore import AiceVectorStore, VectorStoreUnavailable


def _aimlapi_settings(settings: Settings) -> AimlapiSettings:
    return AimlapiSettings(
        api_key=settings.aimlapi_api_key,
        base_url=settings.aimlapi_base_url,
        text_model=settings.aimlapi_text_model,
        target_model=settings.aimlapi_target_model,
        image_model=settings.aimlapi_image_model,
        timeout_seconds=settings.aimlapi_timeout_seconds,
        connect_timeout_seconds=settings.aimlapi_connect_timeout_seconds,
        max_retries=settings.aimlapi_max_retries,
        retry_backoff_seconds=settings.aimlapi_retry_backoff_seconds,
    )


def _vectorstore(settings: Settings) -> AiceVectorStore | None:
    """RAG(수정 사항 정리 3번) — QDRANT_URL이 비어 있거나 qdrant-client가
    설치되지 않았으면 ``None``. 앱 기동 자체를 막지 않는다(aimlapi_configured
    와 같은 콜드스타트 태도) — ``QdrantClient(url=...)`` 생성자는 즉시
    연결하지 않으므로, Docker가 아직 안 떠 있어도 여기서는 실패하지 않고
    첫 검색/색인 호출에서만 ``VectorStoreUnavailable``이 난다."""
    if not settings.qdrant_configured:
        return None
    try:
        return AiceVectorStore(url=settings.qdrant_url, collection=settings.qdrant_collection)
    except VectorStoreUnavailable:
        return None


def create_app(
    settings: Settings | None = None,
    gateway: SupabaseGateway | None = None,
    llm: AimlapiClient | None = None,
    vectorstore: AiceVectorStore | None = None,
) -> FastAPI:
    resolved_settings = settings or get_settings()
    resolved_gateway = gateway or SupabaseGateway(resolved_settings)
    resolved_llm = llm or AimlapiClient(_aimlapi_settings(resolved_settings))
    resolved_vectorstore = vectorstore or _vectorstore(resolved_settings)
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
