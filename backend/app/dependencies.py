from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .aimlapi import AimlapiClient
from .models import AuthUser
from .supabase import SupabaseError, SupabaseGateway
from .vectorstore import AiceVectorStore

bearer_scheme = HTTPBearer(auto_error=False)


def error_detail(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def get_gateway(request: Request) -> SupabaseGateway:
    return request.app.state.supabase


def get_llm(request: Request) -> AimlapiClient:
    return request.app.state.llm


def get_vectorstore(request: Request) -> AiceVectorStore | None:
    """RAG 벡터 DB(있으면). Qdrant가 설정되지 않았거나 라이브러리가 없으면
    ``None`` — 호출부(``routes.py``)는 ``None``이면 조용히 RAG를 건너뛴다
    (수정 사항 정리 3번: RAG는 판단 주체가 아니라 있으면 좋은 보강)."""
    return getattr(request.app.state, "vectorstore", None)


def access_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            401,
            detail=error_detail("authentication_required", "로그인이 필요합니다."),
            headers={"WWW-Authenticate": "Bearer"},
        )
    return credentials.credentials


async def authenticated_user(
    token: str = Depends(access_token),
    gateway: SupabaseGateway = Depends(get_gateway),
) -> AuthUser:
    try:
        return await gateway.get_user(token)
    except SupabaseError as exc:
        raise HTTPException(
            exc.status_code,
            detail=error_detail(exc.code, exc.message),
            headers={"WWW-Authenticate": "Bearer"} if exc.status_code == 401 else None,
        ) from exc
