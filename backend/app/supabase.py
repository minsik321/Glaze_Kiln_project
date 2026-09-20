from __future__ import annotations

from typing import Any

import httpx

from .config import Settings
from .models import AuthUser


class SupabaseError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code, self.code, self.message = status_code, code, message


class SupabaseGateway:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self._owns_client = client is None
        self.client = client or httpx.AsyncClient(timeout=settings.request_timeout_seconds)

    async def close(self) -> None:
        if self._owns_client:
            await self.client.aclose()

    def _headers(self, token: str, prefer: str | None = None) -> dict[str, str]:
        headers = {
            "apikey": self.settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        if prefer:
            headers["Prefer"] = prefer
        return headers

    async def get_user(self, token: str) -> AuthUser:
        response = await self._request(
            "GET", f"{self.settings.supabase_url}/auth/v1/user", headers=self._headers(token)
        )
        if response.status_code != 200:
            raise SupabaseError(401, "invalid_token", "로그인이 만료되었거나 유효하지 않습니다.")
        try:
            return AuthUser.model_validate(response.json())
        except (ValueError, TypeError) as exc:
            raise SupabaseError(
                502, "invalid_upstream_response", "인증 응답 형식이 올바르지 않습니다."
            ) from exc

    async def select(
        self, table: str, token: str, params: dict[str, str | int]
    ) -> list[dict[str, Any]]:
        response = await self._request(
            "GET",
            f"{self.settings.supabase_url}/rest/v1/{table}",
            headers=self._headers(token),
            params=params,
        )
        return self._list_json(response)

    async def rpc(self, name: str, token: str, body: dict[str, Any]) -> list[dict[str, Any]]:
        response = await self._request(
            "POST", f"{self.settings.supabase_url}/rest/v1/rpc/{name}",
            headers=self._headers(token), json=body,
        )
        return self._list_json(response)

    async def insert(
        self, table: str, token: str, body: dict[str, Any], *, upsert: bool = False,
        conflict: str = "id",
    ) -> list[dict[str, Any]]:
        prefer, params = "return=representation", {}
        if upsert:
            prefer += ",resolution=merge-duplicates"
            params["on_conflict"] = conflict
        response = await self._request(
            "POST",
            f"{self.settings.supabase_url}/rest/v1/{table}",
            headers=self._headers(token, prefer),
            params=params,
            json=body,
        )
        return self._list_json(response)

    async def update(
        self, table: str, token: str, body: dict[str, Any], params: dict[str, str]
    ) -> list[dict[str, Any]]:
        response = await self._request(
            "PATCH",
            f"{self.settings.supabase_url}/rest/v1/{table}",
            headers=self._headers(token, "return=representation"),
            params=params,
            json=body,
        )
        return self._list_json(response)

    async def delete(
        self, table: str, token: str, params: dict[str, str]
    ) -> list[dict[str, Any]]:
        response = await self._request(
            "DELETE",
            f"{self.settings.supabase_url}/rest/v1/{table}",
            headers=self._headers(token, "return=representation"),
            params=params,
        )
        return self._list_json(response)

    def _require_configured(self) -> None:
        if not self.settings.configured:
            raise SupabaseError(
                503, "supabase_not_configured", "Supabase 연결 정보가 설정되지 않았습니다."
            )

    async def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        self._require_configured()
        try:
            response = await self.client.request(method, url, **kwargs)
        except httpx.TimeoutException as exc:
            raise SupabaseError(
                504, "supabase_timeout", "Supabase 응답 시간이 초과되었습니다."
            ) from exc
        except httpx.HTTPError as exc:
            raise SupabaseError(
                502, "supabase_unavailable", "Supabase에 연결할 수 없습니다."
            ) from exc
        if response.status_code >= 400:
            # Authentication maps every upstream auth rejection to a stable 401.
            if response.status_code == 401 and "/auth/v1/user" in url:
                return response
            status = (
                response.status_code
                if response.status_code in {400, 401, 403, 404, 409, 422}
                else 502
            )
            message, code = "Supabase 요청을 처리하지 못했습니다.", "supabase_error"
            try:
                data = response.json()
                message = str(data.get("message") or data.get("msg") or message)
                code = str(data.get("code") or code)
            except ValueError:
                pass
            raise SupabaseError(status, code, message)
        return response

    @staticmethod
    def _list_json(response: httpx.Response) -> list[dict[str, Any]]:
        try:
            data = response.json()
        except ValueError as exc:
            raise SupabaseError(
                502, "invalid_upstream_response", "Supabase 응답 형식이 올바르지 않습니다."
            ) from exc
        if not isinstance(data, list) or any(not isinstance(row, dict) for row in data):
            raise SupabaseError(
                502, "invalid_upstream_response", "Supabase 응답 형식이 올바르지 않습니다."
            )
        return data
