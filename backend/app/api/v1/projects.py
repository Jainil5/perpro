"""``/projects`` and ``/projects/{id}/stats`` (API.md "Projects")."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.v1.deps import DbSession, Today, WorkspaceScope, enum_param, sort_param
from app.schemas.projects import (
    ProjectCreate,
    ProjectListOut,
    ProjectOut,
    ProjectStatsOut,
    ProjectUpdate,
)
from app.services import projects
from app.services import serializers

router = APIRouter(tags=["projects"])

PROJECT_SORTS = ("updated", "target", "name", "priority", "created")


@router.get("", response_model=ProjectListOut, summary="List projects")
def list_projects(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    status_filter: Annotated[str | None, enum_param("project.status", "status")],
    priority: Annotated[str | None, enum_param("priority", "priority")],
    q: Annotated[str | None, Query(description="substring of name/description/category")] = None,
    sort: Annotated[str, sort_param(*PROJECT_SORTS, default="updated")] = "updated",
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    items, total = projects.list_projects(
        session,
        scope,
        status=status_filter,
        priority=priority,
        query=q,
        sort=sort,
        limit=limit,
        offset=offset,
        today=today,
    )
    return serializers.page_payload(items, total, limit=limit, offset=offset)


@router.post(
    "",
    response_model=ProjectOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a project (duplicate name => 409)",
)
def create_project(session: DbSession, scope: WorkspaceScope, payload: ProjectCreate) -> dict:
    return projects.create_project(session, scope, payload.model_dump())


@router.get("/{project_id}", response_model=ProjectOut, summary="One project with derived blocks")
def get_project(session: DbSession, scope: WorkspaceScope, project_id: str) -> dict:
    return projects.get_project(session, scope, project_id)


@router.patch("/{project_id}", response_model=ProjectOut, summary="Update a project")
def update_project(
    session: DbSession, scope: WorkspaceScope, project_id: str, payload: ProjectUpdate
) -> dict:
    return projects.update_project(
        session, scope, project_id, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a project: tasks are kept, milestones are deleted",
)
def delete_project(session: DbSession, scope: WorkspaceScope, project_id: str) -> Response:
    projects.delete_project(session, scope, project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{project_id}/stats",
    response_model=ProjectStatsOut,
    summary="Task statistics for one project",
)
def project_stats(
    session: DbSession,
    scope: WorkspaceScope,
    project_id: str,
    today: Today,
) -> dict:
    return projects.project_stats(session, scope, project_id, today)
