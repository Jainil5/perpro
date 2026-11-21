"""Task schemas (CRUD, kanban move, bulk actions, tolerant import)."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import Field, field_validator

from app.schemas.common import (
    Choice,
    DateIn,
    DateOnly,
    OptionalStr,
    RequestModel,
    ResponseModel,
    RequiredStr,
    TagsIn,
    UtcDateTime,
    require_choice,
)

PriorityIn = Choice("priority", "priority")
TaskStatusIn = Choice("task.status", "status")
RecurrenceIn = Choice("task.recurrence", "recurrence")
BulkAction = Literal["complete", "delete", "set_priority", "set_project"]


class TaskProjectRef(ResponseModel):
    """The trimmed project block every task carries."""

    id: str
    name: str
    status: str


class TaskOut(ResponseModel):
    id: str
    title: str
    description: str | None = None
    notes: str | None = None
    project_id: str | None = None
    project: TaskProjectRef | None = None
    parent_task_id: str | None = None
    status: str
    priority: str
    due_date: DateOnly | None = None
    start_date: DateOnly | None = None
    estimated_minutes: int | None = None
    actual_minutes: int | None = None
    recurrence: str = "none"
    tags: list[str] = Field(default_factory=list)
    position: int = 0
    completed_at: UtcDateTime | None = None
    created_at: UtcDateTime
    updated_at: UtcDateTime
    #: derived flags - "open and due_date < today" / "open and due_date == today"
    is_overdue: bool = False
    is_due_today: bool = False


class TaskCreate(RequestModel):
    """Required ``title``; every other stored field optional."""

    title: RequiredStr("title")
    project_id: str | None = None
    description: str | None = None
    notes: str | None = None
    parent_task_id: str | None = None
    status: TaskStatusIn | None = None
    priority: PriorityIn | None = None
    due_date: DateIn = None
    start_date: DateIn = None
    estimated_minutes: int | None = Field(default=None, ge=0, le=1_000_000)
    actual_minutes: int | None = Field(default=None, ge=0, le=1_000_000)
    recurrence: RecurrenceIn | None = None
    tags: TagsIn = Field(default_factory=list)
    position: int | None = Field(default=None, ge=0)


class TaskUpdate(RequestModel):
    title: OptionalStr("title") = None
    project_id: str | None = None
    description: str | None = None
    notes: str | None = None
    parent_task_id: str | None = None
    status: TaskStatusIn | None = None
    priority: PriorityIn | None = None
    due_date: DateIn = None
    start_date: DateIn = None
    estimated_minutes: int | None = Field(default=None, ge=0, le=1_000_000)
    actual_minutes: int | None = Field(default=None, ge=0, le=1_000_000)
    recurrence: RecurrenceIn | None = None
    tags: TagsIn | None = None
    position: int | None = Field(default=None, ge=0)


class TaskListOut(ResponseModel):
    """``GET /tasks`` - API.md echoes ``limit``/``offset`` next to the envelope."""

    items: list[TaskOut] = Field(default_factory=list)
    total: int = 0
    limit: int = 200
    offset: int = 0


class TaskMoveRequest(RequestModel):
    """``POST /tasks/{id}/move`` — kanban drag: new column and/or new index."""

    status: TaskStatusIn | None = None
    position: int | None = Field(default=None, ge=0)


class TaskBulkRequest(RequestModel):
    ids: list[str] = Field(min_length=1)
    action: BulkAction
    value: Any | None = None

    @field_validator("ids")
    @classmethod
    def _strip_and_dedupe_ids(cls, ids: list[str]) -> list[str]:
        seen: list[str] = []
        for raw in ids:
            item = (raw or "").strip()
            if not item:
                raise ValueError("ids must not contain empty values")
            if item not in seen:
                seen.append(item)
        return seen

    @field_validator("value")
    @classmethod
    def _value_matches_action(cls, value: Any, info) -> Any:
        action = info.data.get("action")
        if action == "set_priority":
            return require_choice(value, "priority", "value")
        if action == "set_project" and value is not None and not isinstance(value, str):
            raise ValueError("value must be a project id (or null) for action=set_project")
        return value


class TaskImportRequest(RequestModel):
    raw: str = Field(min_length=1)
    project_id: str | None = None
    allow_duplicates: bool = False


class RejectedItem(ResponseModel):
    index: int
    title: str | None = None
    reason: str


class ImportOut(ResponseModel):
    created: int = 0
    duplicates: int = 0
    rejected: list[RejectedItem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class FailedItem(ResponseModel):
    id: str
    error: str


class BulkOut(ResponseModel):
    updated: int = 0
    failed: list[FailedItem] = Field(default_factory=list)


class RecurrenceOut(ResponseModel):
    """``POST /tasks/{id}/complete`` on a recurring task.

    Non-recurring completions return the bare task object instead; the router
    therefore has no single ``response_model`` for that endpoint.
    """

    task: TaskOut
    next: TaskOut | None = None
