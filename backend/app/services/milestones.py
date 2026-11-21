"""Milestones: dated project checkpoints with open/done transitions."""

from __future__ import annotations

import datetime as dt
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.utils import now_utc, today_utc
from app.models import Milestone, Project
from app.models.enums import ActivityVerb, MilestoneStatus, Source
from app.services import activity, crud, serializers

_FIELDS = ("title", "description", "date")


def list_milestones(
    session: Session,
    workspace_id: str,
    *,
    project_id: str | None = None,
    status: str | None = None,
    today: dt.date | None = None,
) -> tuple[list[dict[str, Any]], int]:
    day = today or today_utc()
    conditions = [Milestone.workspace_id == workspace_id]
    if project_id:
        conditions.append(Milestone.project_id == project_id)
    if status:
        conditions.append(Milestone.status == status)
    total = int(session.scalar(sa.select(sa.func.count()).select_from(Milestone).where(*conditions)) or 0)
    rows = list(
        session.scalars(
            sa.select(Milestone).where(*conditions).order_by(Milestone.date, Milestone.title)
        )
    )
    return [serializers.milestone_payload(row, day) for row in rows], total


def create_milestone(
    session: Session, workspace_id: str, data: dict[str, Any], *, source: str = Source.USER.value
) -> dict[str, Any]:
    project_id = data.get("project_id")
    crud.validate_fk(session, Project, project_id, workspace_id=workspace_id, field="project_id")
    milestone = Milestone(
        workspace_id=workspace_id,
        project_id=str(project_id),
        title=str(data["title"]).strip(),
        date=data["date"],
        status=data.get("status") or MilestoneStatus.OPEN.value,
        description=data.get("description"),
        source=source,
    )
    session.add(milestone)
    session.flush()
    activity.created(
        session,
        workspace_id=workspace_id,
        entity_type="milestone",
        entity_id=milestone.id,
        entity_title=milestone.title,
        project_id=milestone.project_id,
    )
    return serializers.milestone_payload(milestone)


def update_milestone(
    session: Session, workspace_id: str, milestone_id: str, data: dict[str, Any]
) -> dict[str, Any]:
    milestone = crud.require(
        session, Milestone, milestone_id, workspace_id=workspace_id, label="milestone"
    )
    if "project_id" in data and data["project_id"] != milestone.project_id:
        crud.validate_fk(
            session, Project, data["project_id"], workspace_id=workspace_id, field="project_id"
        )
        milestone.project_id = str(data["project_id"])
    for field in _FIELDS:
        if field in data:
            value = data[field]
            if field == "title" and value is not None:
                value = str(value).strip() or milestone.title
            setattr(milestone, field, value)
    if data.get("status"):
        _set_status(milestone, str(data["status"]))
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="milestone",
        entity_id=milestone.id,
        entity_title=milestone.title,
        project_id=milestone.project_id,
    )
    return serializers.milestone_payload(milestone)


def _set_status(milestone: Milestone, status: str) -> None:
    milestone.status = status
    if status == MilestoneStatus.DONE.value:
        if milestone.completed_at is None:
            milestone.completed_at = now_utc()
    else:
        milestone.completed_at = None


def complete(session: Session, workspace_id: str, milestone_id: str) -> dict[str, Any]:
    milestone = crud.require(
        session, Milestone, milestone_id, workspace_id=workspace_id, label="milestone"
    )
    _set_status(milestone, MilestoneStatus.DONE.value)
    session.flush()
    activity.record(
        session,
        workspace_id=workspace_id,
        verb=ActivityVerb.COMPLETED.value,
        entity_type="milestone",
        entity_id=milestone.id,
        entity_title=milestone.title,
        project_id=milestone.project_id,
    )
    return serializers.milestone_payload(milestone)


def reopen(session: Session, workspace_id: str, milestone_id: str) -> dict[str, Any]:
    milestone = crud.require(
        session, Milestone, milestone_id, workspace_id=workspace_id, label="milestone"
    )
    _set_status(milestone, MilestoneStatus.OPEN.value)
    session.flush()
    activity.record(
        session,
        workspace_id=workspace_id,
        verb=ActivityVerb.REOPENED.value,
        entity_type="milestone",
        entity_id=milestone.id,
        entity_title=milestone.title,
        project_id=milestone.project_id,
    )
    return serializers.milestone_payload(milestone)


def delete_milestone(session: Session, workspace_id: str, milestone_id: str) -> dict[str, Any]:
    milestone = crud.require(
        session, Milestone, milestone_id, workspace_id=workspace_id, label="milestone"
    )
    snapshot = {
        "id": milestone.id,
        "title": milestone.title,
        "project_id": milestone.project_id,
    }
    session.delete(milestone)
    session.flush()
    activity.deleted(
        session,
        workspace_id=workspace_id,
        entity_type="milestone",
        entity_id=snapshot["id"],
        entity_title=snapshot["title"],
        project_id=None,
    )
    return snapshot
