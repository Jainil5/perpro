"""ORM row -> API payload.

Routers must not hand out SQLAlchemy objects: the derived fields API.md promises
(``progress``, ``task_counts``, ``next_due``, ``is_overdue``, ``days_away``,
``word_count``, ``excerpt``, ``relations[].target_title``, ``backlinks``) are computed
here, in Python, from the services. Everything is returned as a plain ``dict`` so the
same function can serve a single object, a list, an export and the demo seeder.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterable, Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.utils import excerpt as make_excerpt
from app.core.utils import today_utc, word_count
from app.models import (
    ActivityLog,
    Company,
    Contact,
    Goal,
    Milestone,
    Note,
    NoteRelation,
    Notification,
    Project,
    Reminder,
    Task,
)
from app.services import stats as stats_service
from app.services.stats import Aggregate

#: target_type -> (model, title column) for note relations and reminders
TITLE_MODELS: dict[str, tuple[type, str]] = {
    "task": (Task, "title"),
    "note": (Note, "title"),
    "project": (Project, "name"),
    "milestone": (Milestone, "title"),
    "contact": (Contact, "name"),
    "company": (Company, "name"),
    "goal": (Goal, "title"),
}


def title_for(session: Session, target_type: str | None, target_id: str | None) -> str | None:
    """Best-effort display title of a polymorphic reference (``None`` if it is gone)."""
    if not target_type or not target_id:
        return None
    entry = TITLE_MODELS.get(target_type)
    if entry is None:
        return None
    model, column = entry
    return session.scalar(sa.select(getattr(model, column)).where(model.id == target_id))


def resolve_today(today: dt.date | None = None) -> dt.date:
    return today or today_utc()


# --------------------------------------------------------------------------- tasks


def task_payload(task: Task, today: dt.date | None = None) -> dict[str, Any]:
    day = resolve_today(today)
    project = task.project
    return {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "notes": task.notes,
        "project_id": task.project_id,
        "project": (
            {"id": project.id, "name": project.name, "status": project.status} if project else None
        ),
        "parent_task_id": task.parent_task_id,
        "status": task.status,
        "priority": task.priority,
        "due_date": task.due_date,
        "start_date": task.start_date,
        "estimated_minutes": task.estimated_minutes,
        "actual_minutes": task.actual_minutes,
        "recurrence": task.recurrence,
        "tags": [tag.name for tag in task.tags],
        "position": task.position,
        "completed_at": task.completed_at,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "is_overdue": stats_service.is_overdue(task.due_date, task.status, day),
        "is_due_today": stats_service.is_due_today(task.due_date, task.status, day),
    }


def task_payloads(tasks: Sequence[Task], today: dt.date | None = None) -> list[dict[str, Any]]:
    return [task_payload(task, today) for task in tasks]


# ------------------------------------------------------------------------ projects


def project_payload(
    project: Project,
    aggregate: Aggregate,
    today: dt.date | None = None,
) -> dict[str, Any]:
    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "category": project.category,
        "status": project.status,
        "priority": project.priority,
        "start_date": project.start_date,
        "target_date": project.target_date,
        "repository_url": project.repository_url,
        "documentation_url": project.documentation_url,
        "next_action": project.next_action,
        "manual_progress": project.manual_progress,
        "progress": stats_service.progress_for(
            project.status, aggregate, project.manual_progress
        ),
        "task_counts": aggregate.task_counts,
        "next_due": (
            {"title": aggregate.next_due.title, "due_date": aggregate.next_due.due_date}
            if aggregate.next_due
            else None
        ),
        "milestone_count": aggregate.milestone_count,
        "milestones_done": aggregate.milestones_done,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
    }


def project_payloads(
    session: Session,
    projects: Sequence[Project],
    workspace_id: str,
    today: dt.date | None = None,
) -> list[dict[str, Any]]:
    """Batch variant: one aggregate query for the whole page (no N+1)."""
    day = resolve_today(today)
    aggregates = stats_service.aggregates_for_projects(
        session, workspace_id, [project.id for project in projects], today=day
    )
    return [project_payload(project, aggregates.get(project.id, Aggregate()), day) for project in projects]


def project_payload_one(
    session: Session, project: Project, today: dt.date | None = None
) -> dict[str, Any]:
    day = resolve_today(today)
    aggregates = stats_service.aggregates_for_projects(
        session, project.workspace_id, [project.id], today=day
    )
    return project_payload(project, aggregates.get(project.id, Aggregate()), day)


# --------------------------------------------------------------------- milestones


def milestone_payload(milestone: Milestone, today: dt.date | None = None) -> dict[str, Any]:
    day = resolve_today(today)
    return {
        "id": milestone.id,
        "project_id": milestone.project_id,
        "title": milestone.title,
        "description": milestone.description,
        "date": milestone.date,
        "status": milestone.status,
        "completed_at": milestone.completed_at,
        "days_away": (milestone.date - day).days,
        "created_at": milestone.created_at,
        "updated_at": milestone.updated_at,
    }


# -------------------------------------------------------------------------- notes


def relation_payloads(session: Session, note: Note) -> list[dict[str, Any]]:
    """The note's links, minus any whose target row has since been deleted.

    ``target_type``/``target_id`` are polymorphic, so no foreign key can cascade them
    when the target goes; the API drops those rows rather than returning a link with
    no title to show. The stored row stays in ``GET /export`` (a true backup).
    """
    payloads: list[dict[str, Any]] = []
    for relation in sorted(
        note.relations, key=lambda item: (item.target_type, item.created_at)
    ):
        title = title_for(session, relation.target_type, relation.target_id)
        if title is None:
            continue
        payloads.append(
            {
                "id": relation.id,
                "target_type": relation.target_type,
                "target_id": relation.target_id,
                "target_title": title,
                "label": relation.label,
            }
        )
    return payloads


def _backlink_payloads(session: Session, note: Note) -> list[dict[str, Any]]:
    rows = session.execute(
        sa.select(NoteRelation.note_id, Note.title)
        .join(Note, Note.id == NoteRelation.note_id)
        .where(NoteRelation.target_type == "note", NoteRelation.target_id == note.id)
        .order_by(Note.title)
    ).all()
    return [{"note_id": note_id, "note_title": title} for note_id, title in rows]


def _note_common(session: Session, note: Note) -> dict[str, Any]:
    return {
        "id": note.id,
        "title": note.title,
        "category": note.category,
        "tags": [tag.name for tag in note.tags],
        "is_favorite": note.is_favorite,
        "project_id": note.project_id,
        "word_count": word_count(note.content) or note.word_count,
        "relations": relation_payloads(session, note),
        "backlinks": _backlink_payloads(session, note),
        "created_at": note.created_at,
        "updated_at": note.updated_at,
    }


def note_payload(session: Session, note: Note) -> dict[str, Any]:
    payload = _note_common(session, note)
    payload["content"] = note.content
    return payload


def note_summary_payload(session: Session, note: Note) -> dict[str, Any]:
    payload = _note_common(session, note)
    payload["excerpt"] = make_excerpt(note.content)
    return payload


# ------------------------------------------------------------------------ people


def contact_payload(contact: Contact) -> dict[str, Any]:
    return {
        "id": contact.id,
        "name": contact.name,
        "email": contact.email,
        "phone": contact.phone,
        "title": contact.title,
        "company_id": contact.company_id,
        "company": contact.company.name if contact.company else None,
        "location": contact.location,
        "kind": contact.kind,
        "tags": [tag.name for tag in contact.tags],
        "notes": contact.notes,
        "created_at": contact.created_at,
        "updated_at": contact.updated_at,
    }


def company_payload(company: Company, contact_count: int | None = None) -> dict[str, Any]:
    if contact_count is None:
        contact_count = len(company.contacts)
    return {
        "id": company.id,
        "name": company.name,
        "website": company.website,
        "industry": company.industry,
        "location": company.location,
        "notes": company.notes,
        "contact_count": contact_count,
        "created_at": company.created_at,
        "updated_at": company.updated_at,
    }


def company_payloads(session: Session, companies: Sequence[Company]) -> list[dict[str, Any]]:
    """``contact_count`` from one grouped query instead of a lazy load per row."""
    if not companies:
        return []
    counts = dict(
        session.execute(
            sa.select(Contact.company_id, sa.func.count())
            .where(Contact.company_id.in_([company.id for company in companies]))
            .group_by(Contact.company_id)
        ).all()
    )
    return [company_payload(company, int(counts.get(company.id, 0))) for company in companies]


# ------------------------------------------------------------------- notifications


def notification_payload(notification: Notification) -> dict[str, Any]:
    return {
        "id": notification.id,
        "kind": notification.kind,
        "severity": notification.severity,
        "title": notification.title,
        "body": notification.body,
        "entity_type": notification.entity_type,
        "entity_id": notification.entity_id,
        "href": notification.href,
        "read": notification.read,
        "read_at": notification.read_at,
        "dedupe_key": notification.dedupe_key,
        "created_at": notification.created_at,
        "updated_at": notification.updated_at,
    }


def reminder_payload(reminder: Reminder) -> dict[str, Any]:
    return {
        "id": reminder.id,
        "title": reminder.title,
        "due_at": reminder.due_at,
        "status": reminder.status,
        "entity_type": reminder.entity_type,
        "entity_id": reminder.entity_id,
        "notes": reminder.notes,
        "snoozed_until": reminder.snoozed_until,
        "created_at": reminder.created_at,
        "updated_at": reminder.updated_at,
    }


def activity_payload(activity: ActivityLog) -> dict[str, Any]:
    return {
        "id": activity.id,
        "verb": activity.verb,
        "entity_type": activity.entity_type,
        "entity_id": activity.entity_id,
        "entity_title": activity.entity_title,
        "summary": activity.summary,
        "project_id": activity.project_id,
        "href": activity.href,
        "actor": activity.actor,
        "created_at": activity.created_at,
    }


def goal_payload(goal: Goal) -> dict[str, Any]:
    project = goal.project
    return {
        "id": goal.id,
        "title": goal.title,
        "description": goal.description,
        "project_id": goal.project_id,
        "project": (
            {"id": project.id, "name": project.name, "status": project.status} if project else None
        ),
        "category": goal.category,
        "priority": goal.priority,
        "status": goal.status,
        "progress": goal.progress,
        "target_date": goal.target_date,
        "completed_at": goal.completed_at,
        "created_at": goal.created_at,
        "updated_at": goal.updated_at,
    }


def page_payload(
    items: list[dict[str, Any]], total: int, *, limit: int | None = None, offset: int | None = None
) -> dict[str, Any]:
    """The list envelope, plus ``limit``/``offset`` echo when the caller passed them."""
    payload: dict[str, Any] = {"items": items, "total": total}
    if limit is not None:
        payload["limit"] = limit
    if offset is not None:
        payload["offset"] = offset
    return payload


def category_breakdown(counts: Iterable[tuple[str, int]]) -> list[dict[str, Any]]:
    return [{"category": category, "count": int(count)} for category, count in counts]
