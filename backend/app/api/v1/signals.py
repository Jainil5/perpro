"""Signals: ``/notifications``, ``/reminders``, ``/activity`` and ``/goals``.

Notifications are derived data: only ``POST /notifications/refresh`` (or the CLI)
writes them, because API.md rule 4 forbids GETs from creating notifications.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.v1.deps import DbSession, Today, WorkspaceScope, enum_param, value_param
from app.core.errors import field_error, validation
from app.schemas.signals import (
    ActivityListOut,
    GoalCreate,
    GoalListOut,
    GoalOut,
    GoalUpdate,
    NotificationListOut,
    NotificationOut,
    NotificationPatch,
    ReadAllOut,
    RefreshOut,
    ReminderCreate,
    ReminderListOut,
    ReminderOut,
    ReminderUpdate,
    SnoozeRequest,
)
from app.services import activity, goals, notifications, reminders, serializers

router = APIRouter(tags=["signals"])

REMINDER_DUE_FILTERS = ("now", "today", "none")

NotificationKindQuery = Annotated[str | None, enum_param("notification.kind", "kind")]
ReminderStatusQuery = Annotated[str | None, enum_param("reminder.status", "status")]
GoalStatusQuery = Annotated[str | None, enum_param("goal.status", "status")]
ActivityVerbQuery = Annotated[str | None, enum_param("activity.verb", "verb")]
ReminderDueQuery = Annotated[
    str | None, value_param(REMINDER_DUE_FILTERS, "due", unit="due filter")
]


# -------------------------------------------------------------- notifications
@router.get(
    "/notifications",
    response_model=NotificationListOut,
    summary="Open notifications, most severe first",
)
def list_notifications(
    session: DbSession,
    scope: WorkspaceScope,
    kind: NotificationKindQuery,
    unread: Annotated[bool, Query(description="unread=true keeps only unread rows")] = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict:
    return notifications.list_notifications(
        session, scope, unread_only=unread, kind=kind, limit=limit
    )


@router.post(
    "/notifications/refresh",
    response_model=RefreshOut,
    summary="Re-derive notifications idempotently (dedupe_key)",
)
def refresh_notifications(session: DbSession, scope: WorkspaceScope, today: Today) -> dict:
    return notifications.refresh(session, scope, today=today)


@router.post(
    "/notifications/read-all", response_model=ReadAllOut, summary="Mark every open row read"
)
def read_all(session: DbSession, scope: WorkspaceScope) -> dict:
    return notifications.mark_all_read(session, scope)


@router.patch(
    "/notifications/{notification_id}", response_model=NotificationOut, summary="Set read"
)
def patch_notification(
    session: DbSession,
    scope: WorkspaceScope,
    notification_id: str,
    payload: NotificationPatch,
) -> dict:
    if payload.read is None:
        raise validation(
            "read is required", [field_error(["body", "read"], "expected true or false")]
        )
    return notifications.set_read(session, scope, notification_id, read=payload.read)


@router.delete(
    "/notifications/{notification_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Dismiss a notification",
)
def delete_notification(
    session: DbSession, scope: WorkspaceScope, notification_id: str
) -> Response:
    notifications.delete_notification(session, scope, notification_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------ reminders
@router.get("/reminders", response_model=ReminderListOut, summary="List reminders")
def list_reminders(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    status_filter: ReminderStatusQuery,
    due: ReminderDueQuery,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    items, total = reminders.list_reminders(
        session, scope, status=status_filter, due=due, limit=limit, offset=offset, today=today
    )
    return serializers.page_payload(items, total, limit=limit, offset=offset)


@router.post(
    "/reminders",
    response_model=ReminderOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a reminder",
)
def create_reminder(session: DbSession, scope: WorkspaceScope, payload: ReminderCreate) -> dict:
    return reminders.create_reminder(session, scope, payload.model_dump())


@router.get("/reminders/{reminder_id}", response_model=ReminderOut, summary="One reminder")
def get_reminder(session: DbSession, scope: WorkspaceScope, reminder_id: str) -> dict:
    return reminders.get_reminder(session, scope, reminder_id)


@router.patch("/reminders/{reminder_id}", response_model=ReminderOut, summary="Update a reminder")
def update_reminder(
    session: DbSession, scope: WorkspaceScope, reminder_id: str, payload: ReminderUpdate
) -> dict:
    return reminders.update_reminder(
        session, scope, reminder_id, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/reminders/{reminder_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a reminder",
)
def delete_reminder(session: DbSession, scope: WorkspaceScope, reminder_id: str) -> Response:
    reminders.delete_reminder(session, scope, reminder_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/reminders/{reminder_id}/complete", response_model=ReminderOut, summary="Complete a reminder"
)
def complete_reminder(session: DbSession, scope: WorkspaceScope, reminder_id: str) -> dict:
    return reminders.complete_reminder(session, scope, reminder_id)


@router.post(
    "/reminders/{reminder_id}/snooze",
    response_model=ReminderOut,
    summary="Push a reminder N minutes into the future",
)
def snooze_reminder(
    session: DbSession, scope: WorkspaceScope, reminder_id: str, payload: SnoozeRequest
) -> dict:
    return reminders.snooze(session, scope, reminder_id, minutes=payload.minutes)


# ------------------------------------------------------------------- activity
@router.get("/activity", response_model=ActivityListOut, summary="Recent activity log")
def list_activity(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    verb: ActivityVerbQuery,
    entity_type: Annotated[str | None, Query()] = None,
    project_id: Annotated[str | None, Query()] = None,
    days: Annotated[int | None, Query(ge=0, le=3650, description="0 = no time window")] = 7,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    items, total = activity.list_activity(
        session,
        scope,
        entity_type=entity_type,
        project_id=project_id,
        verb=verb,
        days=days,
        limit=limit,
        offset=offset,
        today=today,
    )
    return serializers.page_payload(items, total, limit=limit, offset=offset)


# ---------------------------------------------------------------------- goals
@router.get("/goals", response_model=GoalListOut, summary="List goals")
def list_goals(
    session: DbSession,
    scope: WorkspaceScope,
    status_filter: GoalStatusQuery,
    q: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    items, total = goals.list_goals(
        session, scope, status=status_filter, query=q, limit=limit, offset=offset
    )
    return serializers.page_payload(items, total, limit=limit, offset=offset)


@router.post(
    "/goals",
    response_model=GoalOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a goal",
)
def create_goal(session: DbSession, scope: WorkspaceScope, payload: GoalCreate) -> dict:
    return goals.create_goal(session, scope, payload.model_dump())


@router.get("/goals/{goal_id}", response_model=GoalOut, summary="One goal")
def get_goal(session: DbSession, scope: WorkspaceScope, goal_id: str) -> dict:
    return goals.get_goal(session, scope, goal_id)


@router.patch("/goals/{goal_id}", response_model=GoalOut, summary="Update a goal")
def update_goal(
    session: DbSession, scope: WorkspaceScope, goal_id: str, payload: GoalUpdate
) -> dict:
    return goals.update_goal(session, scope, goal_id, payload.model_dump(exclude_unset=True))


@router.post(
    "/goals/{goal_id}/complete", response_model=GoalOut, summary="Complete a goal (progress=100)"
)
def complete_goal(session: DbSession, scope: WorkspaceScope, goal_id: str) -> dict:
    return goals.complete_goal(session, scope, goal_id)


@router.delete(
    "/goals/{goal_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a goal"
)
def delete_goal(session: DbSession, scope: WorkspaceScope, goal_id: str) -> Response:
    goals.delete_goal(session, scope, goal_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
