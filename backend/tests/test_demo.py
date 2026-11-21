"""The demo dataset: deterministic, idempotent, and cleanly removable."""

from __future__ import annotations

import datetime as dt

import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.models import (
    ActivityLog,
    Company,
    Contact,
    Goal,
    Milestone,
    Note,
    Notification,
    Project,
    Reminder,
    Task,
)
from app.services import demo, goals as goals_service, projects as projects_service
from tests.helpers import make_project, make_task

DAY = dt.date(2026, 11, 21)

#: what the seeder must insert, table by table
EXPECTED = {
    "projects": 8,
    "tasks": 49,
    "milestones": 10,
    "notes": 12,
    "contacts": 8,
    "companies": 5,
    "goals": 4,
    "reminders": 3,
    "tags": 21,
    "note_relations": 8,
    "activity_logs": 17,
}


def count(session: Session, model) -> int:
    return int(session.scalar(sa.select(sa.func.count()).select_from(model)) or 0)


# ------------------------------------------------------------------------- seed


def test_seed_inserts_the_expected_shape_of_data(session: Session, workspace_id: str) -> None:
    result = demo.seed(session, workspace_id, today=DAY)
    assert result["skipped"] is False
    assert set(result["created"]) == set(EXPECTED) | {"notifications"}
    for table, expected in EXPECTED.items():
        assert result["created"][table] == expected, table
    assert result["created"]["notifications"] >= 5


def test_seeding_twice_is_a_no_op(session: Session, workspace_id: str) -> None:
    demo.seed(session, workspace_id, today=DAY)
    before = count(session, Task)
    again = demo.seed(session, workspace_id, today=DAY)
    assert again == {"created": {}, "skipped": True}
    assert count(session, Task) == before


def test_already_seeded_only_watches_demo_rows(session: Session, workspace_id: str) -> None:
    assert demo.already_seeded(session, workspace_id) is False
    make_task(session, workspace_id, "A user task")
    make_project(session, workspace_id, "A user project")
    assert demo.already_seeded(session, workspace_id) is False
    demo.seed(session, workspace_id, today=DAY)
    assert demo.already_seeded(session, workspace_id) is True


def count_demo_tagged(session: Session, model, source: str, workspace_id: str) -> int:
    return int(
        session.scalar(
            sa.select(sa.func.count())
            .select_from(model)
            .where(model.workspace_id == workspace_id, model.source == source)
        )
        or 0
    )


def test_every_seeded_business_row_is_tagged_demo(session: Session, workspace_id: str) -> None:
    demo.seed(session, workspace_id, today=DAY)
    for model in (Project, Task, Milestone, Note, Contact, Company, Goal, Reminder):
        assert count_demo_tagged(session, model, "user", workspace_id) == 0, model.__tablename__
        assert count_demo_tagged(session, model, "demo", workspace_id) > 0, model.__tablename__
    stray = session.scalar(
        sa.select(sa.func.count()).select_from(ActivityLog).where(ActivityLog.actor != "demo")
    )
    assert (stray or 0) == 0


@pytest.mark.parametrize("day", [dt.date(2026, 11, 21), dt.date(2027, 5, 4)])
def test_dates_are_relative_to_the_injected_today(
    session: Session, workspace_id: str, day: dt.date
) -> None:
    """The dataset is built from offsets, so any anchor date works."""
    demo.seed(session, workspace_id, today=day)
    design = session.scalar(sa.select(Task).where(Task.title == "Design tenant schema"))
    assert design is not None
    assert design.due_date == day - dt.timedelta(days=38)
    assert design.completed_at is not None
    assert design.completed_at.date() == day - dt.timedelta(days=38)

    overdue = session.scalars(
        sa.select(Task.due_date).where(
            Task.workspace_id == workspace_id,
            Task.due_date.is_not(None),
            Task.due_date < day,
        )
    ).all()
    assert overdue
    assert all(day - value <= dt.timedelta(days=90) for value in overdue)


def test_the_demo_dataset_reproduces_the_documented_progress_example(
    session: Session, workspace_id: str
) -> None:
    demo.seed(session, workspace_id, today=DAY)
    items, _total = projects_service.list_projects(session, workspace_id, today=DAY)
    orderbook = next(project for project in items if project["name"] == "OrderBook CRM")
    assert orderbook["progress"] == 62
    assert orderbook["task_counts"] == {"total": 13, "done": 8, "open": 5, "overdue": 1}


def test_seeded_data_exercises_every_dashboard_rule(session: Session, workspace_id: str) -> None:
    from app.services import dashboard

    demo.seed(session, workspace_id, today=DAY)
    payload = dashboard.dashboard_payload(session, workspace_id, today=DAY)
    kinds = {insight["kind"] for insight in payload["insights"]}
    assert {"overdue", "project_stalled", "past_target", "empty_project"} <= kinds
    assert payload["notifications"]["items"]
    assert payload["milestones"]["upcoming"]
    assert payload["notes"]["recent"]
    assert payload["activity"]


def test_seeded_goals_serve_projects(session: Session, workspace_id: str) -> None:
    """``goals.project_id`` is only worth having if the demo set uses it both ways."""
    demo.seed(session, workspace_id, today=DAY)
    items, _total = goals_service.list_goals(session, workspace_id)
    linked = {goal["title"]: goal for goal in items if goal["project_id"]}
    assert set(linked) == {"Ship OrderBook v1", "Publish the RLS write-up"}
    assert linked["Ship OrderBook v1"]["project"]["name"] == "OrderBook CRM"
    assert {"id", "name", "status"} == set(linked["Ship OrderBook v1"]["project"])
    unlinked = [goal for goal in items if goal["project_id"] is None]
    assert len(unlinked) == 2 and all(goal["project"] is None for goal in unlinked)


# ------------------------------------------------------------------------ reset


def test_reset_removes_demo_rows_then_reseeds(session: Session, workspace_id: str) -> None:
    seeded = demo.seed(session, workspace_id, today=DAY)
    user_project = make_project(session, workspace_id, "My real work")
    user_task = make_task(session, workspace_id, "My real task", project_id=user_project["id"])
    session.flush()

    result = demo.reset(session, workspace_id, today=DAY)
    assert result["skipped"] is False
    assert result["created"] == seeded["created"]
    assert result["deleted"]["projects"] == EXPECTED["projects"]

    # user rows are untouched
    surviving = session.scalars(sa.select(Project).where(Project.source == "user")).all()
    assert [project.name for project in surviving] == ["My real work"]
    assert session.get(Task, user_task["id"]) is not None


def test_reset_leaves_no_stray_rows(session: Session, workspace_id: str) -> None:
    demo.seed(session, workspace_id, today=DAY)
    demo.reset(session, workspace_id, today=DAY)
    # one workspace, one owner: nothing else should have accumulated twice
    assert count(session, Project) == EXPECTED["projects"]
    assert count(session, Task) == EXPECTED["tasks"]
    assert count(session, Note) == EXPECTED["notes"]
    assert count(session, Contact) == EXPECTED["contacts"]
    assert count(session, Company) == EXPECTED["companies"]
    assert count(session, Goal) == EXPECTED["goals"]
    assert count(session, Reminder) == EXPECTED["reminders"]


def test_reset_clears_derived_notifications(session: Session, workspace_id: str) -> None:
    demo.seed(session, workspace_id, today=DAY)
    before = count(session, Notification)
    assert before > 0
    demo.reset(session, workspace_id, today=DAY)
    assert count(session, Notification) == before


@pytest.mark.parametrize("frequency", ["weekly", "daily"])
def test_recurring_demo_tasks_exist(session: Session, workspace_id: str, frequency: str) -> None:
    demo.seed(session, workspace_id, today=DAY)
    rows = session.scalars(sa.select(Task).where(Task.recurrence == frequency)).all()
    assert rows, frequency
