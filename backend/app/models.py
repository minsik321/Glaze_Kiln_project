from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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
