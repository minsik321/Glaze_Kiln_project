from __future__ import annotations

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .aimlapi import AimlapiClient
from .models import AuthUser
from .supabase import SupabaseError, SupabaseGateway

bearer_scheme = HTTPBearer(auto_error=False)


def error_detail(code: str, message: str) -> dict[str, str]:
    return {"code": code, "message": message}


def get_gateway(request: Request) -> SupabaseGateway:
    return request.app.state.supabase


def get_llm(request: Request) -> AimlapiClient:
    return request.app.state.llm


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
