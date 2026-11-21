"""Project/task counters and the progress rule.

Everything derived from tasks (progress, counts, overdue, due today, next due,
"stalled") is computed here so the rule from API.md exists in exactly one place and
can be unit-tested with an injectable ``today``. Money/percent maths is Python-side,
never SQL string manipulation (ARCHITECTURE.md conventions).
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.utils import today_utc
from app.models import Milestone, Task
from app.models.enums import Priority, ProjectStatus, TaskStatus

OPEN_TASK_STATUSES: tuple[str, ...] = tuple(TaskStatus.open_values())
DONE_STATUS = TaskStatus.DONE.value
TERMINAL_PROJECT_STATUSES = ProjectStatus.terminal()


@dataclass(frozen=True)
class NextDue:
    title: str
    due_date: dt.date


@dataclass
class Aggregate:
    """Task + milestone counters for one project (or for the whole workspace)."""

    total: int = 0
    done: int = 0
    open: int = 0
    overdue: int = 0
    due_today: int = 0
    by_status: dict[str, int] = field(default_factory=dict)
    by_priority: dict[str, int] = field(default_factory=dict)
    next_due: NextDue | None = None
    last_activity: dt.datetime | None = None
    milestone_count: int = 0
    milestones_done: int = 0

    @property
    def task_counts(self) -> dict[str, int]:
        return {
            "total": self.total,
            "done": self.done,
            "open": self.open,
            "overdue": self.overdue,
        }

    @property
    def pct(self) -> int:
        """``round(done / total * 100)`` - half-up, matching ``Math.round`` in the UI."""
        if not self.total:
            return 0
        return (200 * self.done + self.total) // (2 * self.total)


def progress_for(
    status: str,
    aggregate: Aggregate,
    manual_progress: int = 0,
) -> int:
    """The API.md rule, verbatim.

    ``completed``/``archived`` => 100; else if the project has tasks =>
    ``round(done / total * 100)``; else ``manual_progress``.
    """
    if status in TERMINAL_PROJECT_STATUSES:
        return 100
    if aggregate.total:
        return aggregate.pct
    return int(manual_progress or 0)


def is_overdue(due_date: dt.date | None, status: str, today: dt.date) -> bool:
    """Open and ``due_date < today``."""
    return due_date is not None and status in OPEN_TASK_STATUSES and due_date < today


def is_due_today(due_date: dt.date | None, status: str, today: dt.date) -> bool:
    """Open and ``due_date == today``."""
    return due_date is not None and status in OPEN_TASK_STATUSES and due_date == today


def build_aggregate(
    tasks: Sequence[Task],
    milestones: Sequence[Milestone] = (),
    *,
    today: dt.date | None = None,
) -> Aggregate:
    """Pure function over already-loaded rows - the unit-test entry point."""
    day = today or today_utc()
    by_status: dict[str, int] = {}
    by_priority: dict[str, int] = {}
    total = done = open_count = overdue = due_today = 0
    last_activity: dt.datetime | None = None
    next_candidates: list[Task] = []

    for task in tasks:
        total += 1
        by_status[task.status] = by_status.get(task.status, 0) + 1
        by_priority[task.priority] = by_priority.get(task.priority, 0) + 1
        if task.status == DONE_STATUS:
            done += 1
        if task.status in OPEN_TASK_STATUSES:
            open_count += 1
            if task.due_date is not None:
                if task.due_date < day:
                    overdue += 1
                elif task.due_date == day:
                    due_today += 1
                else:
                    next_candidates.append(task)
        stamp = task.updated_at
        if stamp is not None and (last_activity is None or stamp > last_activity):
            last_activity = stamp

    next_due: NextDue | None = None
    if next_candidates:
        nearest = min(next_candidates, key=lambda item: (item.due_date, item.title))
        if nearest.due_date is not None:
            next_due = NextDue(title=nearest.title, due_date=nearest.due_date)

    milestones_done = sum(1 for milestone in milestones if milestone.status == "done")
    return Aggregate(
        total=total,
        done=done,
        open=open_count,
        overdue=overdue,
        due_today=due_today,
        by_status=by_status,
        by_priority=by_priority,
        next_due=next_due,
        last_activity=last_activity,
        milestone_count=len(list(milestones)),
        milestones_done=milestones_done,
    )


def aggregates_for_projects(
    session: Session,
    workspace_id: str,
    project_ids: Sequence[str],
    *,
    today: dt.date | None = None,
) -> dict[str, Aggregate]:
    """One pass over tasks/milestones for a batch of projects (no N+1 in list views)."""
    day = today or today_utc()
    ids = list(project_ids)
    if not ids:
        return {}
    tasks = list(
        session.scalars(sa.select(Task).where(Task.project_id.in_(ids), Task.workspace_id == workspace_id))
    )
    milestones = list(
        session.scalars(
            sa.select(Milestone).where(Milestone.project_id.in_(ids), Milestone.workspace_id == workspace_id)
        )
    )
    grouped: dict[str, list[Task]] = {project_id: [] for project_id in ids}
    grouped_milestones: dict[str, list[Milestone]] = {project_id: [] for project_id in ids}
    for task in tasks:
        if task.project_id in grouped:
            grouped[task.project_id].append(task)
    for milestone in milestones:
        if milestone.project_id in grouped_milestones:
            grouped_milestones[milestone.project_id].append(milestone)
    return {
        project_id: build_aggregate(grouped[project_id], grouped_milestones[project_id], today=day)
        for project_id in ids
    }


def workspace_aggregate(
    session: Session,
    workspace_id: str,
    *,
    today: dt.date | None = None,
    project_ids: Iterable[str] | None = None,
) -> Aggregate:
    """Aggregate across every task in the workspace (``/meta`` counts, dashboard)."""
    day = today or today_utc()
    statement = sa.select(Task).where(Task.workspace_id == workspace_id)
    if project_ids is not None:
        statement = statement.where(Task.project_id.in_(list(project_ids)))
    tasks = list(session.scalars(statement))
    return build_aggregate(tasks, today=day)


def task_stats_row(aggregate: Aggregate) -> dict:
    """``GET /projects/{id}/stats`` payload (``pct`` follows the progress rule for
    a project that has tasks; a project without tasks reports 0 here)."""
    return {
        "total": aggregate.total,
        "done": aggregate.done,
        "open": aggregate.open,
        "overdue": aggregate.overdue,
        "due_today": aggregate.due_today,
        "pct": aggregate.pct,
        "next_due": (
            {"title": aggregate.next_due.title, "due_date": aggregate.next_due.due_date}
            if aggregate.next_due
            else None
        ),
        "by_status": dict(aggregate.by_status),
        "by_priority": dict(aggregate.by_priority),
    }


def sort_tasks(statement, sort: str | None):
    """``GET /tasks?sort=due|priority|created|position`` (stable secondary key: title)."""
    nulls_last = sa.case((Task.due_date.is_(None), 1), else_=0)
    if sort == "due":
        return statement.order_by(nulls_last, Task.due_date, Task.title)
    if sort == "priority":
        order = case_priority()
        return statement.order_by(order, Task.due_date.is_(None), Task.due_date, Task.title)
    if sort == "position":
        return statement.order_by(Task.project_id, Task.position, Task.title)
    if sort == "created":
        return statement.order_by(Task.created_at.desc(), Task.title)
    return statement.order_by(Task.position, Task.due_date.is_(None), Task.due_date, Task.title)


def case_priority() -> sa.ColumnElement[int]:
    """``urgent`` first; unknown values sort last."""
    rank = Priority.rank()
    whens = [(Task.priority == value, index) for value, index in rank.items()]
    return sa.case(*whens, else_=len(rank) + 1)
