"""Factories shared by the test modules.

Rows are created through the services (never by inserting model objects straight into
the database) so the tests exercise the same code the API calls.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.utils import new_id, now_utc, today_utc
from app.models import Milestone, Project, Reminder, Task, Workspace
from app.services import goals as goals_service
from app.services import milestones as milestones_service
from app.services import notes as notes_service
from app.services import people as people_service
from app.services import projects as projects_service
from app.services import reminders as reminders_service
from app.services import tasks as tasks_service


def clock_day(offset_days: int = 0) -> dt.date:
    """A date measured from the app's own clock rather than from a literal.

    The routes without a ``?today=`` override - ``POST /tasks``, ``GET /tasks/{id}``,
    ``POST /milestones``, ``GET /projects/{id}`` and the CLI - derive ``is_overdue``,
    ``next_due`` and ``days_away`` from ``today_utc()``.  A fixture dated against a
    hard-coded "reference today" only works until the calendar moves, so those tests
    place their rows relative to the day the server will actually use.
    """
    return today_utc() + dt.timedelta(days=offset_days)


def clock_iso(offset_days: int = 0) -> str:
    """``clock_day`` in the format the API speaks."""
    return clock_day(offset_days).isoformat()


def other_workspace(session: Session, slug: str = "elsewhere") -> str:
    """A second workspace id, for the cross-tenant rules (409 / scoping)."""
    workspace = Workspace(name="Elsewhere", slug=slug)
    session.add(workspace)
    session.flush()
    return workspace.id


def make_project(session: Session, workspace_id: str, name: str, **fields: Any) -> dict[str, Any]:
    """``create_project`` takes ownership of the dict it is handed, so pass a copy."""
    return projects_service.create_project(session, workspace_id, {"name": name, **fields})


def make_task(session: Session, workspace_id: str, title: str, **fields: Any) -> dict[str, Any]:
    return tasks_service.create_task(session, workspace_id, {"title": title, **fields})


def make_milestone(
    session: Session, workspace_id: str, project_id: str, title: str, **fields: Any
) -> dict[str, Any]:
    return milestones_service.create_milestone(
        session, workspace_id, {"project_id": project_id, "title": title, **fields}
    )


def make_note(session: Session, workspace_id: str, title: str, **fields: Any) -> dict[str, Any]:
    return notes_service.create_note(session, workspace_id, {"title": title, **fields})


def make_reminder(
    session: Session, workspace_id: str, title: str, due_at: Any, **fields: Any
) -> dict[str, Any]:
    return reminders_service.create_reminder(
        session, workspace_id, {"title": title, "due_at": due_at, **fields}
    )


def make_goal(session: Session, workspace_id: str, title: str, **fields: Any) -> dict[str, Any]:
    return goals_service.create_goal(session, workspace_id, {"title": title, **fields})


def make_contact(session: Session, workspace_id: str, name: str, **fields: Any) -> dict[str, Any]:
    return people_service.create_contact(session, workspace_id, {"name": name, **fields})


def make_company(
    session: Session, workspace_id: str, name: str, **fields: Any
) -> dict[str, Any]:
    return people_service.create_company(session, workspace_id, {"name": name, **fields})


def backdate_task(session: Session, task_id: str, when: dt.datetime) -> None:
    """Move ``updated_at`` into the past; a Core update skips the ORM ``onupdate``."""
    session.execute(sa.update(Task).where(Task.id == task_id).values(updated_at=when))
    session.flush()


def backdate_completion(session: Session, task_id: str, when: dt.datetime) -> None:
    """Move ``completed_at`` (and the touch stamp) into the past."""
    session.execute(
        sa.update(Task).where(Task.id == task_id).values(completed_at=when, updated_at=when)
    )
    session.flush()


def backdate_created(session: Session, model, row_id: str, when: dt.datetime) -> None:
    """Move ``created_at`` (and the touch stamp) to a chosen moment.

    Window rules such as ``people.new_contacts_in_window`` count rows by their stamp,
    which the services take from the real clock - pin the stamp and the rule becomes a
    date the test chose instead of the day the suite happens to run on.
    """
    session.execute(
        sa.update(model).where(model.id == row_id).values(created_at=when, updated_at=when)
    )
    session.flush()


def set_snooze(session: Session, reminder_id: str, when: dt.datetime) -> None:
    """Force ``snoozed_until`` without waiting for the real clock."""
    session.execute(sa.update(Reminder).where(Reminder.id == reminder_id).values(snoozed_until=when))
    session.flush()


def task_row(
    title: str = "Task",
    *,
    status: str = "todo",
    priority: str = "medium",
    due: dt.date | None = None,
    recurrence: str = "none",
    updated: dt.datetime | None = None,
) -> Task:
    """A *transient* Task: enough for the pure functions in :mod:`app.services.stats`."""
    stamp = updated or now_utc()
    return Task(
        id=new_id(),
        workspace_id="workspace-test",
        title=title,
        status=status,
        priority=priority,
        due_date=due,
        recurrence=recurrence,
        position=0,
        created_at=stamp,
        updated_at=stamp,
    )


def milestone_row(
    title: str = "Milestone",
    *,
    when: dt.date | None = None,
    status: str = "open",
) -> Milestone:
    return Milestone(
        id=new_id(),
        workspace_id="workspace-test",
        project_id=None,
        title=title,
        date=when or dt.date(2026, 1, 1),
        status=status,
    )


def project_row(status: str = "in_progress", manual_progress: int = 0) -> Project:
    return Project(
        id=new_id(),
        workspace_id="workspace-test",
        name="Project",
        slug="project",
        status=status,
        priority="medium",
        manual_progress=manual_progress,
    )
