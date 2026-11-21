"""Reminders: a point in time attached to an entity (``/reminders``).

``snooze`` moves ``snoozed_until`` forward by ``minutes`` from now; the notification
rule in :mod:`app.services.notifications` treats ``snoozed_until or due_at`` as the
effective deadline, so snoozing silences the derived notification until then.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.utils import now_utc
from app.models import Reminder
from app.models.enums import ActivityVerb, ReminderStatus, Source
from app.services import activity, crud, serializers

_FIELDS = ("title", "due_at", "notes", "entity_type", "entity_id")


def list_reminders(
    session: Session,
    workspace_id: str,
    *,
    status: str | None = None,
    due: str | None = None,
    limit: int = 100,
    offset: int = 0,
    today: dt.date | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """``GET /reminders?status=pending`` (+ ``due=now|today|none``)."""
    conditions = [Reminder.workspace_id == workspace_id]
    if status:
        conditions.append(Reminder.status == status)
    if due == "now":
        moment = now_utc()
        conditions.append(
            sa.or_(
                sa.and_(Reminder.snoozed_until.is_not(None), Reminder.snoozed_until <= moment),
                sa.and_(
                    Reminder.snoozed_until.is_(None),
                    Reminder.due_at.is_not(None),
                    Reminder.due_at <= moment,
                ),
            )
        )
    elif due == "today":
        day = today or dt.datetime.now(dt.timezone.utc).date()
        conditions.append(Reminder.due_at.is_not(None))
        conditions.append(Reminder.due_at >= dt.datetime.combine(day, dt.time.min))
        conditions.append(Reminder.due_at <= dt.datetime.combine(day, dt.time.max))
    elif due == "none":
        conditions.append(Reminder.due_at.is_(None))

    total = int(session.scalar(sa.select(sa.func.count()).select_from(Reminder).where(*conditions)) or 0)
    rows = list(
        session.scalars(
            sa.select(Reminder)
            .where(*conditions)
            .order_by(
                sa.case((Reminder.due_at.is_(None), 1), else_=0),
                Reminder.due_at,
                Reminder.title,
                Reminder.id,
            )
            .limit(limit)
            .offset(offset)
        )
    )
    return [serializers.reminder_payload(row) for row in rows], total


def _validate_entity(
    session: Session, workspace_id: str, entity_type: str | None, entity_id: str | None
) -> None:
    """A reminder may point at a row in any module; the pair has to resolve (rule 2)."""
    crud.validate_entity_link(
        session,
        workspace_id,
        entity_type,
        entity_id,
        type_field="entity_type",
        id_field="entity_id",
        label="reminder target",
    )


def create_reminder(
    session: Session,
    workspace_id: str,
    data: dict[str, Any],
    *,
    source: str = Source.USER.value,
) -> dict[str, Any]:
    _validate_entity(session, workspace_id, data.get("entity_type"), data.get("entity_id"))
    reminder = Reminder(
        workspace_id=workspace_id,
        title=str(data["title"]).strip(),
        due_at=data.get("due_at"),
        status=ReminderStatus.PENDING.value,
        entity_type=data.get("entity_type"),
        entity_id=data.get("entity_id"),
        notes=data.get("notes"),
        source=source,
    )
    session.add(reminder)
    session.flush()
    activity.created(
        session,
        workspace_id=workspace_id,
        entity_type="reminder",
        entity_id=reminder.id,
        entity_title=reminder.title,
    )
    return serializers.reminder_payload(reminder)


def update_reminder(
    session: Session, workspace_id: str, reminder_id: str, data: dict[str, Any]
) -> dict[str, Any]:
    reminder = crud.require(
        session, Reminder, reminder_id, workspace_id=workspace_id, label="reminder"
    )
    payload = dict(data)
    if "title" in payload:
        reminder.title = str(payload.pop("title") or "").strip() or reminder.title
    if payload.get("status"):
        status = str(payload.pop("status"))
        _set_status(reminder, status)
    if "entity_type" in payload or "entity_id" in payload:
        _validate_entity(
            session,
            workspace_id,
            payload.get("entity_type", reminder.entity_type),
            payload.get("entity_id", reminder.entity_id),
        )
    for field in _FIELDS:
        if field in payload:
            setattr(reminder, field, payload[field])
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="reminder",
        entity_id=reminder.id,
        entity_title=reminder.title,
    )
    return serializers.reminder_payload(reminder)


def get_reminder(session: Session, workspace_id: str, reminder_id: str) -> dict[str, Any]:
    reminder = crud.require(
        session, Reminder, reminder_id, workspace_id=workspace_id, label="reminder"
    )
    return serializers.reminder_payload(reminder)


def delete_reminder(session: Session, workspace_id: str, reminder_id: str) -> dict[str, Any]:
    reminder = crud.require(
        session, Reminder, reminder_id, workspace_id=workspace_id, label="reminder"
    )
    snapshot = {"id": reminder.id, "title": reminder.title}
    session.delete(reminder)
    session.flush()
    activity.deleted(
        session,
        workspace_id=workspace_id,
        entity_type="reminder",
        entity_id=snapshot["id"],
        entity_title=snapshot["title"],
    )
    return snapshot


def complete_reminder(session: Session, workspace_id: str, reminder_id: str) -> dict[str, Any]:
    reminder = crud.require(
        session, Reminder, reminder_id, workspace_id=workspace_id, label="reminder"
    )
    _set_status(reminder, ReminderStatus.DONE.value)
    session.flush()
    activity.record(
        session,
        workspace_id=workspace_id,
        verb=ActivityVerb.COMPLETED.value,
        entity_type="reminder",
        entity_id=reminder.id,
        entity_title=reminder.title,
    )
    return serializers.reminder_payload(reminder)


def snooze(
    session: Session, workspace_id: str, reminder_id: str, *, minutes: int
) -> dict[str, Any]:
    """``POST /reminders/{id}/snooze`` - ``{ "minutes": 60 }`` from now."""
    reminder = crud.require(
        session, Reminder, reminder_id, workspace_id=workspace_id, label="reminder"
    )
    reminder.snoozed_until = now_utc() + dt.timedelta(minutes=int(minutes))
    if reminder.status == ReminderStatus.DONE.value:
        reminder.status = ReminderStatus.PENDING.value
        reminder.completed_at = None
    session.flush()
    activity.record(
        session,
        workspace_id=workspace_id,
        verb=ActivityVerb.UPDATED.value,
        entity_type="reminder",
        entity_id=reminder.id,
        entity_title=reminder.title,
        summary=activity.summary_for(
            ActivityVerb.UPDATED.value, reminder.title, detail=f"snoozed {minutes} minutes"
        ),
        payload={"minutes": int(minutes), "snoozed_until": reminder.snoozed_until},
    )
    return serializers.reminder_payload(reminder)


def _set_status(reminder: Reminder, status: str) -> None:
    reminder.status = status
    if status == ReminderStatus.DONE.value:
        reminder.completed_at = now_utc()
        reminder.snoozed_until = None
    else:
        reminder.completed_at = None
