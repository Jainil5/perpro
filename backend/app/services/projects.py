"""Project business logic: listing, create/update/delete, stats, cascade rules."""

from __future__ import annotations

import datetime as dt
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.models import Goal, Milestone, Project, Task
from app.models.enums import Priority, ProjectStatus
from app.services import activity, crud, serializers
from app.services.stats import aggregates_for_projects, task_stats_row

_SORTS: dict[str, tuple[Any, ...]] = {
    "updated": (Project.updated_at.desc(), Project.name),
    "target": (Project.target_date.is_(None), Project.target_date, Project.name),
    "name": (Project.name,),
    "status": (Project.status, Project.name),
    "priority": (Project.priority, Project.name),
}


def list_projects(
    session: Session,
    workspace_id: str,
    *,
    status: str | None = None,
    priority: str | None = None,
    query: str | None = None,
    sort: str = "updated",
    limit: int | None = None,
    offset: int = 0,
    today: dt.date | None = None,
) -> tuple[list[dict[str, Any]], int]:
    statement = sa.select(Project).where(Project.workspace_id == workspace_id)
    if status:
        statement = statement.where(Project.status == status)
    if priority:
        statement = statement.where(Project.priority == priority)
    if query:
        needle = query.strip()
        statement = statement.where(
            sa.or_(
                crud.text_match(Project.name, needle),
                crud.text_match(Project.description, needle),
                crud.text_match(Project.next_action, needle),
                crud.text_match(Project.category, needle),
            )
        )
    total = int(
        session.scalar(
            sa.select(sa.func.count()).select_from(statement.order_by(None).subquery())
        )
        or 0
    )
    order = _SORTS.get(sort, _SORTS["updated"])
    statement = statement.order_by(*order)
    if limit is not None:
        statement = statement.limit(limit)
    if offset:
        statement = statement.offset(offset)
    rows = list(session.scalars(statement))
    return serializers.project_payloads(session, rows, workspace_id, today=today), total


def get_project(session: Session, workspace_id: str, project_id: str) -> dict[str, Any]:
    project = crud.require(session, Project, project_id, workspace_id=workspace_id, label="project")
    return serializers.project_payload_one(session, project)


def create_project(
    session: Session, workspace_id: str, data: dict[str, Any], *, source: str = "user"
) -> dict[str, Any]:
    name = str(data.pop("name")).strip()
    project = Project(
        workspace_id=workspace_id,
        name=name,
        slug=crud.project_slug(session, workspace_id, name),
        status=data.get("status") or ProjectStatus.BACKLOG.value,
        priority=data.get("priority") or Priority.MEDIUM.value,
        manual_progress=int(data.get("manual_progress") or 0),
        source=source,
    )
    for field in (
        "description",
        "category",
        "start_date",
        "target_date",
        "repository_url",
        "documentation_url",
        "next_action",
    ):
        if field in data:
            setattr(project, field, data[field])
    session.add(project)
    session.flush()
    activity.created(
        session,
        workspace_id=workspace_id,
        entity_type="project",
        entity_id=project.id,
        entity_title=project.name,
        project_id=project.id,
    )
    return serializers.project_payload_one(session, project)


def _apply(session: Session, project: Project, data: dict[str, Any]) -> None:
    for field, value in data.items():
        if field == "name":
            cleaned = str(value).strip()
            project.name = cleaned
            project.slug = crud.project_slug(session, project.workspace_id, cleaned, exclude_id=project.id)
        else:
            setattr(project, field, value)


def update_project(
    session: Session, workspace_id: str, project_id: str, data: dict[str, Any]
) -> dict[str, Any]:
    project = crud.require(session, Project, project_id, workspace_id=workspace_id, label="project")
    changes = dict(data)
    if "manual_progress" in changes and changes["manual_progress"] is None:
        changes["manual_progress"] = project.manual_progress
    _apply(session, project, changes)
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="project",
        entity_id=project.id,
        entity_title=project.name,
        project_id=project.id,
        payload={"fields": sorted(changes)},
    )
    return serializers.project_payload_one(session, project)


def delete_project(session: Session, workspace_id: str, project_id: str) -> dict[str, Any]:
    """API.md cascade: tasks are *kept* (``project_id`` -> null), milestones deleted."""
    project = crud.require(session, Project, project_id, workspace_id=workspace_id, label="project")
    detached = int(
        session.scalar(
            sa.select(sa.func.count()).select_from(Task).where(Task.project_id == project.id)
        )
        or 0
    )
    removed_milestones = int(
        session.scalar(
            sa.select(sa.func.count()).select_from(Milestone).where(Milestone.project_id == project.id)
        )
        or 0
    )
    session.execute(
        sa.update(Task).where(Task.project_id == project.id).values(project_id=None)
    )
    # goals are not part of the project's work breakdown, so they survive it (SET NULL)
    session.execute(sa.update(Goal).where(Goal.project_id == project.id).values(project_id=None))
    session.execute(sa.delete(Milestone).where(Milestone.project_id == project.id))
    snapshot = {
        "id": project.id,
        "name": project.name,
        "status": project.status,
        "tasks_detached": detached,
        "milestones_deleted": removed_milestones,
    }
    session.delete(project)
    session.flush()
    activity.deleted(
        session,
        workspace_id=workspace_id,
        entity_type="project",
        entity_id=snapshot["id"],
        entity_title=snapshot["name"],
        project_id=None,
        payload={"tasks_detached": detached, "milestones_deleted": removed_milestones},
    )
    return snapshot


def project_stats(
    session: Session, workspace_id: str, project_id: str, today: dt.date | None = None
) -> dict[str, Any]:
    project = crud.require(session, Project, project_id, workspace_id=workspace_id, label="project")
    aggregates = aggregates_for_projects(session, workspace_id, [project.id], today=today)
    return task_stats_row(aggregates[project.id])
