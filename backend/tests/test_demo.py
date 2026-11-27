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
    CostScenario,
    CostScenarioItem,
    Expense,
    ExpenseCategory,
    ExchangeRate,
    Goal,
    IncomeProfile,
    IncomeTransaction,
    Milestone,
    Note,
    Notification,
    Project,
    Reminder,
    Service,
    ServicePlan,
    Subscription,
    Task,
)
from app.services import demo, goals as goals_service, projects as projects_service
from tests.helpers import backdate_task, make_project, make_task

DAY = dt.date(2026, 11, 21)

#: the four notification kinds PHASE3_FINANCE.md §6 adds with this phase
FINANCE_KINDS = frozenset(
    {"subscription_renewing", "expense_recurring_due", "income_overdue", "rate_stale"}
)

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
    "activity_logs": 21,
    # Phase 3 (PHASE3_FINANCE.md §4): the finance half of the same story
    "income_profiles": 3,
    "exchange_rates": 7,
    "services": 4,
    "service_plans": 4,
    "subscriptions": 5,
    "expense_categories": 7,
    "expenses": 15,
    "income_transactions": 11,
    "cost_scenarios": 2,
    "cost_scenario_items": 8,
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


def test_seed_backfills_the_finance_half_of_an_older_database(
    session: Session, workspace_id: str
) -> None:
    """The §10 open item: a pre-Phase-3 demo must not stay empty until a gated reset."""
    demo.seed(session, workspace_id, today=DAY)
    # pretend this database was seeded before the finance tables existed
    for model in (
        IncomeTransaction,
        Subscription,
        ServicePlan,
        CostScenario,
        CostScenarioItem,
        Service,
        Expense,
        IncomeProfile,
    ):
        session.execute(sa.delete(model).where(model.workspace_id == workspace_id))
    session.execute(
        sa.delete(ExchangeRate).where(
            ExchangeRate.workspace_id == workspace_id, ExchangeRate.provider == demo.DEMO_ACTOR
        )
    )
    session.execute(sa.delete(ExpenseCategory).where(ExpenseCategory.workspace_id == workspace_id))
    session.flush()

    assert demo.already_seeded(session, workspace_id) is True
    assert demo.finance_seeded(session, workspace_id) is False

    result = demo.seed(session, workspace_id, today=DAY)
    assert result["skipped"] is False
    for table in (
        "income_profiles",
        "exchange_rates",
        "expense_categories",
        "expenses",
        "income_transactions",
        "subscriptions",
        "services",
        "service_plans",
        "cost_scenarios",
        "cost_scenario_items",
    ):
        assert result["created"][table] == EXPECTED[table], table

    # the clients the money rows point at are the ones the first seed wrote, not copies
    assert count(session, Company) == EXPECTED["companies"]
    billed = session.scalars(
        sa.select(Subscription).where(Subscription.workspace_id == workspace_id)
    ).all()
    assert billed and all(row.company_id is not None for row in billed)
    # and now there is nothing left to backfill
    assert demo.finance_seeded(session, workspace_id) is True
    assert demo.seed(session, workspace_id, today=DAY) == {"created": {}, "skipped": True}


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
    for model in (
        Project,
        Task,
        Milestone,
        Note,
        Contact,
        Company,
        Goal,
        Reminder,
        # Phase 3: the finance rows that have a `source` column
        IncomeProfile,
        Service,
        ServicePlan,
        Subscription,
        Expense,
        IncomeTransaction,
        CostScenario,
    ):
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


def test_seeded_finance_rows_exercise_every_derived_rule(
    session: Session, workspace_id: str
) -> None:
    """PHASE3_FINANCE.md §6: the demo data is the proof the four rules are wired."""
    demo.seed(session, workspace_id, today=DAY)
    rows = session.scalars(
        sa.select(Notification).where(
            Notification.workspace_id == workspace_id, Notification.resolved_at.is_(None)
        )
    ).all()
    finance = {row.kind: row for row in rows if row.kind in FINANCE_KINDS}
    assert set(finance) == FINANCE_KINDS, sorted(row.kind for row in rows)
    for kind, row in finance.items():
        # §7: a finance notification deep-links into the finance screens, never to "/"
        assert row.href is not None and row.href.startswith("/finance"), (kind, row.href)
    assert finance["income_overdue"].severity == "warning"
    assert finance["rate_stale"].dedupe_key.startswith("rate:GBP-USD:")


@pytest.mark.parametrize("day", [dt.date(2026, 11, 21), dt.date(2032, 2, 29), dt.date(1995, 2, 27)])
def test_finance_dates_are_relative_to_the_injected_today(
    session: Session, workspace_id: str, day: dt.date
) -> None:
    """Every finance date is an offset, so the demo is alive on any anchor date (§4)."""
    demo.seed(session, workspace_id, today=day)
    renews_on = session.scalars(
        sa.select(Subscription.renews_on).where(
            Subscription.workspace_id == workspace_id, Subscription.renews_on.is_not(None)
        )
    ).all()
    assert renews_on
    window = (dt.timedelta(0), dt.timedelta(days=7))
    assert any(window[0] <= value - day <= window[1] for value in renews_on), renews_on

    paid_on = session.scalars(sa.select(Expense.paid_on).where(Expense.workspace_id == workspace_id)).all()
    # every payment sits inside a working window around the anchor - no absolute literals
    assert paid_on and all(abs((value - day).days) <= 200 for value in paid_on), "demo dates drifted"

    overdue = session.scalars(
        sa.select(IncomeTransaction).where(
            IncomeTransaction.workspace_id == workspace_id, IncomeTransaction.status == "overdue"
        )
    ).all()
    assert len(overdue) == 1 and overdue[0].received_on < day


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
    # the reset re-derives notifications, and the stalled rule reads task.updated_at -
    # pin the user row to the seeded day so its stamp cannot look stale or future
    backdate_task(session, user_task["id"], dt.datetime.combine(DAY, dt.time(9, 0)))
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
    # finance tables that §13 gives no `source` are found by their own marker instead
    assert count(session, ExpenseCategory) == EXPECTED["expense_categories"]
    assert count(session, ExchangeRate) == EXPECTED["exchange_rates"]
    assert count(session, CostScenarioItem) == EXPECTED["cost_scenario_items"]


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
