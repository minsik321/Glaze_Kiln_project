from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

import base64
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ValidationError

from kiln.llm import RecipeCandidateValidationError, build_messages, build_recipe_candidates

from .aimlapi import AimlapiClient, AimlapiError

from .dependencies import access_token, authenticated_user, error_detail, get_gateway, get_llm
from .models import (
    AiceRunCreate,
    AicePublishConsent,
    AiceRunPage,
    AiceRunResponse,
    AuthUser,
    ProfileResponse,
    ProfileUpdate,
    RecipeImageRequest,
    RecipeImageResponse,
    RecipeSuggestRequest,
    RecipeSuggestResponse,
    WorkRecordCreate,
    WorkRecordPage,
    WorkRecordResponse,
    WorkRecordUpdate,
)
from .supabase import SupabaseError, SupabaseGateway

router = APIRouter(prefix="/api/v1")
Token = Annotated[str, Depends(access_token)]
User = Annotated[AuthUser, Depends(authenticated_user)]
Gateway = Annotated[SupabaseGateway, Depends(get_gateway)]
Llm = Annotated[AimlapiClient, Depends(get_llm)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100_000)]
RECORD_COLUMNS = "id,title,payload,schema_version,is_public,created_at,updated_at"
AICE_COLUMNS = "id,title,payload,schema_version,status,goal_gloss,goal_transparency,recipe_id,ware_preset,is_public,created_at,updated_at"


def _raise_supabase(exc: SupabaseError) -> None:
    raise HTTPException(
        exc.status_code, detail=error_detail(exc.code, exc.message)
    ) from exc


def _validate(model: type[BaseModel], row: dict) -> BaseModel:
    try:
        return model.model_validate(row)
    except ValidationError as exc:
        raise HTTPException(
            502,
            detail=error_detail(
                "invalid_upstream_response", "Supabase 응답 형식이 올바르지 않습니다."
            ),
        ) from exc


def _one(rows: list[dict], model: type[BaseModel], code: str, message: str) -> BaseModel:
    if not rows:
        raise HTTPException(404, detail=error_detail(code, message))
    return _validate(model, rows[0])


@router.get("/aice-runs", response_model=AiceRunPage)
async def list_aice_runs(
    token: Token,
    user: User,
    gateway: Gateway,
    limit: Limit = 20,
    offset: Offset = 0,
) -> AiceRunPage:
    try:
        rows = await gateway.select(
            "aice_runs",
            token,
            {
                "select": AICE_COLUMNS,
                "user_id": f"eq.{user.id}",
                "order": "created_at.desc",
                "limit": limit,
                "offset": offset,
            },
        )
    except SupabaseError as exc:
        _raise_supabase(exc)
    return AiceRunPage(
        items=[_validate(AiceRunResponse, row) for row in rows],
        limit=limit,
        offset=offset,
    )


@router.post(
    "/aice-runs",
    response_model=AiceRunResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_aice_run(
    body: AiceRunCreate, token: Token, user: User, gateway: Gateway
) -> BaseModel:
    run = body.run
    values = {
        "user_id": str(user.id),
        "title": body.title,
        "payload": run,
        "schema_version": run["schema_version"],
        "status": run["status"],
        "goal_gloss": run["goal"]["gloss"],
        "goal_transparency": run["goal"]["transparency"],
        "recipe_id": run["recipe"]["id"],
        "ware_preset": run["ware"]["preset"],
        "is_public": body.is_public,
    }
    try:
        rows = await gateway.insert("aice_runs", token, values)
    except SupabaseError as exc:
        _raise_supabase(exc)
    return _one(
        rows,
        AiceRunResponse,
        "aice_run_not_saved",
        "AICE 실행을 저장하지 못했습니다.",
    )


@router.get("/aice-runs/{run_id}", response_model=AiceRunResponse)
async def get_aice_run(run_id: UUID, token: Token, user: User, gateway: Gateway) -> BaseModel:
    try:
        rows = await gateway.select(
            "aice_runs",
            token,
            {
                "select": AICE_COLUMNS,
                "id": f"eq.{run_id}",
                "user_id": f"eq.{user.id}",
                "limit": 1,
            },
        )
    except SupabaseError as exc:
        _raise_supabase(exc)
    return _one(
        rows,
        AiceRunResponse,
        "aice_run_not_found",
        "AICE 실행을 찾을 수 없습니다.",
    )


@router.get("/public/aice-runs", response_model=AiceRunPage)
async def list_public_aice_runs(token: Token, _user: User, gateway: Gateway, limit: Limit = 20, offset: Offset = 0) -> AiceRunPage:
    try:
        rows = await gateway.select("aice_runs", token, {"select": AICE_COLUMNS, "is_public": "eq.true", "order": "created_at.desc", "limit": limit, "offset": offset})
    except SupabaseError as exc:
        _raise_supabase(exc)
    return AiceRunPage(items=[_validate(AiceRunResponse, row) for row in rows], limit=limit, offset=offset)


@router.get("/public/aice-runs/{run_id}", response_model=AiceRunResponse)
async def get_public_aice_run(run_id: UUID, token: Token, _user: User, gateway: Gateway) -> BaseModel:
    try:
        rows = await gateway.select("aice_runs", token, {"select": AICE_COLUMNS, "id": f"eq.{run_id}", "is_public": "eq.true", "limit": 1})
    except SupabaseError as exc:
        _raise_supabase(exc)
    return _one(rows, AiceRunResponse, "aice_run_not_found", "공개 AICE 실행을 찾을 수 없습니다.")


@router.post("/aice-runs/{run_id}/publish", response_model=AiceRunResponse)
async def publish_aice_run(run_id: UUID, body: AicePublishConsent, token: Token, user: User, gateway: Gateway) -> BaseModel:
    try:
        current = await gateway.select("aice_runs", token, {"select": AICE_COLUMNS, "id": f"eq.{run_id}", "user_id": f"eq.{user.id}", "limit": 1})
        record = _one(current, AiceRunResponse, "aice_run_not_found", "AICE 실행을 찾을 수 없습니다.")
        run = dict(record.run)
        run["consent"] = {"share_allowed": True, "photo_rights_confirmed": body.photo_rights_confirmed, "pii_reviewed": body.pii_reviewed, "location_removed": body.location_removed, "withdrawn_at": None}
        await gateway.insert("aice_consents", token, {"run_id": str(run_id), "user_id": str(user.id), "share_allowed": True, "photo_rights_confirmed": body.photo_rights_confirmed, "pii_reviewed": body.pii_reviewed, "location_removed": body.location_removed, "withdrawn_at": None}, upsert=True, conflict="run_id")
        rows = await gateway.update("aice_runs", token, {"payload": run, "is_public": True}, {"id": f"eq.{run_id}", "user_id": f"eq.{user.id}"})
    except SupabaseError as exc:
        _raise_supabase(exc)
    return _one(rows, AiceRunResponse, "aice_run_not_found", "AICE 실행을 찾을 수 없습니다.")


@router.delete("/aice-runs/{run_id}/publication", response_model=AiceRunResponse)
async def withdraw_aice_run(run_id: UUID, token: Token, user: User, gateway: Gateway) -> BaseModel:
    withdrawn_at = datetime.now(UTC).isoformat()
    try:
        current = await gateway.select("aice_runs", token, {"select": AICE_COLUMNS, "id": f"eq.{run_id}", "user_id": f"eq.{user.id}", "limit": 1})
        record = _one(current, AiceRunResponse, "aice_run_not_found", "AICE 실행을 찾을 수 없습니다.")
        run = dict(record.run)
        run["consent"] = {**run["consent"], "share_allowed": False, "withdrawn_at": withdrawn_at}
        await gateway.update("aice_consents", token, {"share_allowed": False, "withdrawn_at": withdrawn_at}, {"run_id": f"eq.{run_id}", "user_id": f"eq.{user.id}"})
        rows = await gateway.update("aice_runs", token, {"payload": run, "is_public": False}, {"id": f"eq.{run_id}", "user_id": f"eq.{user.id}"})
    except SupabaseError as exc:
        _raise_supabase(exc)
    return _one(rows, AiceRunResponse, "aice_run_not_found", "AICE 실행을 찾을 수 없습니다.")


@router.delete("/aice-runs/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_aice_run(run_id: UUID, token: Token, user: User, gateway: Gateway) -> Response:
    try:
        rows = await gateway.delete("aice_runs", token, {"id": f"eq.{run_id}", "user_id": f"eq.{user.id}"})
    except SupabaseError as exc:
        _raise_supabase(exc)
    if not rows:
        raise HTTPException(404, detail=error_detail("aice_run_not_found", "AICE 실행을 찾을 수 없습니다."))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me/profile", response_model=ProfileResponse)
async def get_profile(token: Token, user: User, gateway: Gateway) -> BaseModel:
    try:
        rows = await gateway.select(
            "profiles",
            token,
            {
                "select": "id,display_name,created_at",
                "id": f"eq.{user.id}",
                "limit": 1,
            },
        )
    except SupabaseError as exc:
        _raise_supabase(exc)
    return _one(rows, ProfileResponse, "profile_not_found", "프로필이 아직 생성되지 않았습니다.")


@router.put("/me/profile", response_model=ProfileResponse)
async def upsert_profile(
    body: ProfileUpdate, token: Token, user: User, gateway: Gateway
) -> BaseModel:
    try:
        rows = await gateway.insert(
            "profiles",
            token,
            {"id": str(user.id), "display_name": body.display_name},
            upsert=True,
        )
    except SupabaseError as exc:
        _raise_supabase(exc)
    return _one(rows, ProfileResponse, "profile_not_saved", "프로필을 저장하지 못했습니다.")


@router.get("/work-records", response_model=WorkRecordPage)
async def list_records(
    token: Token,
    user: User,
    gateway: Gateway,
    limit: Limit = 20,
    offset: Offset = 0,
) -> WorkRecordPage:
    try:
        rows = await gateway.select(
            "work_records",
            token,
            {
                "select": RECORD_COLUMNS,
                "user_id": f"eq.{user.id}",
                "order": "created_at.desc",
                "limit": limit,
                "offset": offset,
            },
        )
    except SupabaseError as exc:
        _raise_supabase(exc)
    return WorkRecordPage(
        items=[_validate(WorkRecordResponse, row) for row in rows],
        limit=limit,
        offset=offset,
    )


@router.post(
    "/work-records",
    response_model=WorkRecordResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_record(
    body: WorkRecordCreate, token: Token, user: User, gateway: Gateway
) -> BaseModel:
    values = body.model_dump(mode="json")
    values["user_id"] = str(user.id)
    try:
        rows = await gateway.insert("work_records", token, values)
    except SupabaseError as exc:
        _raise_supabase(exc)
    return _one(rows, WorkRecordResponse, "record_not_saved", "작업 기록을 저장하지 못했습니다.")


@router.get("/work-records/{record_id}", response_model=WorkRecordResponse)
async def get_record(
    record_id: UUID, token: Token, user: User, gateway: Gateway
) -> BaseModel:
    try:
        rows = await gateway.select(
            "work_records",
            token,
            {
                "select": RECORD_COLUMNS,
                "id": f"eq.{record_id}",
                "user_id": f"eq.{user.id}",
                "limit": 1,
            },
        )
    except SupabaseError as exc:
        _raise_supabase(exc)
    return _one(rows, WorkRecordResponse, "record_not_found", "작업 기록을 찾을 수 없습니다.")


@router.patch("/work-records/{record_id}", response_model=WorkRecordResponse)
async def update_record(
    record_id: UUID,
    body: WorkRecordUpdate,
    token: Token,
    user: User,
    gateway: Gateway,
) -> BaseModel:
    try:
        rows = await gateway.update(
            "work_records",
            token,
            body.model_dump(mode="json", exclude_unset=True),
            {"id": f"eq.{record_id}", "user_id": f"eq.{user.id}"},
        )
    except SupabaseError as exc:
        _raise_supabase(exc)
    return _one(rows, WorkRecordResponse, "record_not_found", "작업 기록을 찾을 수 없습니다.")


@router.delete("/work-records/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_record(
    record_id: UUID, token: Token, user: User, gateway: Gateway
) -> Response:
    try:
        rows = await gateway.delete(
            "work_records",
            token,
            {"id": f"eq.{record_id}", "user_id": f"eq.{user.id}"},
        )
    except SupabaseError as exc:
        _raise_supabase(exc)
    if not rows:
        raise HTTPException(
            404, detail=error_detail("record_not_found", "작업 기록을 찾을 수 없습니다.")
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/public/work-records", response_model=WorkRecordPage)
async def list_public_records(
    token: Token,
    _user: User,
    gateway: Gateway,
    limit: Limit = 20,
    offset: Offset = 0,
) -> WorkRecordPage:
    try:
        rows = await gateway.select(
            "work_records",
            token,
            {
                "select": RECORD_COLUMNS,
                "is_public": "eq.true",
                "order": "created_at.desc",
                "limit": limit,
                "offset": offset,
            },
        )
    except SupabaseError as exc:
        _raise_supabase(exc)
    return WorkRecordPage(
        items=[_validate(WorkRecordResponse, row) for row in rows],
        limit=limit,
        offset=offset,
    )


@router.get("/public/work-records/{record_id}", response_model=WorkRecordResponse)
async def get_public_record(
    record_id: UUID, token: Token, _user: User, gateway: Gateway
) -> BaseModel:
    try:
        rows = await gateway.select(
            "work_records",
            token,
            {
                "select": RECORD_COLUMNS,
                "id": f"eq.{record_id}",
                "is_public": "eq.true",
                "limit": 1,
            },
        )
    except SupabaseError as exc:
        _raise_supabase(exc)
    return _one(
        rows, WorkRecordResponse, "record_not_found", "공개 작업 기록을 찾을 수 없습니다."
    )


@router.post("/aice/recipe-candidates", response_model=RecipeSuggestResponse)
async def suggest_recipe_candidates(
    body: RecipeSuggestRequest, _token: Token, _user: User, llm: Llm
) -> RecipeSuggestResponse:
    """화면 1(LLM 채팅) — 자연어 입력에서 레시피 후보를 만든다 (LLM 프런트도어
    TODO Phase 2). LLM이 낸 JSON은 kiln.chem으로 교차 검증하고, 화학적으로
    성립하지 않는 후보는 통째로 버린다 — 절반만 검증된 값을 화면에 올리지
    않는다."""
    messages = build_messages(body.prompt_text, candidate_count=body.candidate_count)
    try:
        raw = await llm.chat_json(messages)
    except AimlapiError as exc:
        raise HTTPException(exc.status_code, detail=error_detail(exc.code, exc.message)) from exc
    try:
        candidate_set, dropped = build_recipe_candidates(raw)
    except RecipeCandidateValidationError as exc:
        raise HTTPException(
            502, detail=error_detail("invalid_recipe_candidates", str(exc))
        ) from exc
    return RecipeSuggestResponse(
        prompt_text=body.prompt_text,
        candidates=[asdict(candidate) for candidate in candidate_set.candidates],
        dropped=list(dropped),
    )


@router.post("/aice/recipe-candidates/image", response_model=RecipeImageResponse)
async def generate_recipe_candidate_image(
    body: RecipeImageRequest, _token: Token, _user: User, llm: Llm
) -> RecipeImageResponse:
    """후보 카드 1장의 예상 이미지 (LLM 프런트도어 TODO Phase 2, §8).

    자동으로 5장을 한꺼번에 만들지 않는다 — 카드별 명시 요청으로 비용을
    사용자가 통제한다. 반환 이미지는 항상 AI 생성/플레이스홀더이고
    (``source_type="synthetic"``), 실제 소성 결과를 보여주지 않는다."""
    materials_desc = ", ".join(f"{name} {pct}%" for name, pct in body.materials.items())
    prompt = (
        f"도예 유약 참고 이미지. 배합: {materials_desc}. {body.style_note}. "
        "이 배합이 입혀진 도자기 표면 클로즈업, 사실적인 사진 스타일. "
        "실제 소성 결과를 정확히 예측한 것이 아니라 참고용 상상 이미지임."
    )
    try:
        image_bytes = await llm.generate_image(prompt)
    except AimlapiError as exc:
        raise HTTPException(exc.status_code, detail=error_detail(exc.code, exc.message)) from exc
    return RecipeImageResponse(image_base64=base64.b64encode(image_bytes).decode())
