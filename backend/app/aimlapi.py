"""LLM 프런트도어 — aimlapi.com 게이트웨이 (LLM 프런트도어 TODO Phase 2).

aimlapi.com은 OpenAI 호환 ``/chat/completions`` 포맷과, 별도의
``/images/generations`` 엔드포인트를 제공하는 단일 게이트웨이다(§8). 공급사
전환 여지를 남기기 위해 요청 빌더를 provider-agnostic하게 짠다 — 이
클라이언트가 아는 것은 "OpenAI 호환 chat 포맷"과 "이미지 생성 포맷" 뿐이고,
aimlapi 고유의 것은 base_url·모델명·API 키뿐이다.

이 모듈은 ``kiln.domain``/``kiln.chem``과 달리 **결정론적이지 않다.** 호출마다
다른 결과가 나올 수 있고, 실제 소성 결과를 예측하지 않는다 — 그래서 이
모듈이 만드는 값은 항상 ``source_type="synthetic"`` 또는 ``"inferred"``로
표시되고, 절대 ``"observed"``로 격상되지 않는다(00절,
``kiln.aice.contract``와 같은 원칙). API 키는 이 모듈에도, 호출부에도
로그로 남기지 않는다 — 백엔드(``backend/.env``)에만 두고 프런트엔드로
전달하지 않는다(§8).

**이 파일이 ``src/kiln`` 이 아니라 ``backend/app`` 에 있는 이유**: ``src/kiln``
전체가 ``app/kiln-manifest.json`` 을 통해 그대로 브라우저(Pyodide)로
배송되고, 그 경계는 순수 stdlib이어야 한다
(``tests/webapp/test_manifest.py::test_manifest_is_pure_stdlib_on_the_browser_side``).
이 모듈은 ``httpx`` 에 의존하므로 그 경계 안에 둘 수 없다 — ``backend.app.supabase.SupabaseGateway``
와 같은 이유로 같은 자리에 둔다.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any

import httpx

__all__ = ["AimlapiSettings", "AimlapiError", "AimlapiClient"]


@dataclass(frozen=True, slots=True)
class AimlapiSettings:
    """aimlapi.com 연동 설정. ``backend.app.config.Settings`` 에서 채워진다."""

    api_key: str
    base_url: str = "https://api.aimlapi.com/v1"
    text_model: str = ""
    image_model: str = ""
    timeout_seconds: float = 30.0

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.text_model)

    @property
    def image_configured(self) -> bool:
        return bool(self.api_key and self.image_model)


class AimlapiError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code, self.code, self.message = status_code, code, message


class AimlapiClient:
    """OpenAI 호환 chat/completions + 이미지 생성 게이트웨이.

    ``backend.app.supabase.SupabaseGateway`` 와 같은 모양(설정 주입, 소유
    클라이언트 close, ``_request`` 공통 오류 변환)을 따른다 — 이 저장소의
    관례다. FastAPI를 import하지 않는다 — 백엔드 없이도 단위 테스트할 수
    있어야 한다.
    """

    def __init__(
        self, settings: AimlapiSettings, client: httpx.AsyncClient | None = None
    ) -> None:
        self.settings = settings
        self._owns_client = client is None
        self.client = client or httpx.AsyncClient(timeout=settings.timeout_seconds)

    async def close(self) -> None:
        if self._owns_client:
            await self.client.aclose()

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.settings.api_key}",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _parse_json_object(content: Any) -> dict[str, Any]:
        """Parse an object even when a provider wraps it in prose or fences."""
        if not isinstance(content, str):
            raise AimlapiError(
                502, "invalid_llm_json", "LLM 응답이 JSON 문자열이 아닙니다."
            )
        start = content.find("{")
        if start < 0:
            raise AimlapiError(
                502, "invalid_llm_json", "LLM이 고정 JSON 스키마로 응답하지 않았습니다."
            )
        try:
            parsed, _ = json.JSONDecoder().raw_decode(content[start:])
        except json.JSONDecodeError as exc:
            raise AimlapiError(
                502, "invalid_llm_json", "LLM이 고정 JSON 스키마로 응답하지 않았습니다."
            ) from exc
        if not isinstance(parsed, dict):
            raise AimlapiError(
                502, "invalid_llm_json", "LLM 응답이 JSON 객체가 아닙니다."
            )
        return parsed

    async def chat_json(
        self, messages: list[dict[str, Any]], *, temperature: float = 0.4
    ) -> dict[str, Any]:
        """고정 JSON 스키마 응답을 기대하는 채팅 호출.

        ``response_format={"type": "json_object"}`` 을 요청하지만 모델이
        이를 무시할 수 있으므로, JSON이 아닌 응답을 조용히 빈 값으로
        넘기지 않고 ``AimlapiError`` 로 실패시킨다 — 화면 1이 지어낸
        후보를 받는 것보다 빈 화면을 보여주는 편이 낫다.
        """
        self._require_configured()
        payload = {
            "model": self.settings.text_model,
            "messages": messages,
            "temperature": temperature,
            "response_format": {"type": "json_object"},
        }
        response = await self._request("POST", "/chat/completions", json=payload)
        data = response.json()
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise AimlapiError(
                502, "invalid_upstream_response", "LLM 응답 형식이 올바르지 않습니다."
            ) from exc
        return self._parse_json_object(content)

    async def generate_image(
        self,
        prompt: str,
        *,
        reference_image_b64: str | None = None,
        size: str = "1024x1024",
    ) -> bytes:
        """이미지 한 장을 생성해 원본 바이트로 돌려준다.

        ``reference_image_b64`` 는 색상 참고 사진(image-conditioned 생성) —
        지원 모델(기본 ``google/nano-banana``)에서만 반영된다(§8). 미지원
        모델에 넘기면 무시될 수 있다.
        """
        if not self.settings.image_configured:
            raise AimlapiError(
                503, "aimlapi_image_not_configured", "이미지 생성 모델이 설정되지 않았습니다."
            )
        payload: dict[str, Any] = {
            "model": self.settings.image_model,
            "prompt": prompt,
            "size": size,
        }
        if reference_image_b64:
            payload["image"] = reference_image_b64
        response = await self._request("POST", "/images/generations", json=payload)
        data = response.json()
        try:
            item = data["data"][0]
        except (KeyError, IndexError, TypeError) as exc:
            raise AimlapiError(
                502, "invalid_upstream_response", "이미지 생성 응답 형식이 올바르지 않습니다."
            ) from exc
        if item.get("b64_json"):
            encoded = item["b64_json"]
            if not isinstance(encoded, str):
                raise AimlapiError(
                    502, "invalid_upstream_response", "이미지 base64 응답 형식이 올바르지 않습니다."
                )
            # Some OpenAI-compatible gateways return a complete data URL in
            # b64_json instead of the bare base64 payload.
            if encoded.startswith("data:"):
                try:
                    encoded = encoded.split(",", 1)[1]
                except IndexError as exc:
                    raise AimlapiError(
                        502, "invalid_upstream_response", "이미지 data URL 형식이 올바르지 않습니다."
                    ) from exc
            try:
                return base64.b64decode(encoded, validate=True)
            except (ValueError, TypeError) as exc:
                raise AimlapiError(
                    502, "invalid_upstream_response", "이미지 base64를 해석하지 못했습니다."
                ) from exc
        if item.get("url"):
            # AIMLAPI commonly returns a CDN URL. CDN download URLs may redirect
            # to the final object-storage URL, so the image fetch must follow it.
            image_response = await self._request(
                "GET", item["url"], absolute=True, follow_redirects=True
            )
            return image_response.content
        raise AimlapiError(
            502, "invalid_upstream_response", "이미지 생성 응답에 데이터가 없습니다."
        )

    def _require_configured(self) -> None:
        if not self.settings.configured:
            raise AimlapiError(
                503, "aimlapi_not_configured", "aimlapi.com 연동이 설정되지 않았습니다."
            )

    async def _request(
        self, method: str, path: str, *, absolute: bool = False, **kwargs: Any
    ) -> httpx.Response:
        url = path if absolute else f"{self.settings.base_url.rstrip('/')}{path}"
        headers = None if absolute else self._headers()
        try:
            response = await self.client.request(method, url, headers=headers, **kwargs)
        except httpx.TimeoutException as exc:
            raise AimlapiError(
                504, "aimlapi_timeout", "aimlapi.com 응답 시간이 초과되었습니다."
            ) from exc
        except httpx.HTTPError as exc:
            raise AimlapiError(
                502, "aimlapi_unavailable", "aimlapi.com에 연결할 수 없습니다."
            ) from exc
        if response.status_code >= 400:
            message, code = "aimlapi.com 요청을 처리하지 못했습니다.", "aimlapi_error"
            try:
                data = response.json()
                err = data.get("error")
                if isinstance(err, dict):
                    message = str(err.get("message") or message)
                elif isinstance(err, str):
                    message = err
            except ValueError:
                pass
            status = (
                response.status_code
                if response.status_code in {400, 401, 403, 404, 422, 429}
                else 502
            )
            raise AimlapiError(status, code, message)
        return response
