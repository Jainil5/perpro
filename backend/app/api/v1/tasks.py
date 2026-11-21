"""``/tasks`` - CRUD, kanban move, bulk actions and the tolerant importer.

API.md gives this resource the most surface of any Phase 1 module, so the router is a
thin table of contents: every branch calls into :mod:`app.services.tasks` (or
:mod:`app.services.importer`) and returns what it gets back.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.v1.deps import DbSession, Today, WorkspaceScope, enum_param, sort_param, value_param
from app.schemas.tasks import (
    BulkOut,
    ImportOut,
    TaskBulkRequest,
    TaskCreate,
    TaskImportRequest,
    TaskListOut,
    TaskMoveRequest,
    TaskOut,
    TaskUpdate,
)
from app.services import importer, serializers, tasks

router = APIRouter(tags=["tasks"])

TASK_SORTS = ("due", "priority", "created", "position", "title", "updated")
DUE_FILTERS = ("today", "week", "overdue", "upcoming", "none")

StatusQuery = Annotated[str | None, enum_param("task.status", "status")]
PriorityQuery = Annotated[str | None, enum_param("priority", "priority")]
DueQuery = Annotated[str | None, value_param(DUE_FILTERS, "due", unit="due filter")]
SortQuery = Annotated[str, sort_param(*TASK_SORTS, default="due")]
LimitQuery = Annotated[int, Query(ge=1, le=1000)]
OffsetQuery = Annotated[int, Query(ge=0)]


@router.get("", response_model=TaskListOut, summary="List tasks with the documented filters")
def list_tasks(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    status_filter: StatusQuery,
    priority: PriorityQuery,
    due: DueQuery,
    sort: SortQuery,
    limit: LimitQuery = 200,
    offset: OffsetQuery = 0,
    project_id: Annotated[
        str | None, Query(description="a project id, or 'none' for tasks without one")
    ] = None,
    tag: Annotated[str | None, Query(description="tag name, leading '#' optional")] = None,
    q: Annotated[str | None, Query(description="title/description/notes substring")] = None,
    include_subtasks: Annotated[bool, Query()] = True,
) -> dict:
    items, total = tasks.list_tasks(
        session,
        scope,
        status=status_filter,
        priority=priority,
        project_id=project_id,
        tag=tag,
        due=due,
        query=q,
        sort=sort,
        limit=limit,
        offset=offset,
        today=today,
        include_subtasks=include_subtasks,
    )
    return serializers.page_payload(items, total, limit=limit, offset=offset)


@router.post(
    "", response_model=TaskOut, status_code=status.HTTP_201_CREATED, summary="Create a task"
)
def create_task(session: DbSession, scope: WorkspaceScope, payload: TaskCreate) -> dict:
    return tasks.create_task(session, scope, payload.model_dump())


@router.post("/bulk", response_model=BulkOut, summary="Complete, delete or re-set many tasks")
def bulk_tasks(session: DbSession, scope: WorkspaceScope, payload: TaskBulkRequest) -> dict:
    return tasks.bulk_tasks(
        session, scope, ids=list(payload.ids), action=payload.action, value=payload.value
    )


@router.post(
    "/import",
    response_model=ImportOut,
    summary="Import tasks from messy JSON (fences, prose, trailing commas, alias keys)",
)
def import_tasks(session: DbSession, scope: WorkspaceScope, payload: TaskImportRequest) -> dict:
    return importer.import_tasks(
        session,
        scope,
        raw=payload.raw,
        project_id=payload.project_id,
        allow_duplicates=payload.allow_duplicates,
    )


@router.get("/{task_id}", response_model=TaskOut, summary="One task")
def get_task(session: DbSession, scope: WorkspaceScope, task_id: str) -> dict:
    return tasks.get_task(session, scope, task_id)


@router.patch("/{task_id}", response_model=TaskOut, summary="Update a task")
def update_task(
    session: DbSession, scope: WorkspaceScope, task_id: str, payload: TaskUpdate
) -> dict:
    return tasks.update_task(session, scope, task_id, payload.model_dump(exclude_unset=True))


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a task")
def delete_task(session: DbSession, scope: WorkspaceScope, task_id: str) -> Response:
    tasks.delete_task(session, scope, task_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{task_id}/complete",
    summary="Complete a task; a recurring one returns {task, next}",
    response_model=None,
)
def complete_task(session: DbSession, scope: WorkspaceScope, task_id: str, today: Today) -> dict:
    """No single response model: API.md returns the task, or ``{task, next}``."""
    return tasks.complete_task(session, scope, task_id, today=today)


@router.post("/{task_id}/reopen", response_model=TaskOut, summary="Reopen a completed task")
def reopen_task(session: DbSession, scope: WorkspaceScope, task_id: str) -> dict:
    return tasks.reopen_task(session, scope, task_id)


@router.post(
    "/{task_id}/move", response_model=TaskOut, summary="Kanban drag: new column and/or index"
)
def move_task(
    session: DbSession, scope: WorkspaceScope, task_id: str, payload: TaskMoveRequest
) -> dict:
    return tasks.move_task(
        session, scope, task_id, status=payload.status, position=payload.position
    )
