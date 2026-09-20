from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID, uuid5

import asyncio
import base64
import logging
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ValidationError

from kiln.aice.identity import normalize_run_recipe
from kiln.domain.enums import Gloss, Transparency
from kiln.domain.models import SearchState, TargetCoordinate
from kiln.firing.simulator import Disturbance
from kiln.llm import (
    RecipeCandidateValidationError,
    build_messages,
    build_recipe_candidates,
    build_target_messages,
    parse_target,
)
from kiln.search.prior import Prior, propose

from . import kiln_bridge
from .aimlapi import AimlapiClient, AimlapiError

from .dependencies import (
    access_token,
    authenticated_user,
    error_detail,
    get_gateway,
    get_llm,
    get_vectorstore,
)
from .models import (
    AiceRunCreate,
    AicePublishConsent,
    AiceRunPage,
    AiceRunResponse,
    AuthUser,
    CalibrationRunRequest,
    CalibrationRunResponse,
    CoefficientTableOut,
    DipTimeRequest,
    DipTimeResponse,
    KilnControlSample,
    KilnSimulateRequest,
    KilnSimulateResponse,
    ProfileResponse,
    ProfileUpdate,
    RecipeImageRequest,
    RecipeImageResponse,
    RecipeSuggestRequest,
    RecipeSuggestResponse,
    ThicknessComputeRequest,
    ThicknessComputeResponse,
    ThicknessPointOut,
    WorkRecordCreate,
    WorkRecordPage,
    WorkRecordResponse,
    WorkRecordUpdate,
)
from .supabase import SupabaseError, SupabaseGateway
from .vectorstore import (
    AiceVectorStore,
    SOURCE_COLORANT_REFERENCE,
    SOURCE_CORRELATION_NOTE,
    SOURCE_MATERIAL_CHEMISTRY,
    SOURCE_PERSONAL_RECIPE,
    VectorDocument,
    VectorStoreUnavailable,
    format_retrieved_context,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1")
Token = Annotated[str, Depends(access_token)]
User = Annotated[AuthUser, Depends(authenticated_user)]
Gateway = Annotated[SupabaseGateway, Depends(get_gateway)]
Llm = Annotated[AimlapiClient, Depends(get_llm)]
VectorStore = Annotated["AiceVectorStore | None", Depends(get_vectorstore)]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100_000)]
RECORD_COLUMNS = "id,title,payload,schema_version,is_public,created_at,updated_at"
AICE_COLUMNS = "id,title,payload,schema_version,status,goal_gloss,goal_transparency,recipe_id,ware_preset,is_public,created_at,updated_at,request_id,feedback_status"


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
    body: AiceRunCreate, token: Token, user: User, gateway: Gateway, vectorstore: VectorStore
) -> BaseModel:
    run = normalize_run_recipe(body.run)
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
        rows = await gateway.rpc("save_aice_run", token, {
            "p_request_id": str(body.request_id or uuid5(user.id, run["run_id"])),
            "p_values": values,
        })
    except SupabaseError as exc:
        _raise_supabase(exc)
    result = _one(
        rows,
        AiceRunResponse,
        "aice_run_not_saved",
        "AICE 실행을 저장하지 못했습니다.",
    )
    _index_personal_recipe_best_effort(vectorstore, user, result)
    return await _apply_run_feedback(gateway, token, user, result)


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


#: ResultFeedback.tsx의 결함 칩 id — 하나라도 기록돼 있으면 그 회차는
#: "이상치"로 보고 조성 추천 되먹임(Prior/SearchState.observations)에
#: 긍정 신호로 먹이지 않는다. kiln.search.objective.DISQUALIFYING_FAILURES
#: 와 같은 취지이나, 이 앱의 결과 기록은 FailureType 열거형이 아니라
#: 이 영어 id로 저장되므로(kiln.aice.contract.ResultEvaluation.defects)
#: 별도 표로 둔다 — 고정 표 조회일 뿐 자연어 추론은 하지 않는다.
_OUTLIER_DEFECT_IDS = ("pinholes", "crawling", "crazing", "running")

#: 되먹임에 쓸 과거 회차를 몇 건까지 볼지. 사용자당 조성 추천 개인화
#: 목적이므로 최근 것 위주로 충분하다 — 전체 이력 스캔은 불필요하다.
_SEARCH_HISTORY_LIMIT = 200


#: ResultEvaluation.gloss/transparency(app/react/aice/feedback.ts)의 사용자
#: 선택지 → kiln.domain.enums 멤버. goal_gloss/transparency와 달리
#: `.upper()` 하나로 안 맞는다 — 이 평가 UI는 5/4단계 전체 등급이 아니라
#: 좁힌 3종 선택지만 준다(예: DRY·SEMI_GLOSS는 평가 화면에 없음).
_RESULT_GLOSS_MAP: dict[str, Gloss] = {"matte": Gloss.MATTE, "satin": Gloss.SATIN, "gloss": Gloss.GLOSS}
_RESULT_TRANSPARENCY_MAP: dict[str, Transparency] = {
    "opaque": Transparency.OPAQUE,
    "translucent": Transparency.TRANSLUCENT,
    "transparent": Transparency.TRANSPARENT,
}


def _result_to_coordinate(result: dict) -> TargetCoordinate | None:
    """평가 완료 회차의 **실측** 결과(광택·투명도) → 좌표.

    사용자 요구사항: "개인의 과거 레시피에서 해당 레시피가 나의 결과에
    어떠했는지를 반영" — 이전 구현은 이 자리에서 목표 좌표(그 회차가
    무엇을 노렸는지, ``_goal_to_coordinate``)를 ``Prior``에 먹였다.
    결함 태그만 없으면, 사용자가 ``ResultFeedback``에서 "목표와 완전히
    다르게 나왔다"고 명시적으로 평가한 회차조차 "이 배합이 그 목표를
    달성했다"는 관측처럼 쌓였다 — ``Prior.update``의 계약(배합→**결과**
    좌표)과 실제 배선이 어긋나 있었다.

    이 함수는 목표가 아니라 사용자가 실제로 관찰해 기록한 값만 쓴다.
    광택·투명도 둘 중 하나라도 기록되지 않았으면(아직 평가 안 함, 또는
    이 함수가 아는 3종 선택지 밖의 값) ``None`` — 판정 불가를 지어내지
    않는다(부록 D). 목표 적중 여부(``evaluation.match``)는 더 이상 별도로
    가늠할 필요가 없다 — 목표가 아니라 실제 결과를 저장하므로, 목표를
    빗나간 회차는 그 빗나간 좌표 그대로 쌓여 다음 추천에서 "이 배합은
    이 좌표를 낸다"는 정직한 신호가 된다.
    """
    result = result or {}
    try:
        gloss = _RESULT_GLOSS_MAP[str(result.get("gloss") or "").strip().lower()]
        transparency = _RESULT_TRANSPARENCY_MAP[str(result.get("transparency") or "").strip().lower()]
    except KeyError:
        return None
    return TargetCoordinate(gloss=gloss, transparency=transparency)


def _extract_trustworthy_materials(status: str, payload: dict) -> dict[str, float] | None:
    """평가 완료 + 배합 기록 있음 + 이상치 아님이면 배합을, 아니면 ``None``.

    :func:`_personal_search_history`(조성 추천 되먹임)와
    :func:`_index_personal_recipe_best_effort`(RAG 색인)이 같은 신뢰
    기준을 각자 구현하던 것을 하나로 합쳤다 — 기준이 둘로 나뉘어 있으면
    한쪽만 고쳤을 때 조용히 어긋난다.

    - ``status == "evaluated"``(결과를 실제로 기록한 회차)만 본다.
    - 배합이 비어 있으면(``materials`` 필드가 생기기 전에 저장된 레거시
      회차) 재구성할 수 없으므로 제외한다.
    - :data:`_OUTLIER_DEFECT_IDS` 중 하나라도 기록돼 있으면 **이상치로
      보고 제외한다** — 결함이 있었던 배합을 긍정 신호로 다시 쓰지 않는다.
    """
    if status != "evaluated":
        return None
    payload = payload or {}
    materials = ((payload.get("recipe") or {}).get("materials")) or {}
    if not materials:
        return None
    observed = payload.get("result") or {}
    if observed.get("defects_reviewed") is not True or _result_to_coordinate(observed) is None:
        return None
    defects = observed.get("defects") or []
    if any(defect in _OUTLIER_DEFECT_IDS for defect in defects):
        return None
    return {str(k): float(v) for k, v in materials.items()}


def _personal_search_history(
    rows: list[dict],
) -> list[tuple[dict[str, float], TargetCoordinate]]:
    """저장된 회차에서 조성 추천 되먹임에 쓸 (배합, **실측 결과**) 관측을 복원한다.

    v9는 지금까지 매 요청마다 빈 ``Prior()``로 시작해 사용자의 과거
    결과·이상치가 다음 추천에 전혀 반영되지 않았다(레시피 조성 자체가
    ``RecipeSelection``에 저장되지도 않았다 — 이번에 ``materials`` 필드를
    추가해 해결). 이 함수가 그 되먹임의 첫 단계다.

    좌표는 :func:`_result_to_coordinate`로 **실제 관측된** 광택·투명도에서
    가져온다(그 회차가 무엇을 *노렸는지*가 아니다) — ``Prior.update``의
    계약(배합→결과 좌표)을 실제로 지키는 지점이 여기다. 결과가 아직
    평가되지 않았으면(둘 중 하나라도 기록 안 됨) 그 회차는 조용히 뺀다.
    """
    history: list[tuple[dict[str, float], TargetCoordinate]] = []
    for row in rows:
        payload = row.get("payload") or {}
        materials = _extract_trustworthy_materials(str(row.get("status") or ""), payload)
        if materials is None:
            continue
        coord = _result_to_coordinate((payload.get("result") or {}))
        if coord is None:
            continue
        history.append((materials, coord))
    return history


def _index_personal_recipe_best_effort(
    vectorstore: AiceVectorStore | None, user: AuthUser, result: AiceRunResponse
) -> None:
    """저장된 회차를 그 사용자의 개인 레시피 RAG 코퍼스에 색인한다.

    수정 사항 정리 3번: "데이터를 저장하면 벡터 db에 저장되는 방식" — 별도
    배치/스크립트가 아니라 회차가 저장되는 이 시점에 바로 색인한다.
    :func:`_extract_trustworthy_materials`로 :func:`_personal_search_history`
    와 같은 기준(평가 완료·배합 있음·이상치 아님)만 넣는다 — 조성 추천
    되먹임에 쓰는 신뢰 기준과 RAG 코퍼스 신뢰 기준을 다르게 둘 이유가 없다.

    텍스트에 목표뿐 아니라 **실제 결과**도 함께 적는다 — 이전에는 목표만
    적혀 있어 LLM이 이 회차를 "그 목표를 달성한 사례"로 오해하기 쉬웠다.

    회차 저장은 이미 끝난 뒤 호출되므로, 이 함수는 절대 예외를 밖으로
    던지지 않는다 — Qdrant가 꺼져 있어도 사용자의 저장 요청 자체는
    이미 성공했어야 한다(부록 D와 같은 "판단 주체가 아니다" 원칙의
    운영적 형태: RAG 색인 실패가 핵심 기능을 막지 않는다).
    """
    if vectorstore is None:
        return
    run = result.run
    materials = _extract_trustworthy_materials(result.status, run)
    if materials is None:
        return
    materials_desc = ", ".join(f"{name} {amount:.1f}%" for name, amount in materials.items())
    goal = run.get("goal") or {}
    result_eval = run.get("result") or {}
    result_gloss = result_eval.get("gloss") or "미기록"
    result_transparency = result_eval.get("transparency") or "미기록"
    text = (
        f"목표 광택 {goal.get('gloss', '?')}·투명도 {goal.get('transparency', '?')} — "
        f"배합 {materials_desc}. 실측 결과: 광택 {result_gloss}·투명도 {result_transparency} "
        "(결함 기록 없음 · 이상치 아님)."
    )
    try:
        vectorstore.upsert_documents([
            VectorDocument(
                doc_id=f"run-{result.id}",
                text=text,
                metadata={
                    "source_type": SOURCE_PERSONAL_RECIPE,
                    "user_id": str(user.id),
                    "recipe_id": (run.get("recipe") or {}).get("id"),
                },
            )
        ])
    except Exception as exc:
        logger.warning("개인 레시피 RAG 색인 실패(회차 저장 자체는 성공): %s", exc)


def _feedback_coefficients(recipe_id: str, raw: dict, run: dict) -> tuple[dict, list[str]]:
    """Calculate every outcome update from one snapshot; commit them together."""
    new = dict(raw)
    result = run.get("result") or {}
    goal = run.get("goal") or {}
    if not result.get("defects_reviewed") or _result_to_coordinate(result) is None:
        return new, ["Incomplete historical observation: no feedback applied"]
    defects = tuple(result.get("defects") or ())
    notes: list[str] = []
    firing = kiln_bridge.firing_coefficient_table_from_dict(recipe_id, raw.get("firing"))
    # Defects confound gloss: never learn a temperature bias from a faulty run.
    if not defects:
        update = kiln_bridge.apply_firing_calibration_update(
            firing, goal_gloss=goal.get("gloss"), result_gloss=result.get("gloss"), defects=defects,
        )
        if update.applied:
            new["firing"] = kiln_bridge.firing_coefficient_table_to_dict(update.table)
            notes.extend(update.notes)
    density = kiln_bridge.density_coefficient_table_from_dict(recipe_id, raw.get("density"))
    update = kiln_bridge.apply_density_calibration_update(
        density, specific_gravity=((run.get("application") or {}).get("density") or {}).get("value"),
        mean_thickness_mm=((run.get("thickness") or {}).get("mean") or {}).get("value"),
        goal_gloss=goal.get("gloss"), goal_transparency=goal.get("transparency"),
        result_gloss=result.get("gloss"), result_transparency=result.get("transparency"),
        overall=result.get("match"), defects=defects, defects_reviewed=result.get("defects_reviewed") is True,
    )
    if update.applied:
        # Nested under "density", never the top-level "safe_thickness_mm" key —
        # that key is kiln.domain.models.CoefficientTable's 08절 risk-safety
        # boundary. This value is a personal next-attempt suggestion, not a
        # safety threshold, and must not silently replace it.
        new["density"] = kiln_bridge.density_coefficient_table_to_dict(update.table)
        notes.extend(update.notes)
    return new, notes


async def _apply_run_feedback(
    gateway: SupabaseGateway, token: str, user: AuthUser, result: AiceRunResponse,
) -> AiceRunResponse:
    if result.feedback_status != "pending":
        return result
    # A pending row survives process exit/network failure, and is safe to retry.
    try:
        for _ in range(5):
            raw = await _select_calibration_row(gateway, token, user, result.recipe_id)
            updated, notes = _feedback_coefficients(result.recipe_id, raw, result.run)
            rows = await gateway.rpc("commit_aice_feedback", token, {
                "p_recipe_id": result.recipe_id, "p_expected": raw,
                "p_coefficients": updated, "p_notes": notes, "p_run_id": str(result.id),
            })
            if rows and rows[0].get("applied"):
                return result.model_copy(update={"feedback_status": "applied"})
        logger.warning("Feedback contention; run remains pending: %s", result.id)
    except (SupabaseError, ValueError, TypeError) as exc:
        logger.warning("Feedback remains pending for run %s: %s", result.id, exc)
    return result


@router.post("/aice-runs/{run_id}/feedback/retry", response_model=AiceRunResponse)
async def retry_run_feedback(run_id: UUID, token: Token, user: User, gateway: Gateway, vectorstore: VectorStore) -> AiceRunResponse:
    result = await get_aice_run(run_id, token, user, gateway)
    _index_personal_recipe_best_effort(vectorstore, user, result)
    return await _apply_run_feedback(gateway, token, user, result)


async def _retry_pending_feedback(gateway: SupabaseGateway, token: str, user: AuthUser, recipe_id: str) -> None:
    # Bounded recovery on the next use of a recipe, independent of browser state.
    try:
        rows = await gateway.select("aice_runs", token, {
            "select": AICE_COLUMNS, "user_id": f"eq.{user.id}",
            "recipe_id": f"eq.{recipe_id}", "feedback_status": "eq.pending",
            "order": "created_at.asc", "limit": 100,
        })
        for row in rows:
            await _apply_run_feedback(gateway, token, user, _validate(AiceRunResponse, row))
    except SupabaseError as exc:
        logger.warning("Pending feedback retry unavailable: %s", exc)


@router.post("/aice/recipe-candidates", response_model=RecipeSuggestResponse)
async def suggest_recipe_candidates(
    body: RecipeSuggestRequest,
    token: Token,
    user: User,
    llm: Llm,
    gateway: Gateway,
    vectorstore: VectorStore,
) -> RecipeSuggestResponse:
    """화면 1(LLM 채팅) — 자연어 입력에서 레시피 후보를 만든다 (LLM 프런트도어
    TODO Phase 2, v9 후속).

    배합비는 LLM이 발명하지 않는다(부록 D: 판단 주체는 규칙). 1차 LLM
    호출은 목표를 (광택도, 투명도)로 분류만 하고, `kiln.search.prior
    .propose`가 그 좌표로 배합 후보를 규칙대로 낸다. 2차 LLM 호출은 그
    고정 배합에 이름·착색·소성 메모만 붙인다. 두 단계 모두 LLM 원문은
    kiln.chem/kiln.search로 교차 검증하고, 화학적으로 성립하지 않는
    후보는 통째로 버린다.

    **조성 추천 피드백 루프**: 매 요청마다 빈 사전분포로 시작하지 않고,
    사용자의 과거 회차(:func:`_personal_search_history`, 이상치 제외)를
    ``Prior``와 ``SearchState.observations``에 채운 뒤 제시한다. 이력
    조회가 실패해도(``SupabaseError``) 추천 자체를 막지 않고 콜드스타트로
    대체한다 — 개인화는 있으면 좋은 것이지 없다고 기능이 죽으면 안 된다.

    **지연 개선(2026-09-18)**: 1차 LLM 호출(목표 분류)은 이력 조회
    (Supabase)·RAG 검색(Qdrant)과 서로 값을 주고받지 않으므로
    ``asyncio.gather``로 동시에 실행한다 — 세 개를 순서대로 기다리던 것을
    "가장 느린 하나"만 기다리는 것으로 바꾼다. 또한 1차 호출은 두 필드
    분류만 하면 되므로 2차 호출(배합 서술, RAG 컨텍스트까지 포함해 더
    무거움)과 다른 모델(``effective_target_model``)을 쓸 수 있게 한다.
    """
    target_messages = build_target_messages(body.prompt_text)

    async def _fetch_history() -> list[tuple[dict[str, float], TargetCoordinate]]:
        try:
            history_rows = await gateway.select(
                "aice_runs",
                token,
                {
                    "select": AICE_COLUMNS,
                    "user_id": f"eq.{user.id}",
                    "order": "created_at.desc",
                    "limit": _SEARCH_HISTORY_LIMIT,
                },
            )
        except SupabaseError:
            return []
        return _personal_search_history(history_rows)

    async def _fetch_retrieved_context() -> str:
        #: RAG(수정 사항 정리 3번) — 원료 화학·성분 상관관계(전역)와 본인의
        #: 과거 레시피(개인, user_id로 좁힘)를 검색해 2차 LLM 호출의 참고
        #: 자료로 덧붙인다. vectorstore가 없거나(Qdrant 미설정) 검색이
        #: 실패해도(search()는 예외를 던지지 않고 빈 리스트를 반환한다)
        #: retrieved_context는 그냥 빈 문자열이 되고, 추천 자체는 막히지 않는다.
        if vectorstore is None:
            return ""
        general_docs, personal_docs = await asyncio.gather(
            asyncio.to_thread(
                vectorstore.search,
                body.prompt_text,
                limit=4,
                #: 착색 산화물 참고표(SOURCE_COLORANT_REFERENCE,
                #: ingest_corpus.py 참고)도 원료 화학·성분 상관관계와 같은
                #: "전역 문헌 참고" 자격으로 함께 검색한다 — 사용자 지시색
                #: (예: "청색 계열")이 담긴 프롬프트일 때 관련 산화물이 걸린다.
                source_types=(SOURCE_MATERIAL_CHEMISTRY, SOURCE_CORRELATION_NOTE, SOURCE_COLORANT_REFERENCE),
            ),
            asyncio.to_thread(
                vectorstore.search,
                body.prompt_text,
                limit=3,
                source_types=(SOURCE_PERSONAL_RECIPE,),
                user_id=str(user.id),
            ),
        )
        return format_retrieved_context(general_docs + personal_docs)

    try:
        target_raw, history, retrieved_context = await asyncio.gather(
            llm.chat_json(target_messages, model=llm.settings.effective_target_model),
            _fetch_history(),
            _fetch_retrieved_context(),
        )
    except AimlapiError as exc:
        raise HTTPException(exc.status_code, detail=error_detail(exc.code, exc.message)) from exc
    try:
        target = parse_target(target_raw)
    except RecipeCandidateValidationError as exc:
        raise HTTPException(
            502, detail=error_detail("invalid_recipe_target", str(exc))
        ) from exc

    prior = Prior()
    for materials, coord in history:
        prior.update(materials, coord)

    observations = tuple(
        (tuple(sorted(materials.items())), coord) for materials, coord in history
    )
    search_state = SearchState(target=target, grid_step=10.0, observations=observations)
    search_candidates = propose(search_state, prior, n=body.candidate_count)

    messages = build_messages(body.prompt_text, search_candidates, retrieved_context=retrieved_context)
    try:
        raw = await llm.chat_json(messages)
    except AimlapiError as exc:
        raise HTTPException(exc.status_code, detail=error_detail(exc.code, exc.message)) from exc
    try:
        candidate_set, dropped = build_recipe_candidates(
            raw, search_candidates, target=target
        )
    except RecipeCandidateValidationError as exc:
        raise HTTPException(
            502, detail=error_detail("invalid_recipe_candidates", str(exc))
        ) from exc
    return RecipeSuggestResponse(
        prompt_text=body.prompt_text,
        candidates=[asdict(candidate) for candidate in candidate_set.candidates],
        dropped=list(dropped),
    )


#: 화면 1 이미지 생성 프롬프트용 한국어 질감 지시문 (LLM 프런트도어 v9 후속
#: 수정) — 목표 분류(1차 LLM 호출)가 낸 (광택도, 투명도)가 이전에는 배합
#: 후보를 고르는 데만 쓰이고 이미지 생성에는 전달되지 않아, "매트 레시피인데
#: 이미지는 유광"처럼 목표와 무관한 이미지가 나올 수 있었다. 고정 표 조회일
#: 뿐 LLM이 질감을 추론하게 두지 않는다(부록 D와 같은 태도).
_GLOSS_TEXTURE_KO: dict[str, str] = {
    "DRY": "완전 무광, 유리질 광택이 전혀 없는 건조하고 거친 듯한 표면",
    "MATTE": "무광(매트) 표면, 빛 반사가 거의 없음",
    "SATIN": "은은한 반광택(사틴), 부드럽게 퍼지는 하이라이트",
    "SEMI_GLOSS": "반광택, 뚜렷하지만 강하지 않은 하이라이트",
    "GLOSS": "강한 유광, 표면에 뚜렷한 반사·하이라이트가 있는 광택 표면",
}
_TRANSPARENCY_TEXTURE_KO: dict[str, str] = {
    "OPAQUE": "완전 불투명, 바탕 소지가 전혀 비치지 않음",
    "SEMI_OPAQUE": "반불투명, 바탕이 희미하게만 비침",
    "TRANSLUCENT": "반투명, 바탕 질감이 은은하게 비쳐 보임",
    "TRANSPARENT": "투명, 바탕 소지와 색이 유리처럼 비쳐 보임",
}


def _texture_instruction(target_gloss: str, target_transparency: str) -> str:
    gloss_desc = _GLOSS_TEXTURE_KO.get(target_gloss.strip().upper())
    transparency_desc = _TRANSPARENCY_TEXTURE_KO.get(target_transparency.strip().upper())
    parts = [desc for desc in (gloss_desc, transparency_desc) if desc]
    if not parts:
        return "특별히 지정된 목표 질감 없음 — 배합·발색 설명에 맞춰 자연스럽게 표현"
    return ", ".join(parts)


@router.post("/aice/recipe-candidates/image", response_model=RecipeImageResponse)
async def generate_recipe_candidate_image(
    body: RecipeImageRequest, _token: Token, _user: User, llm: Llm
) -> RecipeImageResponse:
    """후보 카드 1장의 예상 이미지 (LLM 프런트도어 TODO Phase 2, §8).

    자동으로 5장을 한꺼번에 만들지 않는다 — 카드별 명시 요청으로 비용을
    사용자가 통제한다. 반환 이미지는 항상 AI 생성/플레이스홀더이고
    (``source_type="synthetic"``), 실제 소성 결과를 보여주지 않는다."""
    materials_desc = ", ".join(f"{name} {pct}%" for name, pct in body.materials.items())
    colorants_desc = ", ".join(f"{name} {pct}%" for name, pct in body.colorants.items()) or "없음"
    texture_desc = _texture_instruction(body.target_gloss, body.target_transparency)
    prompt = (
        f"도예 유약 참고 이미지. 기본 배합: {materials_desc}. "
        f"발색 산화물 외배합: {colorants_desc}. "
        f"표면 마감 목표(가장 중요, 반드시 반영): {texture_desc}. "
        f"{body.style_note}. "
        "이 배합이 입혀진 도자기 표면 클로즈업, 사실적인 사진 스타일. "
        "실제 소성 결과를 정확히 예측한 것이 아니라 참고용 상상 이미지임."
    )
    try:
        image_bytes = await llm.generate_image(prompt)
    except AimlapiError as exc:
        raise HTTPException(exc.status_code, detail=error_detail(exc.code, exc.message)) from exc
    if image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        media_type = "image/png"
    elif image_bytes.startswith(b"\xff\xd8\xff"):
        media_type = "image/jpeg"
    elif image_bytes.startswith(b"RIFF") and image_bytes[8:12] == b"WEBP":
        media_type = "image/webp"
    elif image_bytes.startswith((b"GIF87a", b"GIF89a")):
        media_type = "image/gif"
    else:
        raise HTTPException(
            502,
            detail=error_detail("invalid_image_data", "이미지 응답의 파일 형식을 확인하지 못했습니다."),
        )
    return RecipeImageResponse(
        image_base64=base64.b64encode(image_bytes).decode(),
        media_type=media_type,
    )


@router.post("/kiln/firing/simulate", response_model=KilnSimulateResponse)
async def simulate_kiln_firing(body: KilnSimulateRequest) -> KilnSimulateResponse:
    """가상 제어기 패널(KilnFiringScreen.tsx) — 실제 사용자 데이터를 다루지
    않는 순수 계산이라 로그인 없이 연다(예전 브라우저 내 Pyodide 실행과
    같은 접근성). `kiln.firing.controller.SegmentedController`와
    `kiln.firing.simulator.KilnSimulator`를 그대로 돌린다 — 이 경로는
    합성 PID가 아니라 물리 판정 코어다."""
    disturbance = Disturbance(**body.disturbance.model_dump())
    result = kiln_bridge.simulate(body.schedule, disturbance, body.dt_s)
    return KilnSimulateResponse(
        samples=[
            KilnControlSample(
                t_s=sample.t_s,
                minute=sample.t_s / 60.0,
                sensor_c=sample.sensor_c,
                ware_c=sample.ware_c,
                power_w=sample.power_w,
                phase=sample.phase,
                outer_mode=sample.outer_mode,
                hold_extension_s=sample.hold_extension_s,
                message=sample.message,
                paused=sample.paused,
            )
            for sample in result.samples
        ],
        provenance_notes=list(result.provenance_notes),
        e_note=result.e_note,
        target_heat_work=result.target_heat_work,
        peak_c=result.peak_c,
        max_power_w=result.max_power_w,
    )


def _thickness_response(profile) -> ThicknessComputeResponse:
    return ThicknessComputeResponse(
        points=[
            ThicknessPointOut(z=p.z, radius=p.radius, t_abs=p.t_abs, t_flow=p.t_flow, total=p.total)
            for p in profile.points
        ],
        area_m2=profile.area_m2,
        mean_mm=profile.mean_mm,
        areal_density_g_m2=profile.areal_density_g_m2,
        glaze_weight_g=profile.glaze_weight_g,
        rho_dry=profile.rho_dry,
        has_distribution=profile.has_distribution,
        within_model_scope=profile.within_model_scope,
        local_max_mm=profile.local_max_mm,
        local_min_mm=profile.local_min_mm,
        spread_mm=profile.spread_mm,
        provenance_notes=list(profile.provenance_notes),
    )


@router.post("/kiln/thickness/profile", response_model=ThicknessComputeResponse)
async def compute_thickness_profile(body: ThicknessComputeRequest) -> ThicknessComputeResponse:
    """두께 종단면 화면(ThicknessSection.tsx) — 07절 물리 판정 코어 경계.

    사용자 계정 데이터를 저장하지 않는 순수 계산이라 로그인 없이 연다
    (`/kiln/firing/simulate`와 같은 접근성 근거). `kiln.thickness.profile
    .compute_profile`을 그대로 돌린다 — 화면이 두께를 다시 계산하지
    않는다. 형상은 `kiln_bridge.WARE_PROFILES`의 대표 프로파일이며,
    사용자의 실측 치수가 아니라는 사실이 응답의 `provenance_notes`에
    실려 나간다."""
    try:
        profile = kiln_bridge.compute_thickness(
            ware_preset=body.ware_preset,
            weight_before_g=body.weight_before_g,
            weight_after_g=body.weight_after_g,
            method=body.method,
            dip_seconds=body.dip_seconds,
            specific_gravity=body.specific_gravity,
            waxed_area_m2=body.waxed_area_m2,
            is_reglaze=body.is_reglaze,
            drying_complete=body.drying_complete,
            glaze_interior=body.glaze_interior,
        )
    except ValueError as exc:
        raise HTTPException(422, detail=error_detail("invalid_thickness_input", str(exc))) from exc
    return _thickness_response(profile)


@router.post("/kiln/batch/dip-time", response_model=DipTimeResponse)
async def suggest_dip_time(body: DipTimeRequest) -> DipTimeResponse:
    """담금시간 역산(DensityCheck.tsx) — 06절 물리 판정 코어 경계. 비로그인."""
    result = kiln_bridge.recommend_dip_time(
        target_mm=body.target_mm,
        specific_gravity=body.specific_gravity,
        t_flow_mm=body.t_flow_mm,
    )
    return DipTimeResponse(
        seconds=result.seconds,
        predicted_mean_mm=result.predicted_mean_mm,
        feasible=result.feasible,
        reason=result.reason,
    )


# ─── 10-2절 캘리브레이션 배선 — personal_calibrations ────────────────────────

_CALIBRATION_COLUMNS = "coefficients"


async def _select_calibration_row(
    gateway: SupabaseGateway, token: str, user: AuthUser, recipe_id: str
) -> dict:
    """(user, recipe_id)의 `personal_calibrations.coefficients` 원본 사전
    (없으면 ``{}``). `SupabaseError`는 그대로 올린다 — 반드시 성공해야
    하는 호출부(캘리브레이션 라우트)는 그대로 전파하고, best-effort
    호출부(`create_aice_run`)는 자기 자리에서 잡아 삼킨다.

    두께 계수(`coefficient_table_from_dict`)와 소성조건 개인화 편향
    (`firing_coefficient_table_from_dict`)이 **같은 행의 같은 jsonb
    컬럼**에 서로 다른 키로 공존하므로(두께는 평면 키, 소성조건은
    `"firing"` 키 아래), 한쪽을 갱신해 이 컬럼을 다시 쓸 때는 반드시
    이 원본 사전에서 시작해 상대방 키를 보존해야 한다 — 그러지 않으면
    나중에 실행한 갱신이 먼저 쌓인 다른 쪽 데이터를 조용히 지운다.
    """
    rows = await gateway.select(
        "personal_calibrations",
        token,
        {
            "select": "coefficients",
            "user_id": f"eq.{user.id}",
            "recipe_id": f"eq.{recipe_id}",
            "version": "eq.1",
            "limit": 1,
        },
    )
    if rows and rows[0].get("coefficients"):
        return dict(rows[0]["coefficients"])
    return {}


async def _load_coefficient_table(gateway: SupabaseGateway, token: str, user: AuthUser, recipe_id: str):
    try:
        raw = await _select_calibration_row(gateway, token, user, recipe_id)
    except SupabaseError as exc:
        _raise_supabase(exc)
    return kiln_bridge.coefficient_table_from_dict(recipe_id, raw)


def _coefficient_table_out(table, firing_table, density_table) -> CoefficientTableOut:
    return CoefficientTableOut(
        recipe_id=table.recipe_id,
        k1=table.k1,
        k2=table.k2,
        rho_dry=table.rho_dry,
        s=table.s,
        m_rho=table.m_rho,
        safe_thickness_mm=table.safe_thickness_mm,
        calibration_runs=table.calibration_runs,
        calibrated_bisque_c=table.calibrated_bisque_c,
        provenance_notes=list(table.provenance_notes),
        gloss_bias_level=firing_table.gloss_bias_level,
        firing_calibration_runs=firing_table.calibration_runs,
        specific_gravity_range=density_table.specific_gravity_range,
        next_trial_thickness_mm=density_table.next_trial_thickness_mm,
        density_calibration_runs=density_table.calibration_runs,
    )


@router.get("/aice/calibration/{recipe_id}", response_model=CoefficientTableOut)
async def get_calibration(recipe_id: str, token: Token, user: User, gateway: Gateway) -> CoefficientTableOut:
    """레시피별 계수 계열 조회(Phase 5) — 없으면 전부 미동정인 기본 테이블.

    `predictionModel.ts`의 `priorRunCount`가 여기(`calibration_runs`)로
    이어진다 — 회차 자체를 다시 세지 않고, 이미 저장된 값을 낸다.
    `gloss_bias_level`/`firing_calibration_runs`는 소성조건 개인화 보정
    (`kiln.calibration.firing`) — 평가 완료 회차를 저장할 때마다
    `create_aice_run`이 자동으로 갱신한다(별도 제출 라우트 없음)."""
    await _retry_pending_feedback(gateway, token, user, recipe_id)
    try:
        raw = await _select_calibration_row(gateway, token, user, recipe_id)
    except SupabaseError as exc:
        _raise_supabase(exc)
    table = kiln_bridge.coefficient_table_from_dict(recipe_id, raw)
    firing_table = kiln_bridge.firing_coefficient_table_from_dict(recipe_id, raw.get("firing"))
    density_table = kiln_bridge.density_coefficient_table_from_dict(recipe_id, raw.get("density"))
    return _coefficient_table_out(table, firing_table, density_table)


@router.post("/aice/calibration/{recipe_id}/runs", response_model=CalibrationRunResponse)
async def submit_calibration_run(
    recipe_id: str, body: CalibrationRunRequest, token: Token, user: User, gateway: Gateway
) -> CalibrationRunResponse:
    """시유 회차 1건으로 k1을 갱신한다 — `kiln.calibration.update.run_update`
    그대로. 다른 레시피의 계수는 건드리지 않는다(레시피별 저장소 격리,
    calibration/registry.py 참고)."""
    try:
        raw = await _select_calibration_row(gateway, token, user, recipe_id)
    except SupabaseError as exc:
        _raise_supabase(exc)
    table = kiln_bridge.coefficient_table_from_dict(recipe_id, raw)
    try:
        result = kiln_bridge.apply_calibration_run(
            table,
            ware_preset=body.ware_preset,
            bisque_temperature_c=body.bisque_temperature_c,
            weight_before_g=body.weight_before_g,
            weight_after_g=body.weight_after_g,
            method=body.method,
            dip_seconds=body.dip_seconds,
            specific_gravity=body.specific_gravity,
            waxed_area_m2=body.waxed_area_m2,
            is_reglaze=body.is_reglaze,
            drying_complete=body.drying_complete,
            glaze_interior=body.glaze_interior,
        )
    except ValueError as exc:
        raise HTTPException(422, detail=error_detail("invalid_calibration_input", str(exc))) from exc

    new_coefficients = kiln_bridge.coefficient_table_to_dict(result.table)
    if "firing" in raw:
        # 소성조건 개인화 편향(create_aice_run이 채워 넣는 "firing" 키)을
        # 두께 계수 갱신이 조용히 지우지 않는다 — 같은 jsonb 컬럼을 공유
        # 하므로 원본 사전에서 시작해 상대방 키를 보존해야 한다.
        new_coefficients["firing"] = raw["firing"]
    if "density" in raw:
        # 비중 개인화 범위("density" 키)도 같은 이유로 보존한다.
        new_coefficients["density"] = raw["density"]

    values = {
        "user_id": str(user.id),
        "recipe_id": recipe_id,
        "kiln_profile_id": "aice-default",
        "clay_body": body.ware_preset,
        "coefficients": new_coefficients,
        "provenance": list(result.notes),
        "version": 1,
    }
    try:
        await gateway.insert(
            "personal_calibrations", token, values, upsert=True, conflict="user_id,recipe_id,version"
        )
    except SupabaseError as exc:
        _raise_supabase(exc)

    firing_table = kiln_bridge.firing_coefficient_table_from_dict(recipe_id, raw.get("firing"))
    density_table = kiln_bridge.density_coefficient_table_from_dict(recipe_id, raw.get("density"))
    return CalibrationRunResponse(
        table=_coefficient_table_out(result.table, firing_table, density_table),
        applied=result.applied,
        k1_estimate=result.k1_estimate,
        notes=list(result.notes),
    )
