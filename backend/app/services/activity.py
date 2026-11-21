"""Activity recording - called by every mutating endpoint (ARCHITECTURE.md rule).

One row per write, in the same transaction as the change, with the ``verb`` from
API.md, a human ``summary`` and the ``href`` the UI links to.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.utils import today_utc
from app.models import ActivityLog
from app.models.enums import ActivityVerb
from app.services import links, serializers


_SUMMARY_TEMPLATES: dict[str, str] = {
    ActivityVerb.CREATED: "Created “{title}”",
    ActivityVerb.UPDATED: "Updated “{title}”",
    ActivityVerb.COMPLETED: "Completed “{title}”",
    ActivityVerb.REOPENED: "Reopened “{title}”",
    ActivityVerb.DELETED: "Deleted “{title}”",
    ActivityVerb.MOVED: "Moved “{title}”",
    ActivityVerb.COMMENTED: "Commented on “{title}”",
}


def summary_for(verb: str, title: str | None, *, detail: str | None = None) -> str:
    label = title or "item"
    template = _SUMMARY_TEMPLATES.get(verb, "{title}")
    text = template.format(title=label)
    return f"{text} {detail}" if detail else text


def record(
    session: Session,
    *,
    workspace_id: str,
    verb: str,
    entity_type: str,
    entity_id: str | None = None,
    entity_title: str | None = None,
    project_id: str | None = None,
    summary: str | None = None,
    href: str | None = None,
    payload: dict[str, Any] | None = None,
    actor: str = "owner",
) -> ActivityLog:
    """Append one activity row (never commits - the request unit of work does)."""
    if href is None:
        href = links.href_for(entity_type, entity_id, project_id=project_id)
    activity = ActivityLog(
        workspace_id=workspace_id,
        verb=verb,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_title=entity_title,
        project_id=project_id,
        summary=summary if summary is not None else summary_for(verb, entity_title),
        href=href,
        actor=actor,
        payload=payload or {},
    )
    session.add(activity)
    session.flush()
    return activity


def created(session: Session, **kwargs: Any) -> ActivityLog:
    return record(session, verb=ActivityVerb.CREATED.value, **kwargs)


def updated(session: Session, **kwargs: Any) -> ActivityLog:
    return record(session, verb=ActivityVerb.UPDATED.value, **kwargs)


def deleted(session: Session, **kwargs: Any) -> ActivityLog:
    return record(session, verb=ActivityVerb.DELETED.value, **kwargs)


def list_activity(
    session: Session,
    workspace_id: str,
    *,
    entity_type: str | None = None,
    project_id: str | None = None,
    verb: str | None = None,
    days: int | None = 7,
    limit: int = 100,
    offset: int = 0,
    today: dt.date | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """``GET /activity`` - newest first, optionally clipped to the last ``days`` days.

    ``days=0`` (or ``None``) means "no time window", which the UI uses for the
    full-history view.
    """
    conditions: list[Any] = [ActivityLog.workspace_id == workspace_id]
    if entity_type:
        conditions.append(ActivityLog.entity_type == entity_type)
    if project_id:
        conditions.append(ActivityLog.project_id == project_id)
    if verb:
        conditions.append(ActivityLog.verb == verb)
    if days:
        day = today or today_utc()
        floor = dt.datetime.combine(day - dt.timedelta(days=int(days) - 1), dt.time.min)
        conditions.append(ActivityLog.created_at >= _as_naive(floor))
    total = int(
        session.scalar(sa.select(sa.func.count()).select_from(ActivityLog).where(*conditions)) or 0
    )
    rows = session.scalars(
        sa.select(ActivityLog)
        .where(*conditions)
        .order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())
        .limit(limit)
        .offset(offset)
    )
    return [serializers.activity_payload(row) for row in rows], total


def _as_naive(value: dt.datetime) -> dt.datetime:
    """SQLite stores what it is given: compare naive-to-naive like the models do."""
    return value.replace(tzinfo=None) if value.tzinfo is not None else value
