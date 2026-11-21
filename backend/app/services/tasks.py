"""Task business logic: CRUD, complete/reopen, kanban move, bulk actions.

Recurrence rollover lives here (it uses :mod:`app.services.recurrence`), as does the
scoping: a task id from another workspace is a 409, an unknown one a 404, and a
``project_id`` that does not exist is a 422 - never a silent ``null``.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.errors import ApiError, field_error, validation
from app.core.utils import new_id, now_utc, today_utc
from app.models import Project, Tag, Task
from app.models.enums import ActivityVerb, Priority, Recurrence, Source, TaskStatus
from app.services import activity, crud, serializers
from app.services.recurrence import is_recurring, next_occurrence
from app.services.stats import sort_tasks

EDITABLE_FIELDS = (
    "description",
    "notes",
    "due_date",
    "start_date",
    "estimated_minutes",
    "actual_minutes",
    "priority",
    "recurrence",
    "position",
)


def list_tasks(
    session: Session,
    workspace_id: str,
    *,
    status: str | None = None,
    priority: str | None = None,
    project_id: str | None = None,
    tag: str | None = None,
    due: str | None = None,
    query: str | None = None,
    sort: str = "due",
    limit: int = 200,
    offset: int = 0,
    today: dt.date | None = None,
    include_subtasks: bool = True,
) -> tuple[list[dict[str, Any]], int]:
    """``GET /tasks`` - filters from API.md, ``{items, total, limit, offset}``."""
    day = today or today_utc()
    conditions: list[Any] = [Task.workspace_id == workspace_id]
    if status:
        conditions.append(Task.status == status)
    if priority:
        conditions.append(Task.priority == priority)
    if project_id:
        if project_id == "none":
            conditions.append(Task.project_id.is_(None))
        else:
            conditions.append(Task.project_id == project_id)
    if query:
        needle = query.strip()
        conditions.append(
            sa.or_(
                crud.text_match(Task.title, needle),
                crud.text_match(Task.description, needle),
                crud.text_match(Task.notes, needle),
            )
        )
    if due:
        conditions.append(_due_clause(due, day))
    if not include_subtasks:
        conditions.append(Task.parent_task_id.is_(None))

    statement = sa.select(Task).where(*conditions)
    if tag:
        statement = (
            statement.join(Task.tags)
            .where(sa.func.lower(Tag.name) == tag.strip().lstrip("#").lower())
            .distinct()
        )
    total = int(
        session.scalar(sa.select(sa.func.count(sa.distinct(Task.id))).where(*conditions)) or 0
    )
    rows = list(session.scalars(sort_tasks(statement, sort).limit(limit).offset(offset)))
    return serializers.task_payloads(rows, day), total


def _due_clause(due: str, day: dt.date):
    """``GET /tasks?due=today|week|overdue|none|upcoming``."""
    open_statuses = Task.status.in_(TaskStatus.open_values())
    if due == "today":
        return sa.and_(open_statuses, Task.due_date == day)
    if due == "overdue":
        return sa.and_(open_statuses, Task.due_date.is_not(None), Task.due_date < day)
    if due == "week":
        return sa.and_(
            open_statuses, Task.due_date >= day, Task.due_date <= day + dt.timedelta(days=7)
        )
    if due == "upcoming":
        return sa.and_(open_statuses, Task.due_date > day)
    if due == "none":
        return Task.due_date.is_(None)
    return sa.true()


def get_task(session: Session, workspace_id: str, task_id: str) -> dict[str, Any]:
    task = crud.require(session, Task, task_id, workspace_id=workspace_id, label="task")
    return serializers.task_payload(task)


def _validate_links(session: Session, workspace_id: str, data: dict[str, Any]) -> None:
    """Response rule 2: a dangling FK is a 422."""
    if "project_id" in data:
        crud.validate_fk(
            session, Project, data["project_id"], workspace_id=workspace_id, field="project_id"
        )
    parent_id = data.get("parent_task_id")
    if parent_id:
        parent = crud.require(
            session, Task, str(parent_id), workspace_id=workspace_id, label="parent task"
        )
        project_id = data.get("project_id")
        if project_id and parent.project_id != project_id:
            raise validation(
                "parent_task_id must belong to the same project",
                [field_error(["body", "parent_task_id"], "project mismatch with parent task")],
            )


def _next_position(session: Session, workspace_id: str, project_id: str | None, status: str) -> int:
    scope = Task.project_id == project_id if project_id else Task.project_id.is_(None)
    current = session.scalar(
        sa.select(sa.func.max(Task.position)).where(
            Task.workspace_id == workspace_id, scope, Task.status == status
        )
    )
    return int(current or 0) + 1


def create_task(
    session: Session,
    workspace_id: str,
    data: dict[str, Any],
    *,
    source: str = Source.USER.value,
    record_activity: bool = True,
) -> dict[str, Any]:
    """``POST /tasks``. Required ``title``; ids are always server-generated."""
    payload = dict(data)
    title = str(payload.pop("title")).strip()
    _validate_links(session, workspace_id, payload)
    tags = list(payload.pop("tags", None) or [])
    status = payload.pop("status", None) or TaskStatus.TODO.value
    priority = payload.pop("priority", None) or Priority.MEDIUM.value
    recurrence = payload.pop("recurrence", None) or Recurrence.NONE.value
    project_id = payload.get("project_id")
    position = payload.pop("position", None)
    task = Task(
        id=new_id(),
        workspace_id=workspace_id,
        title=title,
        status=status,
        priority=priority,
        recurrence=recurrence,
        position=(
            int(position)
            if position is not None
            else _next_position(session, workspace_id, project_id, status)
        ),
        source=source,
    )
    for field in EDITABLE_FIELDS + ("project_id", "parent_task_id"):
        if field in payload:
            setattr(task, field, payload[field])
    if task.status == TaskStatus.DONE.value and task.completed_at is None:
        task.completed_at = now_utc()
    session.add(task)
    session.flush()
    if tags:
        crud.set_tags(session, workspace_id, task, tags)
    if record_activity:
        activity.created(
            session,
            workspace_id=workspace_id,
            entity_type="task",
            entity_id=task.id,
            entity_title=task.title,
            project_id=task.project_id,
        )
    return serializers.task_payload(task)


def update_task(
    session: Session,
    workspace_id: str,
    task_id: str,
    data: dict[str, Any],
    *,
    record_activity: bool = True,
    verb: str = ActivityVerb.UPDATED.value,
) -> dict[str, Any]:
    """``PATCH /tasks/{id}`` - only the keys present in ``data`` are touched."""
    task = crud.require(session, Task, task_id, workspace_id=workspace_id, label="task")
    payload = dict(data)
    _validate_links(
        session, workspace_id, {key: payload[key] for key in ("project_id", "parent_task_id") if key in payload}
    )
    touched: list[str] = []

    if "title" in payload:
        task.title = str(payload.pop("title") or "").strip() or task.title
        touched.append("title")
    if "project_id" in payload:
        task.project_id = payload.pop("project_id")
        touched.append("project_id")
    if "parent_task_id" in payload:
        parent_id = payload.pop("parent_task_id")
        if parent_id == task.id:
            raise validation(
                "a task cannot be its own parent",
                [field_error(["body", "parent_task_id"], "self reference")],
            )
        task.parent_task_id = parent_id
        touched.append("parent_task_id")
    if "status" in payload:
        status = payload.pop("status")
        if status:
            _set_status(task, str(status))
            touched.append("status")
    if "tags" in payload:
        crud.set_tags(session, workspace_id, task, list(payload.pop("tags") or []))
        touched.append("tags")
    for field in EDITABLE_FIELDS:
        if field in payload:
            setattr(task, field, payload[field])
            touched.append(field)
    session.flush()

    if record_activity:
        activity.record(
            session,
            workspace_id=workspace_id,
            verb=verb,
            entity_type="task",
            entity_id=task.id,
            entity_title=task.title,
            project_id=task.project_id,
            payload={"fields": sorted(set(touched))},
        )
    return serializers.task_payload(task)


def _set_status(task: Task, status: str) -> None:
    """Keep ``completed_at`` in step with the status (API.md complete/reopen)."""
    task.status = status
    if status == TaskStatus.DONE.value:
        if task.completed_at is None:
            task.completed_at = now_utc()
    elif task.status != TaskStatus.DONE.value:
        task.completed_at = None


def delete_task(session: Session, workspace_id: str, task_id: str) -> dict[str, Any]:
    """Subtasks survive and are detached from the deleted parent."""
    task = crud.require(session, Task, task_id, workspace_id=workspace_id, label="task")
    snapshot = {"id": task.id, "title": task.title, "project_id": task.project_id}
    session.execute(sa.update(Task).where(Task.parent_task_id == task.id).values(parent_task_id=None))
    session.delete(task)
    session.flush()
    activity.deleted(
        session,
        workspace_id=workspace_id,
        entity_type="task",
        entity_id=snapshot["id"],
        entity_title=snapshot["title"],
        project_id=None,
    )
    return snapshot


def complete_task(
    session: Session, workspace_id: str, task_id: str, *, today: dt.date | None = None
) -> dict[str, Any]:
    """Complete a task; a recurring one also spawns the next occurrence.

    Returns the bare task object, or ``{"task": done, "next": rolled}`` when it recurs
    (API.md ``POST /tasks/{id}/complete``).
    """
    day = today or today_utc()
    task = crud.require(session, Task, task_id, workspace_id=workspace_id, label="task")
    was_open = task.status != TaskStatus.DONE.value
    _set_status(task, TaskStatus.DONE.value)
    session.flush()
    if was_open:
        activity.record(
            session,
            workspace_id=workspace_id,
            verb=ActivityVerb.COMPLETED.value,
            entity_type="task",
            entity_id=task.id,
            entity_title=task.title,
            project_id=task.project_id,
        )
    done_payload = serializers.task_payload(task, day)
    if not is_recurring(task.recurrence):
        return done_payload

    anchor = task.due_date or task.start_date or day
    upcoming = next_occurrence(task.due_date or anchor, task.recurrence, day, anchor=anchor)
    repeat = Task(
        id=new_id(),
        workspace_id=task.workspace_id,
        title=task.title,
        description=task.description,
        notes=task.notes,
        project_id=task.project_id,
        parent_task_id=task.parent_task_id,
        status=TaskStatus.TODO.value,
        priority=task.priority,
        due_date=upcoming,
        start_date=upcoming if task.start_date else None,
        estimated_minutes=task.estimated_minutes,
        recurrence=task.recurrence,
        position=task.position,
        source=task.source,
    )
    session.add(repeat)
    session.flush()
    repeat.tags = list(task.tags)
    session.flush()
    activity.record(
        session,
        workspace_id=workspace_id,
        verb=ActivityVerb.CREATED.value,
        entity_type="task",
        entity_id=repeat.id,
        entity_title=repeat.title,
        project_id=repeat.project_id,
        summary=f"Scheduled next occurrence of “{repeat.title}”",
        payload={"from_task_id": task.id, "recurrence": repeat.recurrence},
    )
    return {"task": done_payload, "next": serializers.task_payload(repeat, day)}


def reopen_task(session: Session, workspace_id: str, task_id: str) -> dict[str, Any]:
    task = crud.require(session, Task, task_id, workspace_id=workspace_id, label="task")
    _set_status(task, TaskStatus.TODO.value)
    session.flush()
    activity.record(
        session,
        workspace_id=workspace_id,
        verb=ActivityVerb.REOPENED.value,
        entity_type="task",
        entity_id=task.id,
        entity_title=task.title,
        project_id=task.project_id,
    )
    return serializers.task_payload(task)


def move_task(
    session: Session,
    workspace_id: str,
    task_id: str,
    *,
    status: str | None = None,
    position: int | None = None,
) -> dict[str, Any]:
    """``POST /tasks/{id}/move`` - kanban drag: new column and/or new index."""
    task = crud.require(session, Task, task_id, workspace_id=workspace_id, label="task")
    detail: list[str] = []
    if status is not None and status != task.status:
        _set_status(task, str(status))
        detail.append(f"to {status}")
    if position is not None:
        task.position = int(position)
        detail.append(f"to position {task.position}")
    session.flush()
    activity.record(
        session,
        workspace_id=workspace_id,
        verb=ActivityVerb.MOVED.value,
        entity_type="task",
        entity_id=task.id,
        entity_title=task.title,
        project_id=task.project_id,
        summary=activity.summary_for(
            ActivityVerb.MOVED.value, task.title, detail=" ".join(detail) if detail else None
        ),
        payload={"status": task.status, "position": task.position},
    )
    return serializers.task_payload(task)


BULK_ACTIONS = ("complete", "delete", "set_priority", "set_project")


def bulk_tasks(
    session: Session,
    workspace_id: str,
    *,
    ids: list[str],
    action: str,
    value: Any = None,
) -> dict[str, Any]:
    """``POST /tasks/bulk`` - per-id failures are reported, not raised (409 semantics)."""
    if action == "set_priority":
        normalized = str(value or "").strip().lower()
        if normalized not in {member.value for member in Priority}:
            raise validation(
                "value must be a priority for action=set_priority",
                [field_error(["body", "value"], f"expected one of: {', '.join(sorted(m.value for m in Priority))}")],
            )
        value = normalized
    if action == "set_project" and value not in (None, "", "null"):
        crud.validate_fk(session, Project, str(value), workspace_id=workspace_id, field="project_id")

    updated = 0
    failed: list[dict[str, Any]] = []
    for entity_id in ids:
        task = session.get(Task, entity_id)
        if task is None:
            failed.append({"id": entity_id, "error": "not_found"})
            continue
        if task.workspace_id != workspace_id:
            failed.append({"id": entity_id, "error": "conflict"})
            continue
        try:
            if action == "complete":
                complete_task(session, workspace_id, task.id)
            elif action == "delete":
                delete_task(session, workspace_id, task.id)
            elif action == "set_priority":
                update_task(session, workspace_id, task.id, {"priority": value})
            elif action == "set_project":
                project_id = None if value in (None, "", "null") else str(value)
                update_task(session, workspace_id, task.id, {"project_id": project_id})
            updated += 1
        except ApiError as exc:
            # the value/FK checks above make this rare; never fail the whole batch for it
            failed.append({"id": entity_id, "error": exc.code})
    return {"updated": updated, "failed": failed}
