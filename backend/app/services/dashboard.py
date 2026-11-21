"""Dashboard assembly and the deterministic Phase 1 insight rules.

``GET /dashboard?today=YYYY-MM-DD`` builds one payload out of the same services the
list endpoints use. ``today`` is injectable so every block and every insight is
testable without touching the clock (API.md).

Insights are rules, not heuristics: the same rows and the same ``today`` always
produce the same list in the same order - overdue cluster(s), stalled projects,
projects past their target date, projects without tasks, milestones inside 7 days,
notes linked to nothing, goals past their target date.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.utils import today_utc
from app.models import ActivityLog, Milestone, Note, NoteRelation, Project, Reminder, Task
from app.models.enums import ProjectStatus, Severity, TaskStatus
from app.services import goals as goals_service
from app.services import links
from app.services import notifications as notifications_service
from app.services import people, serializers, stats as stats_service

# ---------------------------------------------------------------- block sizes
TASKS_PER_BLOCK = 10
ACTIVE_PROJECTS = 6
DEADLINE_WINDOW_DAYS = 14
MILESTONE_WINDOW_DAYS = 7
STALLED_DAYS = 7
RECENT_NOTES = 5
RECENT_ACTIVITY = 8
UNREAD_NOTIFICATIONS = 5
#: most insights a single rule may contribute
INSIGHT_LIMIT_PER_RULE = 3


# ------------------------------------------------------------------- payloads
def _task_payloads(
    session: Session, workspace_id: str, conditions: list[Any], day: dt.date, limit: int
) -> list[dict[str, Any]]:
    rows = session.scalars(
        sa.select(Task)
        .where(*conditions)
        .order_by(
            stats_service.case_priority(),
            Task.due_date.is_(None),
            Task.due_date,
            Task.title,
            Task.id,
        )
        .limit(limit)
    )
    return serializers.task_payloads(list(rows), day)


def _tasks_block(session: Session, workspace_id: str, day: dt.date) -> dict[str, Any]:
    scoped = Task.workspace_id == workspace_id
    open_clause = Task.status.in_(stats_service.OPEN_TASK_STATUSES)
    due_today = _task_payloads(
        session, workspace_id, [scoped, open_clause, Task.due_date == day], day, TASKS_PER_BLOCK
    )
    overdue = _task_payloads(
        session,
        workspace_id,
        [scoped, open_clause, Task.due_date.is_not(None), Task.due_date < day],
        day,
        TASKS_PER_BLOCK,
    )
    upcoming = _task_payloads(
        session,
        workspace_id,
        [
            scoped,
            open_clause,
            Task.due_date.is_not(None),
            Task.due_date > day,
            Task.due_date <= day + dt.timedelta(days=DEADLINE_WINDOW_DAYS),
        ],
        day,
        TASKS_PER_BLOCK,
    )
    week_ago = dt.datetime.combine(day - dt.timedelta(days=6), dt.time.min)
    completed_this_week = int(
        session.scalar(
            sa.select(sa.func.count())
            .select_from(Task)
            .where(
                scoped,
                Task.status == TaskStatus.DONE.value,
                Task.completed_at.is_not(None),
                Task.completed_at >= week_ago,
            )
        )
        or 0
    )
    aggregate = stats_service.workspace_aggregate(session, workspace_id, today=day)
    return {
        "due_today": due_today,
        "overdue": overdue,
        "upcoming": upcoming,
        "completed_this_week": completed_this_week,
        "open": aggregate.open,
    }


def _projects_block(
    session: Session, workspace_id: str, day: dt.date
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[Project]]:
    active_statuses = (
        ProjectStatus.PLANNING.value,
        ProjectStatus.IN_PROGRESS.value,
        ProjectStatus.REVIEW.value,
    )
    projects = list(
        session.scalars(
            sa.select(Project)
            .where(Project.workspace_id == workspace_id)
            .order_by(Project.updated_at.desc(), Project.name, Project.id)
        )
    )
    active = [project for project in projects if project.status in active_statuses]
    payloads = serializers.project_payloads(session, active[:ACTIVE_PROJECTS], workspace_id, day)

    horizon = day + dt.timedelta(days=DEADLINE_WINDOW_DAYS)
    deadline_soon = [
        {
            "id": project.id,
            "name": project.name,
            "target_date": project.target_date,
            "days_left": (project.target_date - day).days,
        }
        for project in projects
        if project.target_date is not None
        and day <= project.target_date <= horizon
        and project.status not in stats_service.TERMINAL_PROJECT_STATUSES
    ]
    deadline_soon.sort(key=lambda row: (row["target_date"], row["name"], row["id"]))
    return payloads, deadline_soon[:ACTIVE_PROJECTS], projects


def _reminders_due(session: Session, workspace_id: str, day: dt.date) -> list[dict[str, Any]]:
    """Pending reminders whose effective deadline (snooze wins) has arrived."""
    end_of_day = dt.datetime.combine(day, dt.time.max)
    rows = session.scalars(
        sa.select(Reminder)
        .where(Reminder.workspace_id == workspace_id, Reminder.status == "pending")
        .order_by(Reminder.due_at, Reminder.title, Reminder.id)
    )
    due = [
        serializers.reminder_payload(reminder)
        for reminder in rows
        if (reminder.snoozed_until or reminder.due_at) is not None
        and _strip_tz(reminder.snoozed_until or reminder.due_at) <= _strip_tz(end_of_day)
    ]
    return due[:TASKS_PER_BLOCK]


def _strip_tz(value: dt.datetime | None) -> dt.datetime | None:
    return value.replace(tzinfo=None) if value is not None and value.tzinfo else value


def dashboard_payload(
    session: Session, workspace_id: str, *, today: dt.date | None = None
) -> dict[str, Any]:
    """The ``GET /dashboard`` body, shaped exactly as API.md documents it."""
    day = today or today_utc()
    tasks = _tasks_block(session, workspace_id, day)
    active_projects, deadline_soon, all_projects = _projects_block(session, workspace_id, day)

    notes = list(
        session.scalars(
            sa.select(Note)
            .where(Note.workspace_id == workspace_id)
            .order_by(Note.updated_at.desc(), Note.title, Note.id)
            .limit(RECENT_NOTES)
        )
    )
    milestones = list(
        session.scalars(
            sa.select(Milestone)
            .where(
                Milestone.workspace_id == workspace_id,
                Milestone.status == "open",
                Milestone.date >= day,
                Milestone.date <= day + dt.timedelta(days=MILESTONE_WINDOW_DAYS),
            )
            .order_by(Milestone.date, Milestone.title, Milestone.id)
            .limit(TASKS_PER_BLOCK)
        )
    )
    panel = notifications_service.list_notifications(
        session, workspace_id, unread_only=True, limit=UNREAD_NOTIFICATIONS
    )
    recent_activity = list(
        session.scalars(
            sa.select(ActivityLog)
            .where(ActivityLog.workspace_id == workspace_id)
            .order_by(ActivityLog.created_at.desc(), ActivityLog.id)
            .limit(RECENT_ACTIVITY)
        )
    )
    return {
        "today": day,
        "tasks": tasks,
        "projects": {"active": active_projects, "deadline_soon": deadline_soon},
        "people": {"new_contacts_30d": people.new_contacts_in_window(session, workspace_id, day)},
        "notes": {"recent": [serializers.note_summary_payload(session, note) for note in notes]},
        "milestones": {
            "upcoming": [serializers.milestone_payload(milestone, day) for milestone in milestones]
        },
        "reminders": {"due": _reminders_due(session, workspace_id, day)},
        "notifications": {"unread": panel["unread"], "items": panel["items"]},
        "activity": [serializers.activity_payload(row) for row in recent_activity],
        "insights": build_insights(
            session,
            workspace_id,
            today=day,
            projects=all_projects,
            overdue_tasks=tasks["overdue"],
        ),
    }


# -------------------------------------------------------------------- insights


def _insight(
    kind: str,
    severity: str,
    text: str,
    *,
    href: str | None = None,
    entity_id: str | None = None,
) -> dict[str, Any]:
    return {"kind": kind, "severity": severity, "text": text, "href": href, "entity_id": entity_id}


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}{'' if count == 1 else 's'}"


def overdue_insights(overdue: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One workspace total, then the biggest project clusters."""
    if not overdue:
        return []
    insights = [
        _insight(
            "overdue",
            Severity.CRITICAL.value,
            f"{_plural(len(overdue), 'task')} are overdue",
            href=links.TASKS_OVERDUE,
        )
    ]
    clusters: dict[str, int] = {}
    for task in overdue:
        name = (task.get("project") or {}).get("name") or "No project"
        clusters[name] = clusters.get(name, 0) + 1
    ranked = sorted(clusters.items(), key=lambda row: (-row[1], row[0]))
    for name, count in ranked[: max(INSIGHT_LIMIT_PER_RULE - 1, 1)]:
        insights.append(
            _insight(
                "overdue_cluster",
                Severity.CRITICAL.value,
                f"{_plural(count, 'task')} overdue in “{name}”",
                href=links.TASKS_OVERDUE,
            )
        )
    return insights


def _project_buckets(
    session: Session,
    workspace_id: str,
    projects: list[Project],
    day: dt.date,
) -> tuple[list[tuple[Project, int]], list[Project], list[Project]]:
    """``(stalled, past_target, empty)`` for the non-terminal projects."""
    aggregates = stats_service.aggregates_for_projects(
        session, workspace_id, [project.id for project in projects], today=day
    )
    cutoff = dt.datetime.combine(day, dt.time.min) - dt.timedelta(days=STALLED_DAYS)
    stalled: list[tuple[Project, int]] = []
    past_target: list[Project] = []
    empty: list[Project] = []
    for project in projects:
        aggregate = aggregates.get(project.id) or stats_service.Aggregate()
        terminal = project.status in stats_service.TERMINAL_PROJECT_STATUSES
        if terminal:
            continue
        if not aggregate.total:
            empty.append(project)
        elif aggregate.open:
            last = aggregate.last_activity
            if last is not None and _strip_tz(last) < _strip_tz(cutoff):
                quiet_days = (_strip_tz(cutoff) - _strip_tz(last)).days + STALLED_DAYS
                stalled.append((project, quiet_days))
        if project.target_date is not None and project.target_date < day:
            past_target.append(project)
    return stalled, past_target, empty


def _unlinked_notes(session: Session, workspace_id: str, limit: int) -> list[Note]:
    """Notes with no project, no outgoing relation and no backlink."""
    outgoing = (
        sa.select(sa.literal(1))
        .where(NoteRelation.note_id == Note.id)
        .correlate(Note)
        .exists()
    )
    incoming = (
        sa.select(sa.literal(1))
        .where(NoteRelation.target_type == "note", NoteRelation.target_id == Note.id)
        .correlate(Note)
        .exists()
    )
    rows = session.scalars(
        sa.select(Note)
        .where(
            Note.workspace_id == workspace_id,
            Note.project_id.is_(None),
            sa.not_(outgoing),
            sa.not_(incoming),
        )
        .order_by(Note.updated_at.desc(), Note.title, Note.id)
        .limit(limit)
    )
    return list(rows)


def build_insights(
    session: Session,
    workspace_id: str,
    *,
    today: dt.date | None = None,
    projects: list[Project] | None = None,
    overdue_tasks: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """The rule-based insight list - deterministic, unit-tested."""
    day = today or today_utc()
    if overdue_tasks is None:
        overdue_tasks = _task_payloads(
            session,
            workspace_id,
            [
                Task.workspace_id == workspace_id,
                Task.status.in_(stats_service.OPEN_TASK_STATUSES),
                Task.due_date.is_not(None),
                Task.due_date < day,
            ],
            day,
            500,
        )
    insights = overdue_insights(overdue_tasks)

    rows = projects
    if rows is None:
        rows = list(
            session.scalars(
                sa.select(Project)
                .where(Project.workspace_id == workspace_id)
                .order_by(Project.name, Project.id)
            )
        )
    stalled, past_target, empty = _project_buckets(session, workspace_id, rows, day)

    for project, quiet_days in sorted(
        stalled, key=lambda row: (-row[1], row[0].name, row[0].id)
    )[:INSIGHT_LIMIT_PER_RULE]:
        insights.append(
            _insight(
                "project_stalled",
                Severity.WARNING.value,
                f"“{project.name}” has had no task activity for {quiet_days} days",
                href=links.href_for("project", project.id),
                entity_id=project.id,
            )
        )
    for project in sorted(
        past_target, key=lambda item: (item.target_date, item.name, item.id)
    )[:INSIGHT_LIMIT_PER_RULE]:
        days = (day - project.target_date).days
        insights.append(
            _insight(
                "past_target",
                Severity.WARNING.value,
                f"“{project.name}” is {_plural(days, 'day')} past its target date",
                href=links.href_for("project", project.id),
                entity_id=project.id,
            )
        )
    for project in sorted(empty, key=lambda item: (item.name, item.id))[:INSIGHT_LIMIT_PER_RULE]:
        insights.append(
            _insight(
                "empty_project",
                Severity.INFO.value,
                f"“{project.name}” has no tasks yet",
                href=links.href_for("project", project.id),
                entity_id=project.id,
            )
        )

    milestones = list(
        session.scalars(
            sa.select(Milestone)
            .where(
                Milestone.workspace_id == workspace_id,
                Milestone.status == "open",
                Milestone.date >= day,
                Milestone.date <= day + dt.timedelta(days=MILESTONE_WINDOW_DAYS),
            )
            .order_by(Milestone.date, Milestone.title, Milestone.id)
            .limit(INSIGHT_LIMIT_PER_RULE)
        )
    )
    for milestone in milestones:
        days = (milestone.date - day).days
        when = "today" if days == 0 else "tomorrow" if days == 1 else f"in {days} days"
        insights.append(
            _insight(
                "milestone",
                Severity.INFO.value,
                f"Milestone “{milestone.title}” is due {when}",
                href=links.href_for(
                    "milestone", milestone.id, project_id=milestone.project_id
                ),
                entity_id=milestone.id,
            )
        )

    for note in _unlinked_notes(session, workspace_id, INSIGHT_LIMIT_PER_RULE):
        insights.append(
            _insight(
                "unlinked_note",
                Severity.INFO.value,
                f"Note “{note.title}” is linked to nothing",
                href=links.href_for("note", note.id),
                entity_id=note.id,
            )
        )

    overdue_goals = goals_service.past_deadline_goals(session, workspace_id, day)
    for goal, days in sorted(
        overdue_goals, key=lambda row: (-row[1], row[0].title, row[0].id)
    )[:INSIGHT_LIMIT_PER_RULE]:
        insights.append(
            _insight(
                "goal_past_due",
                Severity.WARNING.value,
                f"Goal “{goal.title}” is {_plural(days, 'day')} past its target ({goal.progress}% done)",
                href=links.href_for("goal", goal.id),
                entity_id=goal.id,
            )
        )
    return insights
