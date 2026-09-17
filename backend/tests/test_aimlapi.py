from __future__ import annotations

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
    import base64

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
async def test_generate_image_without_model_configured_raises() -> None:
    client = AimlapiClient(_settings(image_model=""))
    with pytest.raises(AimlapiError) as excinfo:
        await client.generate_image("a bowl")
    assert excinfo.value.code == "aimlapi_image_not_configured"
    await client.close()
