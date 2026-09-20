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
는 순수 stdlib 경계를 지킨다(과거 Pyodide로 브라우저에 그대로 배송하던
경계였다; 그 브라우저 배송 경로는 2026-09 제거되었고 현재는 backend/app이
``src/kiln``을 그대로 가져다 쓴다). 이 모듈은 ``httpx`` 에 의존하므로 그
경계 안에 둘 수 없다 — ``backend.app.supabase.SupabaseGateway`` 와 같은
이유로 같은 자리에 둔다.
"""

from __future__ import annotations

import asyncio
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
    #: 1차 호출(목표 분류)에만 쓰는 가벼운 모델. 비우면 text_model로 대체된다
    #: — 두 필드짜리 분류에 배합 서술용 무거운 모델의 지연을 물려받지
    #: 않도록 분리할 수 있다(``effective_target_model``).
    target_model: str = ""
    image_model: str = ""
    #: 응답 생성(read) 대기 상한. connect_timeout_seconds와 분리한 이유는
    #: connect_timeout_seconds의 docstring 참고.
    timeout_seconds: float = 30.0
    #: 연결 대기 상한 — 응답이 느린 것과 서버에 붙지 못하는 것은 서로 다른
    #: 실패라 같은 시간을 줄 이유가 없다. timeout_seconds를 늘려도(느린
    #: 생성을 기다려주려고) 진짜 네트워크 장애는 여전히 이 짧은 시간 안에
    #: 실패해야 재시도·에러 응답이 지연 없이 나간다.
    connect_timeout_seconds: float = 10.0
    #: aimlapi.com은 제3자 중계 게이트웨이라 장애 시 대체 경로가 없다
    #: (docs/AICE_LLM_FRONTDOOR_PLAN.md §9). 순간적인 지연·과부하까지
    #: 즉시 사용자 실패로 보여주지 않기 위해 일시적 오류(429·502·503·504)에
    #: 한해 지수 백오프로 재시도한다. 인증·검증 오류(400·401·403·422 등)는
    #: 재시도해도 결과가 달라지지 않으므로 재시도하지 않는다.
    max_retries: int = 2
    retry_backoff_seconds: float = 1.0

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.text_model)

    @property
    def image_configured(self) -> bool:
        return bool(self.api_key and self.image_model)

    @property
    def effective_target_model(self) -> str:
        return self.target_model or self.text_model


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
        self.client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(
                settings.timeout_seconds, connect=settings.connect_timeout_seconds
            )
        )

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
        self,
        messages: list[dict[str, Any]],
        *,
        temperature: float = 0.4,
        model: str | None = None,
    ) -> dict[str, Any]:
        """고정 JSON 스키마 응답을 기대하는 채팅 호출.

        ``response_format={"type": "json_object"}`` 을 요청하지만 모델이
        이를 무시할 수 있으므로, JSON이 아닌 응답을 조용히 빈 값으로
        넘기지 않고 ``AimlapiError`` 로 실패시킨다 — 화면 1이 지어낸
        후보를 받는 것보다 빈 화면을 보여주는 편이 낫다.

        ``model``을 생략하면 ``settings.text_model``을 쓴다. 1차 호출(목표
        분류)처럼 가벼운 작업엔 호출부가
        ``settings.effective_target_model``을 명시로 넘겨 더 빠른 모델로
        보낼 수 있다.
        """
        self._require_configured()
        payload = {
            "model": model or self.settings.text_model,
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

    #: 재시도 대상 상태코드 — 요청 쪽 문제(4xx 검증·인증 오류)가 아니라
    #: 게이트웨이·상류 쪽의 일시적 문제로 보이는 것들만 재시도한다.
    _RETRYABLE_STATUSES = frozenset({429, 502, 503, 504})

    async def _sleep_before_retry(self, attempt: int) -> None:
        await asyncio.sleep(self.settings.retry_backoff_seconds * (2 ** attempt))

    async def _request(
        self, method: str, path: str, *, absolute: bool = False, **kwargs: Any
    ) -> httpx.Response:
        url = path if absolute else f"{self.settings.base_url.rstrip('/')}{path}"
        headers = None if absolute else self._headers()
        attempt = 0
        while True:
            try:
                response = await self.client.request(
                    method, url, headers=headers, **kwargs
                )
            except httpx.TimeoutException as exc:
                if attempt >= self.settings.max_retries:
                    raise AimlapiError(
                        504, "aimlapi_timeout", "aimlapi.com 응답 시간이 초과되었습니다."
                    ) from exc
                await self._sleep_before_retry(attempt)
                attempt += 1
                continue
            except httpx.HTTPError as exc:
                if attempt >= self.settings.max_retries:
                    raise AimlapiError(
                        502, "aimlapi_unavailable", "aimlapi.com에 연결할 수 없습니다."
                    ) from exc
                await self._sleep_before_retry(attempt)
                attempt += 1
                continue
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
                if status in self._RETRYABLE_STATUSES and attempt < self.settings.max_retries:
                    await self._sleep_before_retry(attempt)
                    attempt += 1
                    continue
                raise AimlapiError(status, code, message)
            return response
