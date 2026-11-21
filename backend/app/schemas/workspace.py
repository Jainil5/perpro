"""Workspace, health, meta and export schemas."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BeforeValidator

from app.schemas.common import RequestModel, ResponseModel, UtcDateTime, trim_required


class WorkspaceOut(ResponseModel):
    id: str
    name: str
    slug: str
    timezone: str
    currency: str
    created_at: UtcDateTime


class WorkspacePatch(RequestModel):
    """``PATCH /workspace`` — only name/timezone/currency are editable in Phase 1."""

    name: Annotated[str | None, BeforeValidator(lambda v: trim_required(v, "name"))] = None
    timezone: Annotated[str | None, BeforeValidator(lambda v: trim_required(v, "timezone"))] = None
    currency: Annotated[str | None, BeforeValidator(lambda v: trim_required(v, "currency"))] = None


class HealthOut(ResponseModel):
    status: str = "ok"
    version: str
    workspace: str
    database: str
    ai_enabled: bool


class MetaOut(ResponseModel):
    """``GET /meta`` — the frontend's single source of truth for selects and stats."""

    enums: dict[str, list[str]]
    counts: dict[str, int]


class UserOut(ResponseModel):
    id: str
    email: str
    display_name: str
    timezone: str | None = None
    created_at: UtcDateTime


class ExportOut(ResponseModel):
    exported_at: UtcDateTime
    workspace: dict[str, Any]
    tables: dict[str, list[dict[str, Any]]]
