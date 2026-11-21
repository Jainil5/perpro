"""Derived notifications: the rule set, the idempotent refresh, read/resolve handling.

API.md response rule 4: ``GET`` requests never create notifications. The rules live
here and run only from ``POST /notifications/refresh`` (UI on dashboard load) and
``python -m app.cli notify``.

Idempotency comes from ``dedupe_key``: every rule has a stable key, a row with that
key is *updated* instead of duplicated, a row whose condition has cleared gets
``resolved_at``, and a row whose condition comes back is reopened. Resolved rows stop
appearing in lists but keep their history.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.utils import now_utc, today_utc
from app.models import Milestone, Notification, Project, Reminder, Task
from app.models.enums import NotificationKind, ProjectStatus, Severity
from app.services import crud, links, serializers
from app.services.stats import OPEN_TASK_STATUSES, aggregates_for_projects

#: how far ahead an upcoming milestone notifies, and the "no activity" bar for a stall
MILESTONE_WINDOW_DAYS = 7
STALLED_WINDOW_DAYS = 7


@dataclass(frozen=True)
class Rule:
    """One derived notification: exactly the fields a refresh writes onto the row."""

    dedupe_key: str
    kind: str
    severity: str
    title: str
    body: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    href: str | None = None


def _naive(value: dt.datetime) -> dt.datetime:
    """SQLite returns naive datetimes; compare everything without a tzinfo."""
    return value.replace(tzinfo=None) if value.tzinfo is not None else value


def _titles(tasks: list[Task], limit: int = 3) -> str:
    listed = ", ".join(f"“{task.title}”" for task in tasks[:limit])
    rest = len(tasks) - min(len(tasks), limit)
    return listed + (f" and {rest} more" if rest > 0 else "")


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}{'' if count == 1 else 's'}"


def derive_rules(
    session: Session, workspace_id: str, *, today: dt.date | None = None
) -> list[Rule]:
    """Every notification the current data justifies, in a stable order."""
    day = today or today_utc()
    end_of_day = dt.datetime.combine(day, dt.time.max)
    rules: list[Rule] = []

    open_tasks = list(
        session.scalars(
            sa.select(Task)
            .where(
                Task.workspace_id == workspace_id,
                Task.status.in_(OPEN_TASK_STATUSES),
                Task.due_date.is_not(None),
            )
            .order_by(Task.due_date, Task.title, Task.id)
        )
    )
    overdue = [task for task in open_tasks if task.due_date and task.due_date < day]
    if overdue:
        rules.append(
            Rule(
                dedupe_key=f"task_overdue:{workspace_id}",
                kind=NotificationKind.TASK_OVERDUE.value,
                severity=Severity.CRITICAL.value,
                title=f"{_plural(len(overdue), 'task')} overdue",
                body=f"Overdue: {_titles(overdue)}",
                entity_type="task",
                href=links.TASKS_OVERDUE,
            )
        )
    due_today = [task for task in open_tasks if task.due_date == day]
    if due_today:
        rules.append(
            Rule(
                dedupe_key=f"task_due:today:{workspace_id}",
                kind=NotificationKind.TASK_DUE.value,
                severity=Severity.WARNING.value,
                title=f"{_plural(len(due_today), 'task')} due today",
                body=f"Due today: {_titles(due_today)}",
                entity_type="task",
                href=links.TASKS_DUE_TODAY,
            )
        )
    tomorrow = day + dt.timedelta(days=1)
    due_tomorrow = [task for task in open_tasks if task.due_date == tomorrow]
    if due_tomorrow:
        rules.append(
            Rule(
                dedupe_key=f"task_due:tomorrow:{workspace_id}",
                kind=NotificationKind.TASK_DUE.value,
                severity=Severity.INFO.value,
                title=f"{_plural(len(due_tomorrow), 'task')} due tomorrow",
                body=f"Due tomorrow: {_titles(due_tomorrow)}",
                entity_type="task",
                href=links.TASKS_DUE_WEEK,
            )
        )

    window_end = day + dt.timedelta(days=MILESTONE_WINDOW_DAYS)
    milestones = list(
        session.scalars(
            sa.select(Milestone)
            .where(
                Milestone.workspace_id == workspace_id,
                Milestone.status == "open",
                Milestone.date >= day,
                Milestone.date <= window_end,
            )
            .order_by(Milestone.date, Milestone.title, Milestone.id)
        )
    )
    for milestone in milestones:
        days = (milestone.date - day).days
        when = "today" if days == 0 else "tomorrow" if days == 1 else f"in {days} days"
        rules.append(
            Rule(
                dedupe_key=f"milestone:{milestone.id}",
                kind=NotificationKind.MILESTONE.value,
                severity=Severity.WARNING.value if days <= 2 else Severity.INFO.value,
                title=f"Milestone “{milestone.title}” is due {when}",
                body=milestone.description,
                entity_type="milestone",
                entity_id=milestone.id,
                href=links.href_for(
                    "milestone", milestone.id, project_id=milestone.project_id
                ),
            )
        )

    reminders = list(
        session.scalars(
            sa.select(Reminder)
            .where(Reminder.workspace_id == workspace_id, Reminder.status == "pending")
            .order_by(Reminder.due_at, Reminder.title, Reminder.id)
        )
    )
    for reminder in reminders:
        deadline = reminder.snoozed_until or reminder.due_at
        if deadline is None or _naive(deadline) > _naive(end_of_day):
            continue
        rules.append(
            Rule(
                dedupe_key=f"reminder:{reminder.id}",
                kind=NotificationKind.REMINDER.value,
                severity=Severity.INFO.value,
                title=f"Reminder “{reminder.title}”",
                body=reminder.notes,
                entity_type="reminder",
                entity_id=reminder.id,
                href=links.NOTIFICATIONS,
            )
        )

    projects = list(
        session.scalars(
            sa.select(Project)
            .where(
                Project.workspace_id == workspace_id,
                Project.status.not_in(tuple(ProjectStatus.terminal())),
            )
            .order_by(Project.name, Project.id)
        )
    )
    aggregates = aggregates_for_projects(
        session, workspace_id, [project.id for project in projects], today=day
    )
    cutoff = dt.datetime.combine(day, dt.time.min) - dt.timedelta(days=STALLED_WINDOW_DAYS)
    for project in projects:
        aggregate = aggregates.get(project.id)
        if aggregate is None or not aggregate.total or aggregate.open == 0:
            continue
        last = aggregate.last_activity
        if last is None or _naive(last) >= _naive(cutoff):
            continue
        quiet_days = (_naive(cutoff) - _naive(last)).days + STALLED_WINDOW_DAYS
        rules.append(
            Rule(
                dedupe_key=f"project_stalled:{project.id}",
                kind=NotificationKind.PROJECT_STALLED.value,
                severity=Severity.WARNING.value,
                title=f"“{project.name}” has had no task activity for {quiet_days} days",
                body=f"{_plural(aggregate.open, 'open task')} still waiting.",
                entity_type="project",
                entity_id=project.id,
                href=links.href_for("project", project.id),
            )
        )
    return rules


def refresh(session: Session, workspace_id: str, *, today: dt.date | None = None) -> dict[str, Any]:
    """Apply :func:`derive_rules` to the table -> ``{created, resolved}``."""
    day = today or today_utc()
    rules = derive_rules(session, workspace_id, today=day)
    wanted = {rule.dedupe_key: rule for rule in rules}
    keys = list(wanted)

    existing: dict[str, Notification] = {}
    if keys:
        rows = session.scalars(
            sa.select(Notification).where(
                Notification.workspace_id == workspace_id, Notification.dedupe_key.in_(keys)
            )
        )
        existing = {row.dedupe_key: row for row in rows}

    created = 0
    for rule in rules:
        row = existing.get(rule.dedupe_key)
        if row is None:
            session.add(
                Notification(
                    workspace_id=workspace_id,
                    kind=rule.kind,
                    severity=rule.severity,
                    title=rule.title,
                    body=rule.body,
                    entity_type=rule.entity_type,
                    entity_id=rule.entity_id,
                    href=rule.href,
                    dedupe_key=rule.dedupe_key,
                )
            )
            created += 1
            continue
        row.kind = rule.kind
        row.severity = rule.severity
        row.title = rule.title
        row.body = rule.body
        row.entity_type = rule.entity_type
        row.entity_id = rule.entity_id
        row.href = rule.href
        if row.resolved_at is not None:  # the condition came back: reopen it
            row.resolved_at = None
            row.read = False
            row.read_at = None

    resolved = 0
    open_rows = session.scalars(
        sa.select(Notification).where(
            Notification.workspace_id == workspace_id, Notification.resolved_at.is_(None)
        )
    )
    for row in open_rows:
        if row.dedupe_key in wanted:
            continue
        row.resolved_at = now_utc()
        resolved += 1
    session.flush()
    return {"created": created, "resolved": resolved}


def list_notifications(
    session: Session,
    workspace_id: str,
    *,
    unread_only: bool = False,
    kind: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """``GET /notifications`` -> ``{items, unread}``: open rows, critical first."""
    conditions = [
        Notification.workspace_id == workspace_id,
        Notification.resolved_at.is_(None),
    ]
    if kind:
        conditions.append(Notification.kind == kind)
    if unread_only:
        conditions.append(Notification.read.is_(False))
    rank = Severity.rank()
    rows = session.scalars(
        sa.select(Notification)
        .where(*conditions)
        .order_by(
            # critical first, then warning, then info; unknown severities last
            sa.case(
                *[
                    (Notification.severity == value, index)
                    for value, index in sorted(rank.items(), key=lambda item: item[1])
                ],
                else_=len(rank),
            ),
            Notification.created_at.desc(),
            Notification.id,
        )
        .limit(limit)
    )
    unread = int(
        session.scalar(
            sa.select(sa.func.count())
            .select_from(Notification)
            .where(
                Notification.workspace_id == workspace_id,
                Notification.resolved_at.is_(None),
                Notification.read.is_(False),
            )
        )
        or 0
    )
    return {"items": [serializers.notification_payload(row) for row in rows], "unread": unread}


def set_read(
    session: Session, workspace_id: str, notification_id: str, *, read: bool
) -> dict[str, Any]:
    """``PATCH /notifications/{id}`` with ``{"read": true|false}``."""
    row = crud.require(
        session, Notification, notification_id, workspace_id=workspace_id, label="notification"
    )
    if bool(row.read) is not bool(read):
        row.read = bool(read)
        row.read_at = now_utc() if read else None
        session.flush()
    return serializers.notification_payload(row)


def mark_all_read(session: Session, workspace_id: str) -> dict[str, Any]:
    """``POST /notifications/read-all`` -> ``{updated: n}``."""
    stamp = now_utc()
    result = session.execute(
        sa.update(Notification)
        .where(
            Notification.workspace_id == workspace_id,
            Notification.read.is_(False),
            Notification.resolved_at.is_(None),
        )
        .values(read=True, read_at=stamp)
    )
    session.flush()
    return {"updated": int(result.rowcount or 0)}


def delete_notification(session: Session, workspace_id: str, notification_id: str) -> dict[str, Any]:
    row = crud.require(
        session, Notification, notification_id, workspace_id=workspace_id, label="notification"
    )
    session.delete(row)
    session.flush()
    return {"deleted": 1}
