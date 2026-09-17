from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from kiln.aice import AiceRun


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HealthResponse(ApiModel):
    status: str


class ReadinessResponse(ApiModel):
    status: str
    supabase_configured: bool


class AuthUser(ApiModel):
    # Supabase Auth returns the full user document (email, role, metadata,
    # identities, timestamps, ...). The API only needs the stable user id.
    model_config = ConfigDict(extra="ignore")
    id: UUID


class ProfileUpdate(ApiModel):
    display_name: str = Field(max_length=80)

    @field_validator("display_name")
    @classmethod
    def normalize(cls, value: str) -> str:
        return value.strip()


class ProfileResponse(ApiModel):
    id: UUID
    display_name: str
    created_at: datetime


class WorkRecordCreate(ApiModel):
    title: str = Field(min_length=1, max_length=200)
    payload: dict[str, Any] = Field(default_factory=dict)
    schema_version: int = Field(default=1, gt=0)
    is_public: bool = False

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("title must not be blank")
        return value


class WorkRecordUpdate(ApiModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    payload: dict[str, Any] | None = None
    schema_version: int | None = Field(default=None, gt=0)
    is_public: bool | None = None

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("title must not be blank")
        return value

    @model_validator(mode="after")
    def require_change(self) -> "WorkRecordUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        return self


class WorkRecordResponse(ApiModel):
    id: UUID
    title: str
    payload: dict[str, Any]
    schema_version: int
    is_public: bool
    created_at: datetime
    updated_at: datetime


class WorkRecordPage(ApiModel):
    items: list[WorkRecordResponse]
    limit: int
    offset: int


def validate_aice_payload(value: dict[str, Any]) -> dict[str, Any]:
    """공유 Python 계약으로 AiceRun payload를 검증한다."""
    AiceRun.from_dict(value)
    return value


class AiceRunCreate(ApiModel):
    title: str = Field(min_length=1, max_length=200)
    run: dict[str, Any]
    is_public: bool = False

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("title must not be blank")
        return value

    @field_validator("run")
    @classmethod
    def validate_run(cls, value: dict[str, Any]) -> dict[str, Any]:
        return validate_aice_payload(value)

    @model_validator(mode="after")
    def require_public_consent(self) -> "AiceRunCreate":
        run = AiceRun.from_dict(self.run)
        if self.is_public and not run.consent.active_public_consent:
            raise ValueError("public AiceRun requires active consent")
        return self


class AiceRunResponse(ApiModel):
    id: UUID
    user_id: UUID | None = Field(default=None, exclude=True)
    title: str
    run: dict[str, Any] = Field(validation_alias="payload")
    schema_version: int
    status: str
    goal_gloss: str
    goal_transparency: str
    recipe_id: str
    ware_preset: str
    is_public: bool
    created_at: datetime
    updated_at: datetime

    @field_validator("run")
    @classmethod
    def validate_run(cls, value: dict[str, Any]) -> dict[str, Any]:
        return validate_aice_payload(value)


class AiceRunPage(ApiModel):
    items: list[AiceRunResponse]
    limit: int
    offset: int


class AicePublishConsent(ApiModel):
    photo_rights_confirmed: bool
    pii_reviewed: bool
    location_removed: bool
    withdrawal_understood: bool

    @model_validator(mode="after")
    def require_every_check(self) -> "AicePublishConsent":
        if not all((self.photo_rights_confirmed, self.pii_reviewed, self.location_removed, self.withdrawal_understood)):
            raise ValueError("all publication consent checks are required")
        return self


# ─── LLM 프런트도어 화면 1 (TODO Phase 2) ────────────────────────────────


class RecipeSuggestRequest(ApiModel):
    """화면 1 채팅 입력. 사진 첨부(§8 image-conditioned 이미지 생성)는
    아직 이 엔드포인트에서 받지 않는다 — 텍스트 후보부터 배선한다."""

    prompt_text: str = Field(min_length=1, max_length=2000)
    candidate_count: int = Field(default=5, ge=1, le=8)

    @field_validator("prompt_text")
    @classmethod
    def normalize_prompt(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("prompt_text must not be blank")
        return value


class RecipeSuggestResponse(ApiModel):
    """검증을 통과한 후보만 담는다 — 절반만 검증된 후보를 내보내지 않는다
    (``kiln.llm.recipe_candidates.build_recipe_candidates``)."""

    prompt_text: str
    candidates: list[dict[str, Any]]
    #: 화학적으로 성립하지 않아 버린 후보의 사유(빈 배열이면 전부 통과).
    dropped: list[str] = Field(default_factory=list)


class RecipeImageRequest(ApiModel):
    """후보 카드 1장의 예상 이미지 생성 요청 — 후보마다 비용이 붙으므로
    (§8: 장당 약 $0.05~0.065) 화면 1의 5개 후보에 자동으로 걸지 않고
    카드별로 명시 요청한다."""

    candidate_name: str = Field(min_length=1, max_length=200)
    materials: dict[str, float]
    colorants: dict[str, float] = Field(default_factory=dict)
    style_note: str = Field(default="", max_length=500)


class RecipeImageResponse(ApiModel):
    #: PNG 원본 바이트의 base64 인코딩. ``source_type="synthetic"`` 로만
    #: 표시해야 한다(``PhotoAsset``) — 실물 사진이 아니다.
    image_base64: str
    media_type: str


# ─── 가상 제어기 패널 — kiln.firing 물리 판정 코어 경계 ──────────────────────


class KilnDisturbanceIn(ApiModel):
    """`kiln.firing.simulator.Disturbance`와 필드를 그대로 맞춘다 (12-2절)."""

    supply_voltage_pct: float = 0.0
    element_aging_pct: float = 0.0
    thermocouple_noise_c: float = 0.0
    thermocouple_lag_s: float = 0.0
    load_mismatch_pct: float = 0.0
    wall_lag_s: float = 0.0
    seed: int = 0


class KilnSimulateRequest(ApiModel):
    """`CurveSeries.points`와 같은 (분, 목표온도[℃]) 점열을 그대로 받는다."""

    schedule: list[tuple[float, float]] = Field(min_length=2)
    disturbance: KilnDisturbanceIn = Field(default_factory=KilnDisturbanceIn)
    dt_s: float = Field(default=60.0, gt=0)

    @field_validator("schedule")
    @classmethod
    def validate_schedule(cls, value: list[tuple[float, float]]) -> list[tuple[float, float]]:
        times = [t for t, _ in value]
        if any(b <= a for a, b in zip(times, times[1:])):
            raise ValueError("schedule minutes must be strictly increasing")
        return value


class KilnControlSample(ApiModel):
    t_s: float
    minute: float
    sensor_c: float
    ware_c: float
    power_w: float
    phase: str
    outer_mode: str
    hold_extension_s: float
    message: str
    paused: bool


class KilnSimulateResponse(ApiModel):
    samples: list[KilnControlSample]
    #: `KilnSimulator.provenance_notes` — 오지정·상대 비교 전용 안내 (부록 A, 12-2절).
    provenance_notes: list[str]
    #: E가 가정값이라는 사실 (부록 C: 값 기재 금지, `.assume()` 필수).
    e_note: str
    target_heat_work: float
    peak_c: float
    max_power_w: float
