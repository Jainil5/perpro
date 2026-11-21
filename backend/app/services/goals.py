"""Goals (``/goals``).

API.md does not document goal endpoints - the object exists in the data model and the
UI shows them in settings - so these follow the same envelope conventions as every
other collection: ``{items, total}``, required ``title``, server ids, one activity
row per write. ``progress`` is owner-maintained (0..100); a task roll-up arrives with
the phase that owns the relationship.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.utils import now_utc
from app.models import Goal, Project
from app.models.enums import ActivityVerb, GoalStatus, Priority, Source
from app.services import activity, crud, serializers

_FIELDS = ("description", "category", "target_date")


def _resolve_project(session: Session, workspace_id: str, data: dict[str, Any]) -> str | None:
    """``project_id`` follows the task rule: an unknown id is a 422, never a silent ``null``."""
    project_id = data.get("project_id")
    if project_id is not None:
        crud.validate_fk(
            session, Project, str(project_id), workspace_id=workspace_id, field="project_id"
        )
    return project_id


def list_goals(
    session: Session,
    workspace_id: str,
    *,
    status: str | None = None,
    query: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    conditions = [Goal.workspace_id == workspace_id]
    if status:
        conditions.append(Goal.status == status)
    if query:
        needle = query.strip()
        conditions.append(
            sa.or_(
                crud.text_match(Goal.title, needle),
                crud.text_match(Goal.description, needle),
                crud.text_match(Goal.category, needle),
            )
        )
    total = int(session.scalar(sa.select(sa.func.count()).select_from(Goal).where(*conditions)) or 0)
    rows = list(
        session.scalars(
            sa.select(Goal)
            .where(*conditions)
            .order_by(Goal.status, Goal.target_date.is_(None), Goal.target_date, Goal.title, Goal.id)
            .limit(limit)
            .offset(offset)
        )
    )
    return [serializers.goal_payload(row) for row in rows], total


def create_goal(
    session: Session,
    workspace_id: str,
    data: dict[str, Any],
    *,
    source: str = Source.USER.value,
) -> dict[str, Any]:
    goal = Goal(
        workspace_id=workspace_id,
        project_id=_resolve_project(session, workspace_id, data),
        title=str(data["title"]).strip(),
        priority=data.get("priority") or Priority.MEDIUM.value,
        status=data.get("status") or GoalStatus.ACTIVE.value,
        progress=int(data.get("progress") or 0),
        source=source,
    )
    for field in _FIELDS:
        if field in data:
            setattr(goal, field, data[field])
    if goal.status == GoalStatus.COMPLETED.value:
        goal.completed_at = now_utc()
        goal.progress = 100
    session.add(goal)
    session.flush()
    activity.created(
        session,
        workspace_id=workspace_id,
        entity_type="goal",
        entity_id=goal.id,
        entity_title=goal.title,
    )
    return serializers.goal_payload(goal)


def update_goal(
    session: Session, workspace_id: str, goal_id: str, data: dict[str, Any]
) -> dict[str, Any]:
    goal = crud.require(session, Goal, goal_id, workspace_id=workspace_id, label="goal")
    if "project_id" in data:
        goal.project_id = _resolve_project(session, workspace_id, data)
    if "title" in data:
        goal.title = str(data["title"] or "").strip() or goal.title
    for field in _FIELDS:
        if field in data:
            setattr(goal, field, data[field])
    if data.get("priority"):
        goal.priority = str(data["priority"])
    if "progress" in data and data["progress"] is not None:
        goal.progress = int(data["progress"])
    if data.get("status"):
        goal.status = str(data["status"])
    if goal.status == GoalStatus.COMPLETED.value:
        goal.progress = 100
        goal.completed_at = goal.completed_at or now_utc()
    elif goal.completed_at is not None:
        goal.completed_at = None
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="goal",
        entity_id=goal.id,
        entity_title=goal.title,
    )
    return serializers.goal_payload(goal)


def get_goal(session: Session, workspace_id: str, goal_id: str) -> dict[str, Any]:
    goal = crud.require(session, Goal, goal_id, workspace_id=workspace_id, label="goal")
    return serializers.goal_payload(goal)


def delete_goal(session: Session, workspace_id: str, goal_id: str) -> dict[str, Any]:
    goal = crud.require(session, Goal, goal_id, workspace_id=workspace_id, label="goal")
    snapshot = {"id": goal.id, "title": goal.title}
    session.delete(goal)
    session.flush()
    activity.deleted(
        session,
        workspace_id=workspace_id,
        entity_type="goal",
        entity_id=snapshot["id"],
        entity_title=snapshot["title"],
    )
    return snapshot


def complete_goal(session: Session, workspace_id: str, goal_id: str) -> dict[str, Any]:
    goal = crud.require(session, Goal, goal_id, workspace_id=workspace_id, label="goal")
    goal.status = GoalStatus.COMPLETED.value
    goal.progress = 100
    goal.completed_at = now_utc()
    session.flush()
    activity.record(
        session,
        workspace_id=workspace_id,
        verb=ActivityVerb.COMPLETED.value,
        entity_type="goal",
        entity_id=goal.id,
        entity_title=goal.title,
    )
    return serializers.goal_payload(goal)


def past_deadline_goals(
    session: Session, workspace_id: str, today: dt.date
) -> list[tuple[Goal, int]]:
    """``(goal, days_overdue)`` for active goals whose ``target_date`` has passed."""
    rows = session.scalars(
        sa.select(Goal).where(
            Goal.workspace_id == workspace_id,
            Goal.status == GoalStatus.ACTIVE.value,
            Goal.target_date.is_not(None),
            Goal.target_date < today,
        )
    )
    return [(goal, (today - goal.target_date).days) for goal in rows]
