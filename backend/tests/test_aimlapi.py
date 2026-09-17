from __future__ import annotations

import base64
import json

import httpx
import pytest

from backend.app.aimlapi import AimlapiClient, AimlapiError, AimlapiSettings


def _settings(**overrides) -> AimlapiSettings:
    base = dict(api_key="test-key", text_model="test/text-model", image_model="test/image-model")
    base.update(overrides)
    return AimlapiSettings(**base)


def _client(handler) -> AimlapiClient:
    transport = httpx.MockTransport(handler)
    upstream = httpx.AsyncClient(transport=transport)
    return AimlapiClient(_settings(), client=upstream)


@pytest.mark.asyncio
async def test_chat_json_parses_message_content() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["authorization"] == "Bearer test-key"
        body = json.loads(request.content)
        assert body["model"] == "test/text-model"
        assert body["response_format"] == {"type": "json_object"}
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": json.dumps({"candidates": []})}}
                ]
            },
        )

    client = _client(handler)
    result = await client.chat_json([{"role": "user", "content": "hi"}])
    assert result == {"candidates": []}
    await client.close()


@pytest.mark.asyncio
async def test_chat_json_rejects_non_json_content() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "그냥 문장입니다"}}]}
        )

    client = _client(handler)
    with pytest.raises(AimlapiError, match="JSON"):
        await client.chat_json([{"role": "user", "content": "hi"}])
    await client.close()


@pytest.mark.asyncio
async def test_chat_json_accepts_provider_markdown_fence() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": "요청한 JSON입니다.\n```json\n{\"candidates\": []}\n```"}}
                ]
            },
        )

    client = _client(handler)
    result = await client.chat_json([{"role": "user", "content": "hi"}])
    assert result == {"candidates": []}
    await client.close()


@pytest.mark.asyncio
async def test_chat_json_maps_upstream_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "invalid api key"}})

    client = _client(handler)
    with pytest.raises(AimlapiError) as excinfo:
        await client.chat_json([{"role": "user", "content": "hi"}])
    assert excinfo.value.status_code == 401
    assert "invalid api key" in excinfo.value.message
    await client.close()


@pytest.mark.asyncio
async def test_not_configured_raises_before_request() -> None:
    client = AimlapiClient(_settings(api_key="", text_model=""))
    with pytest.raises(AimlapiError) as excinfo:
        await client.chat_json([{"role": "user", "content": "hi"}])
    assert excinfo.value.code == "aimlapi_not_configured"
    await client.close()


@pytest.mark.asyncio
async def test_generate_image_decodes_b64_json() -> None:
    raw = b"fake-image-bytes"
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/images/generations"
        return httpx.Response(
            200, json={"data": [{"b64_json": base64.b64encode(raw).decode()}]}
        )

    client = _client(handler)
    image = await client.generate_image("a bowl")
    assert image == raw
    await client.close()


@pytest.mark.asyncio
async def test_generate_image_decodes_data_url_b64_json() -> None:
    raw = b"\x89PNG\r\n\x1a\nimage"

    def handler(_: httpx.Request) -> httpx.Response:
        encoded = base64.b64encode(raw).decode()
        return httpx.Response(200, json={"data": [{"b64_json": f"data:image/png;base64,{encoded}"}]})

    client = _client(handler)
    assert await client.generate_image("a bowl") == raw
    await client.close()


@pytest.mark.asyncio
async def test_generate_image_follows_cdn_redirect() -> None:
    raw = b"\x89PNG\r\n\x1a\nimage"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/images/generations":
            return httpx.Response(200, json={"data": [{"url": "https://cdn.test/image"}]})
        if request.url.host == "cdn.test":
            return httpx.Response(302, headers={"Location": "https://storage.test/image.png"})
        assert request.url.host == "storage.test"
        return httpx.Response(200, content=raw, headers={"Content-Type": "image/png"})

    client = _client(handler)
    assert await client.generate_image("a bowl") == raw
    await client.close()


@pytest.mark.asyncio
async def test_generate_image_without_model_configured_raises() -> None:
    client = AimlapiClient(_settings(image_model=""))
    with pytest.raises(AimlapiError) as excinfo:
        await client.generate_image("a bowl")
    assert excinfo.value.code == "aimlapi_image_not_configured"
    await client.close()


@pytest.mark.asyncio
async def test_chat_json_retries_on_503_then_succeeds() -> None:
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if calls["count"] < 3:
            return httpx.Response(503, json={"error": "일시적 과부하"})
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps({"candidates": []})}}]},
        )

    client = _client(handler)
    client.settings = AimlapiSettings(
        api_key="test-key",
        text_model="test/text-model",
        image_model="test/image-model",
        retry_backoff_seconds=0.001,
    )
    result = await client.chat_json([{"role": "user", "content": "hi"}])
    assert result == {"candidates": []}
    assert calls["count"] == 3
    await client.close()


@pytest.mark.asyncio
async def test_chat_json_gives_up_after_max_retries() -> None:
    calls = {"count": 0}

    def handler(_: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(503, json={"error": "계속 과부하"})

    client = _client(handler)
    client.settings = AimlapiSettings(
        api_key="test-key",
        text_model="test/text-model",
        image_model="test/image-model",
        max_retries=2,
        retry_backoff_seconds=0.001,
    )
    with pytest.raises(AimlapiError) as exc_info:
        await client.chat_json([{"role": "user", "content": "hi"}])
    assert exc_info.value.status_code == 502
    assert calls["count"] == 3  # 최초 시도 + 재시도 2회
    await client.close()


@pytest.mark.asyncio
async def test_chat_json_does_not_retry_on_client_error() -> None:
    calls = {"count": 0}

    def handler(_: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(401, json={"error": "invalid api key"})

    client = _client(handler)
    client.settings = AimlapiSettings(
        api_key="test-key",
        text_model="test/text-model",
        image_model="test/image-model",
        retry_backoff_seconds=0.001,
    )
    with pytest.raises(AimlapiError) as exc_info:
        await client.chat_json([{"role": "user", "content": "hi"}])
    assert exc_info.value.status_code == 401
    assert calls["count"] == 1  # 재시도 없음
    await client.close()


@pytest.mark.asyncio
async def test_chat_json_retries_on_timeout_then_succeeds() -> None:
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if calls["count"] < 2:
            raise httpx.ReadTimeout("timed out", request=request)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps({"candidates": []})}}]},
        )

    client = _client(handler)
    client.settings = AimlapiSettings(
        api_key="test-key",
        text_model="test/text-model",
        image_model="test/image-model",
        retry_backoff_seconds=0.001,
    )
    result = await client.chat_json([{"role": "user", "content": "hi"}])
    assert result == {"candidates": []}
    assert calls["count"] == 2
    await client.close()
