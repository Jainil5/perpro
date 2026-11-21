"""``/search`` and ``/dashboard`` - the two read models the Overview page needs."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.v1.deps import DbSession, Today, WorkspaceScope
from app.schemas.results import DashboardOut, SearchOut
from app.services import dashboard, search

router = APIRouter(tags=["overview"])


@router.get("/search", response_model=SearchOut, summary="Global search over six entity types")
def search_all(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    q: Annotated[str | None, Query(description="needle; < 2 chars returns nothing")] = None,
    limit: Annotated[int, Query(ge=1, le=50, description="hits per group")] = 8,
) -> dict:
    return search.search(session, scope, query=q, limit=limit, today=today)


@router.get("/dashboard", response_model=DashboardOut, summary="The Overview payload")
def get_dashboard(session: DbSession, scope: WorkspaceScope, today: Today) -> dict:
    return dashboard.dashboard_payload(session, scope, today=today)
