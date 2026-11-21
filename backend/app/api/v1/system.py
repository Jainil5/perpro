"""``GET /health``, ``/workspace``, ``/meta``, ``/export`` and the demo endpoints.

The "system" surface of API.md: it describes the install rather than a resource, so it
shares one router. Every handler stays three lines - resolve scope, call a service,
return the payload.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.deps import DbSession, Today, WorkspaceScope
from app.core.config import APP_VERSION, get_settings
from app.core.errors import conflict
from app.models.enums import ENUMS
from app.schemas.signals import SeedOut
from app.schemas.workspace import ExportOut, HealthOut, MetaOut, WorkspaceOut, WorkspacePatch
from app.services import context, demo, export

router = APIRouter(tags=["system"])


@router.get("/health", response_model=HealthOut, summary="Liveness and active configuration")
def health(session: DbSession) -> dict:
    settings = get_settings()
    workspace = context.resolve_workspace(session)
    return {
        "status": "ok",
        "version": APP_VERSION,
        "workspace": workspace.slug,
        "database": settings.database_family,
        "ai_enabled": settings.ai_enabled,
    }


@router.get("/workspace", response_model=WorkspaceOut, summary="The single Phase 1 workspace")
def get_workspace(session: DbSession) -> dict:
    return context.workspace_payload(context.resolve_workspace(session))


@router.patch("/workspace", response_model=WorkspaceOut, summary="Rename or re-locale the workspace")
def patch_workspace(session: DbSession, payload: WorkspacePatch) -> dict:
    workspace = context.resolve_workspace(session)
    return context.update_workspace(
        session,
        workspace,
        name=payload.name,
        timezone=payload.timezone,
        currency=payload.currency,
    )


@router.get("/meta", response_model=MetaOut, summary="Enumerations and counters")
def meta(session: DbSession, scope: WorkspaceScope, today: Today) -> dict:
    return {"enums": ENUMS, "counts": context.workspace_counts(session, scope, today=today)}


@router.get("/export", response_model=ExportOut, summary="Full JSON dump of the workspace")
def export_data(session: DbSession, scope: WorkspaceScope) -> dict:
    return export.export_payload(session, scope)


@router.post("/demo/seed", response_model=SeedOut, summary="Insert the idempotent demo dataset")
def seed_demo(session: DbSession, scope: WorkspaceScope, today: Today) -> dict:
    return demo.seed(session, scope, today=today)


@router.post("/demo/reset", response_model=SeedOut, summary="Wipe demo rows and reseed (guarded)")
def reset_demo(session: DbSession, scope: WorkspaceScope, today: Today) -> dict:
    if not get_settings().allow_demo_reset:
        raise conflict("demo reset is disabled: set MYOS_ALLOW_DEMO_RESET=1 to allow it")
    return demo.reset(session, scope, today=today)
