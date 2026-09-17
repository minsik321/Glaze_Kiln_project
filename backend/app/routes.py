from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

import base64
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ValidationError

from kiln.domain.models import SearchState
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

from .dependencies import access_token, authenticated_user, error_detail, get_gateway, get_llm
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
    TODO Phase 2, v9).

    배합비는 LLM이 발명하지 않는다(부록 D: 판단 주체는 규칙). 1차 LLM
    호출은 목표를 (광택도, 투명도)로 분류만 하고, `kiln.search.prior
    .propose`가 그 좌표로 배합 후보를 규칙대로 낸다(콜드스타트 — 개인
    사전분포 없이 격자+공간채움). 2차 LLM 호출은 그 고정 배합에 이름·
    착색·소성 메모만 붙인다. 두 단계 모두 LLM 원문은 kiln.chem/kiln.search
    로 교차 검증하고, 화학적으로 성립하지 않는 후보는 통째로 버린다."""
    target_messages = build_target_messages(body.prompt_text)
    try:
        target_raw = await llm.chat_json(target_messages)
    except AimlapiError as exc:
        raise HTTPException(exc.status_code, detail=error_detail(exc.code, exc.message)) from exc
    try:
        target = parse_target(target_raw)
    except RecipeCandidateValidationError as exc:
        raise HTTPException(
            502, detail=error_detail("invalid_recipe_target", str(exc))
        ) from exc

    search_state = SearchState(target=target, grid_step=10.0)
    search_candidates = propose(search_state, Prior(), n=body.candidate_count)

    messages = build_messages(body.prompt_text, search_candidates)
    try:
        raw = await llm.chat_json(messages)
    except AimlapiError as exc:
        raise HTTPException(exc.status_code, detail=error_detail(exc.code, exc.message)) from exc
    try:
        candidate_set, dropped = build_recipe_candidates(raw, search_candidates)
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
    colorants_desc = ", ".join(f"{name} {pct}%" for name, pct in body.colorants.items()) or "없음"
    prompt = (
        f"도예 유약 참고 이미지. 기본 배합: {materials_desc}. "
        f"발색 산화물 외배합: {colorants_desc}. {body.style_note}. "
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
    """가상 제어기 패널(CurveControlPanel.tsx) — 실제 사용자 데이터를 다루지
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


async def _load_coefficient_table(gateway: SupabaseGateway, token: str, user: AuthUser, recipe_id: str):
    try:
        rows = await gateway.select(
            "personal_calibrations",
            token,
            {
                "select": _CALIBRATION_COLUMNS,
                "user_id": f"eq.{user.id}",
                "recipe_id": f"eq.{recipe_id}",
                "version": "eq.1",
                "limit": 1,
            },
        )
    except SupabaseError as exc:
        _raise_supabase(exc)
    data = rows[0]["coefficients"] if rows else None
    return kiln_bridge.coefficient_table_from_dict(recipe_id, data)


def _coefficient_table_out(table) -> CoefficientTableOut:
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
    )


@router.get("/aice/calibration/{recipe_id}", response_model=CoefficientTableOut)
async def get_calibration(recipe_id: str, token: Token, user: User, gateway: Gateway) -> CoefficientTableOut:
    """레시피별 계수 계열 조회(Phase 5) — 없으면 전부 미동정인 기본 테이블.

    `predictionModel.ts`의 `priorRunCount`가 여기(`calibration_runs`)로
    이어진다 — 회차 자체를 다시 세지 않고, 이미 저장된 값을 낸다."""
    table = await _load_coefficient_table(gateway, token, user, recipe_id)
    return _coefficient_table_out(table)


@router.post("/aice/calibration/{recipe_id}/runs", response_model=CalibrationRunResponse)
async def submit_calibration_run(
    recipe_id: str, body: CalibrationRunRequest, token: Token, user: User, gateway: Gateway
) -> CalibrationRunResponse:
    """시유 회차 1건으로 k1을 갱신한다 — `kiln.calibration.update.run_update`
    그대로. 다른 레시피의 계수는 건드리지 않는다(레시피별 저장소 격리,
    calibration/registry.py 참고)."""
    table = await _load_coefficient_table(gateway, token, user, recipe_id)
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

    values = {
        "user_id": str(user.id),
        "recipe_id": recipe_id,
        "kiln_profile_id": "aice-default",
        "clay_body": body.ware_preset,
        "coefficients": kiln_bridge.coefficient_table_to_dict(result.table),
        "provenance": list(result.notes),
        "version": 1,
    }
    try:
        await gateway.insert(
            "personal_calibrations", token, values, upsert=True, conflict="user_id,recipe_id,version"
        )
    except SupabaseError as exc:
        _raise_supabase(exc)

    return CalibrationRunResponse(
        table=_coefficient_table_out(result.table),
        applied=result.applied,
        k1_estimate=result.k1_estimate,
        notes=list(result.notes),
    )
