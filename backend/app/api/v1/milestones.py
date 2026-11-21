"""``/milestones`` - project milestones with complete/reopen shortcuts."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.v1.deps import DbSession, Today, WorkspaceScope, enum_param
from app.schemas.projects import (
    MilestoneCreate,
    MilestoneListOut,
    MilestoneOut,
    MilestoneUpdate,
)
from app.services import milestones

router = APIRouter(tags=["milestones"])

MilestoneStatusQuery = Annotated[str | None, enum_param("milestone.status", "status")]


@router.get("", response_model=MilestoneListOut, summary="List milestones, open first by date")
def list_milestones(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    status_filter: MilestoneStatusQuery,
    project_id: Annotated[str | None, Query()] = None,
) -> dict:
    items, total = milestones.list_milestones(
        session, scope, project_id=project_id, status=status_filter, today=today
    )
    return {"items": items, "total": total}


@router.post(
    "",
    response_model=MilestoneOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a milestone",
)
def create_milestone(session: DbSession, scope: WorkspaceScope, payload: MilestoneCreate) -> dict:
    return milestones.create_milestone(session, scope, payload.model_dump())


@router.patch("/{milestone_id}", response_model=MilestoneOut, summary="Update a milestone")
def update_milestone(
    session: DbSession,
    scope: WorkspaceScope,
    milestone_id: str,
    payload: MilestoneUpdate,
) -> dict:
    return milestones.update_milestone(
        session, scope, milestone_id, payload.model_dump(exclude_unset=True)
    )


@router.post("/{milestone_id}/complete", response_model=MilestoneOut, summary="Mark done")
def complete_milestone(session: DbSession, scope: WorkspaceScope, milestone_id: str) -> dict:
    return milestones.complete(session, scope, milestone_id)


@router.post("/{milestone_id}/reopen", response_model=MilestoneOut, summary="Back to open")
def reopen_milestone(session: DbSession, scope: WorkspaceScope, milestone_id: str) -> dict:
    return milestones.reopen(session, scope, milestone_id)


@router.delete(
    "/{milestone_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a milestone"
)
def delete_milestone(session: DbSession, scope: WorkspaceScope, milestone_id: str) -> Response:
    milestones.delete_milestone(session, scope, milestone_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
