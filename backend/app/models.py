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
