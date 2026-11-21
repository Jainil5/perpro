"""Signals: notifications, reminders, activity log and goals."""

from __future__ import annotations

from pydantic import Field, field_validator

from app.schemas.common import (
    Choice,
    DateIn,
    DateOnly,
    DateTimeIn,
    ListEnvelope,
    OptionalStr,
    RequestModel,
    RequiredDateTimeIn,
    RequiredStr,
    ResponseModel,
    TextIn,
    UtcDateTime,
)
from app.schemas.tasks import TaskProjectRef


class NotificationOut(ResponseModel):
    id: str
    kind: str
    severity: str
    title: str
    body: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    href: str | None = None
    read: bool = False
    read_at: UtcDateTime | None = None
    dedupe_key: str
    created_at: UtcDateTime
    updated_at: UtcDateTime


class NotificationListOut(ResponseModel):
    items: list[NotificationOut] = Field(default_factory=list)
    unread: int = 0


class NotificationPatch(RequestModel):
    read: bool | None = None


class ReminderOut(ResponseModel):
    id: str
    title: str
    due_at: UtcDateTime | None = None
    status: str
    entity_type: str | None = None
    entity_id: str | None = None
    notes: str | None = None
    snoozed_until: UtcDateTime | None = None
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ReminderListOut(ListEnvelope[ReminderOut]):
    pass


class ReminderCreate(RequestModel):
    title: RequiredStr("title")
    due_at: RequiredDateTimeIn
    entity_type: Choice("note_relation.target_type", "entity_type") | None = None
    entity_id: str | None = None
    notes: TextIn = None


class ReminderUpdate(RequestModel):
    title: OptionalStr("title") = None
    due_at: DateTimeIn = None
    status: Choice("reminder.status", "status") | None = None
    entity_type: Choice("note_relation.target_type", "entity_type") | None = None
    entity_id: str | None = None
    notes: TextIn = None


class SnoozeRequest(RequestModel):
    """``POST /reminders/{id}/snooze`` — ``{ "minutes": 60 }`` from now."""

    minutes: int = Field(default=60, ge=1, le=60 * 24 * 365)


class ActivityOut(ResponseModel):
    id: str
    verb: str
    entity_type: str
    entity_id: str | None = None
    entity_title: str | None = None
    summary: str | None = None
    project_id: str | None = None
    href: str | None = None
    actor: str
    created_at: UtcDateTime


class ActivityListOut(ListEnvelope[ActivityOut]):
    pass


class GoalOut(ResponseModel):
    id: str
    title: str
    description: str | None = None
    project_id: str | None = None
    project: TaskProjectRef | None = None
    category: str | None = None
    priority: str
    status: str
    progress: int = 0
    target_date: DateOnly | None = None
    completed_at: UtcDateTime | None = None
    created_at: UtcDateTime
    updated_at: UtcDateTime


class GoalListOut(ListEnvelope[GoalOut]):
    pass


class GoalCreate(RequestModel):
    title: RequiredStr("title")
    description: str | None = None
    project_id: str | None = None
    category: str | None = None
    priority: Choice("priority", "priority") | None = None
    status: Choice("goal.status", "status") | None = None
    progress: int = Field(default=0, ge=0, le=100)
    target_date: DateIn = None


class GoalUpdate(RequestModel):
    title: OptionalStr("title") = None
    description: str | None = None
    project_id: str | None = None
    category: str | None = None
    priority: Choice("priority", "priority") | None = None
    status: Choice("goal.status", "status") | None = None
    progress: int | None = Field(default=None, ge=0, le=100)
    target_date: DateIn = None


class RefreshOut(ResponseModel):
    """``POST /notifications/refresh`` — idempotent, driven by ``dedupe_key``."""

    created: int = 0
    resolved: int = 0


class SeedOut(ResponseModel):
    """``POST /demo/seed`` and ``POST /demo/reset``."""

    created: dict[str, int] = Field(default_factory=dict)
    skipped: bool = False


class ReadAllOut(ResponseModel):
    updated: int = 0


class DeleteOut(ResponseModel):
    deleted: int = 0
