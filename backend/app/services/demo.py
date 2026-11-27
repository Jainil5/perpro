"""Demo seed and reset (``POST /demo/seed``, ``POST /demo/reset``, ``app.cli seed``).

Every row created here is tagged ``source = 'demo'`` (seeded activity rows use
``actor = 'demo'``), which is what makes :func:`reset` safe: it deletes only those
rows and leaves anything the user typed alone. The three finance tables §13 gives no
``source`` column - ``exchange_rates``, ``expense_categories`` and
``cost_scenario_items`` - are found by their own marker instead (``provider``,
``system_key``, and the parent scenario's id). Seeding is idempotent - if demo rows
already exist it does nothing and reports ``skipped: true``.

Dates are all relative to the real ``today``, so the demo always looks like a live
workload: overdue tasks, tasks due today, a recurring chain, subtasks, tags, one
stalled project, one project past its target date, one project without tasks,
milestones landing this week, notes linked to nothing, a goal past its target date
and unread notifications. ``OrderBook CRM`` gets 13 tasks of which 8 are done, so its
``progress`` is 62 - the exact number API.md shows.

Phase 3 adds the money half of the same story, and every Finance notification rule gets
one demo row to prove it is wired: a subscription that renews inside the week, a
recurring expense that comes due today, an income row two weeks overdue and one currency
pair whose newest rate is older than ``RATE_STALE_DAYS``.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.utils import add_months, new_id, today_utc
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
    NoteRelation,
    Notification,
    Project,
    Reminder,
    Service,
    ServicePlan,
    Subscription,
    Tag,
    Task,
    contact_tags,
    note_tags,
    task_tags,
)
from app.models.enums import (
    ActivityVerb,
    ContactKind,
    ExpenseRecurrence,
    GoalStatus,
    IncomeKind,
    IncomeMethod,
    IncomeStatus,
    PlanInterval,
    Priority,
    ProjectStatus,
    Recurrence,
    ReminderStatus,
    ScenarioDirection,
    ScenarioKind,
    ScenarioStatus,
    ServiceUnit,
    Source,
    SubscriptionStatus,
    TaxRegime,
    TaskStatus,
)
from app.services import context
from app.services import expenses as expenses_service
from app.services import links
from app.services import money
from app.services import notifications as notifications_service

#: ``activity_logs.actor`` for seeded rows - this is what reset keys on
DEMO_ACTOR = "demo"

#: The demo clients, in one place and in one order, because a Phase 3 backfill has to find
#: the rows an older seed already wrote and ``Company`` has no slug to carry the seeder's
#: key - the name is the only handle.  ``_seed_dataset`` creates these, ``_hydrate_clients``
#: reads them, so neither may drift from the other.
_DEMO_CLIENTS: dict[str, dict[str, Any]] = {
    "northwind": {
        "name": "Northwind",
        "website": "https://northwind.example",
        "industry": "fintech",
        "location": "Bengaluru",
        "notes": "Anchor client. Pays on time, reviews late.",
    },
    "vantage": {
        "name": "Vantage Labs",
        "website": "https://vantage.example",
        "industry": "saas",
        "location": "Remote (EU)",
    },
    "kite": {"name": "Kite Health", "industry": "healthcare", "location": "Lisbon"},
    "bluepeak": {
        "name": "Bluepeak Studio",
        "industry": "agency",
        "location": "Berlin",
        "notes": "White-label partner for dashboards.",
    },
    "solostack": {"name": "SoloStack", "industry": "developer tools", "location": None},
}

#: the finance tables a seeded demo is recognised by: one row in any of them and the money
#: half of the dataset is considered present (``exchange_rates``/``expense_categories`` are
#: not listed - they have no ``source``, so §13 makes them proof of nothing here)
_FINANCE_TABLES: tuple[type, ...] = (
    IncomeProfile,
    Service,
    ServicePlan,
    Subscription,
    Expense,
    IncomeTransaction,
    CostScenario,
)

#: source-tagged tables reset wipes, in a delete-safe order (children before parents)
_DEMO_TABLES: tuple[type, ...] = (
    Task,
    Milestone,
    Note,
    Project,
    Contact,
    Company,
    Goal,
    Reminder,
    # Phase 3 finance: the rows that point at a row below them come first, so the
    # ON DELETE SET NULL / CASCADE clauses never see a dangling reference
    IncomeTransaction,
    Subscription,
    ServicePlan,
    CostScenario,
    Service,
    Expense,
    IncomeProfile,
)


def _day(today: dt.date, offset: int) -> dt.date:
    return today + dt.timedelta(days=offset)


def _stamp(today: dt.date, offset: int, hour: int = 9, minute: int = 0) -> dt.datetime:
    """UTC datetime on ``today + offset`` at ``hour:minute`` (naive: SQLite's habit)."""
    return dt.datetime.combine(_day(today, offset), dt.time(hour, minute))


def already_seeded(session: Session, workspace_id: str) -> bool:
    """True when the seeder has already run for this workspace."""
    for model in _DEMO_TABLES:
        found = session.scalar(
            sa.select(model.id)
            .where(model.workspace_id == workspace_id, model.source == Source.DEMO.value)
            .limit(1)
        )
        if found is not None:
            return True
    return False


def finance_seeded(session: Session, workspace_id: str) -> bool:
    """True when the Phase 3 half of the dataset is in this workspace.

    Same "one row is proof" rule as :func:`already_seeded`, limited to the money tables.
    This is what lets :func:`seed` tell a database written before Phase 3 - core rows, no
    money rows - from one that already has the whole demo, and backfill instead of skipping.
    """
    for model in _FINANCE_TABLES:
        found = session.scalar(
            sa.select(model.id)
            .where(model.workspace_id == workspace_id, model.source == Source.DEMO.value)
            .limit(1)
        )
        if found is not None:
            return True
    return False


# --------------------------------------------------------------------- the seeder


class _Seeder:
    """Inserts the demo dataset. Each helper takes day offsets and returns the row."""

    def __init__(self, session: Session, workspace_id: str, today: dt.date) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.today = today
        self.counts: dict[str, int] = {}
        self.projects: dict[str, Project] = {}
        self.tasks: dict[str, Task] = {}
        self.milestones: dict[str, Milestone] = {}
        self.notes: dict[str, Note] = {}
        self.companies: dict[str, Company] = {}
        self.contacts: dict[str, Contact] = {}
        self.goals: dict[str, Goal] = {}
        self.reminders: dict[str, Reminder] = {}
        self.services: dict[str, Service] = {}
        self.plans: dict[str, ServicePlan] = {}
        self.subscriptions: dict[str, Subscription] = {}
        self.categories: dict[str, ExpenseCategory] = {}
        self.profiles: dict[str, IncomeProfile] = {}
        self.scenarios: dict[str, CostScenario] = {}
        self.expenses: dict[str, Expense] = {}
        #: ``income`` is the method name, so the ledger rows keep a distinct attribute
        self.income_rows: dict[str, IncomeTransaction] = {}

    # ---------------------------------------------------------------- plumbing
    def _add(self, row: Any, table: str) -> Any:
        self.session.add(row)
        self.session.flush()
        self.counts[table] = self.counts.get(table, 0) + 1
        return row

    def _tag(self, name: str) -> Tag:
        existing = self.session.scalar(
            sa.select(Tag).where(
                Tag.workspace_id == self.workspace_id, sa.func.lower(Tag.name) == name.lower()
            )
        )
        if existing is not None:
            return existing
        return self._add(Tag(id=new_id(), workspace_id=self.workspace_id, name=name), "tags")

    def _link(self, table: sa.Table, **values: str) -> None:
        self.session.execute(sa.insert(table).values(**values))

    def _source(self, **extra: Any) -> dict[str, Any]:
        """The columns every demo row shares: an id, a workspace, a source, timestamps."""
        return {
            "id": new_id(),
            "workspace_id": self.workspace_id,
            "source": Source.DEMO.value,
            **extra,
        }

    # ------------------------------------------------------------------ tables
    def project(
        self,
        key: str,
        name: str,
        *,
        status: str = ProjectStatus.IN_PROGRESS.value,
        priority: str = Priority.MEDIUM.value,
        category: str | None = None,
        description: str | None = None,
        start: int | None = None,
        target: int | None = None,
        next_action: str | None = None,
        repository_url: str | None = None,
        documentation_url: str | None = None,
        manual_progress: int = 0,
        created: int = -40,
        updated: int = -1,
    ) -> Project:
        project = Project(
            **self._source(
                slug=key,
                name=name,
                description=description,
                category=category,
                status=status,
                priority=priority,
                start_date=_day(self.today, start) if start is not None else None,
                target_date=_day(self.today, target) if target is not None else None,
                next_action=next_action,
                repository_url=repository_url,
                documentation_url=documentation_url,
                manual_progress=manual_progress,
                created_at=_stamp(self.today, created),
                updated_at=_stamp(self.today, updated),
            )
        )
        self.projects[key] = self._add(project, "projects")
        return self.projects[key]

    def task(
        self,
        key: str,
        title: str,
        *,
        project: str | None = None,
        parent: str | None = None,
        status: str = TaskStatus.TODO.value,
        priority: str = Priority.MEDIUM.value,
        due: int | None = None,
        start: int | None = None,
        done: int | None = None,
        created: int = -14,
        updated: int | None = None,
        recurrence: str = Recurrence.NONE.value,
        description: str | None = None,
        notes: str | None = None,
        tags: list[str] | None = None,
        estimated_minutes: int | None = None,
        actual_minutes: int | None = None,
        position: int = 0,
    ) -> Task:
        last_touched = updated if updated is not None else (done if done is not None else created)
        task = Task(
            **self._source(
                title=title,
                description=description,
                notes=notes,
                project_id=self.projects[project].id if project else None,
                parent_task_id=self.tasks[parent].id if parent else None,
                status=status,
                priority=priority,
                due_date=_day(self.today, due) if due is not None else None,
                start_date=_day(self.today, start) if start is not None else None,
                estimated_minutes=estimated_minutes,
                actual_minutes=actual_minutes,
                recurrence=recurrence,
                position=position,
                completed_at=_stamp(self.today, done, 17) if done is not None else None,
                created_at=_stamp(self.today, created),
                updated_at=_stamp(self.today, last_touched, 17 if done is not None else 16),
            )
        )
        self.tasks[key] = self._add(task, "tasks")
        for name in tags or []:
            self._link(task_tags, task_id=task.id, tag_id=self._tag(name).id)
        return task

    def milestone(
        self,
        key: str,
        title: str,
        *,
        project: str,
        date: int,
        description: str | None = None,
        done: int | None = None,
        created: int = -20,
        updated: int | None = None,
    ) -> Milestone:
        last_touched = updated if updated is not None else (done if done is not None else created)
        milestone = Milestone(
            **self._source(
                title=title,
                description=description,
                project_id=self.projects[project].id,
                date=_day(self.today, date),
                status="done" if done is not None else "open",
                completed_at=_stamp(self.today, done, 12) if done is not None else None,
                created_at=_stamp(self.today, created),
                updated_at=_stamp(self.today, last_touched, 12),
            )
        )
        self.milestones[key] = self._add(milestone, "milestones")
        return milestone

    def note(
        self,
        key: str,
        title: str,
        *,
        content: str = "",
        category: str = "technical",
        project: str | None = None,
        is_favorite: bool = False,
        tags: list[str] | None = None,
        created: int = -10,
        updated: int | None = None,
    ) -> Note:
        note = Note(
            **self._source(
                title=title,
                content=content,
                category=category,
                project_id=self.projects[project].id if project else None,
                is_favorite=is_favorite,
                word_count=len(content.split()),
                created_at=_stamp(self.today, created),
                updated_at=_stamp(self.today, updated if updated is not None else created, 11),
            )
        )
        self.notes[key] = self._add(note, "notes")
        for name in tags or []:
            self._link(note_tags, note_id=note.id, tag_id=self._tag(name).id)
        return note

    def relation(self, note_key: str, target_type: str, target_id: str, label: str | None = None) -> None:
        self._add(
            NoteRelation(
                id=new_id(),
                workspace_id=self.workspace_id,
                note_id=self.notes[note_key].id,
                target_type=target_type,
                target_id=target_id,
                label=label,
                created_by=DEMO_ACTOR,
            ),
            "note_relations",
        )

    def company(
        self,
        key: str,
        name: str,
        *,
        website: str | None = None,
        industry: str | None = None,
        location: str | None = None,
        notes: str | None = None,
        created: int = -40,
    ) -> Company:
        company = Company(
            **self._source(
                name=name,
                website=website,
                industry=industry,
                location=location,
                notes=notes,
                created_at=_stamp(self.today, created),
                updated_at=_stamp(self.today, created),
            )
        )
        self.companies[key] = self._add(company, "companies")
        return company

    def contact(
        self,
        key: str,
        name: str,
        *,
        company: str | None = None,
        email: str | None = None,
        phone: str | None = None,
        title: str | None = None,
        location: str | None = None,
        kind: str = ContactKind.CLIENT.value,
        notes: str | None = None,
        tags: list[str] | None = None,
        created: int = -5,
    ) -> Contact:
        contact = Contact(
            **self._source(
                name=name,
                email=email,
                phone=phone,
                title=title,
                location=location,
                kind=kind,
                notes=notes,
                company_id=self.companies[company].id if company else None,
                created_at=_stamp(self.today, created),
                updated_at=_stamp(self.today, created),
            )
        )
        self.contacts[key] = self._add(contact, "contacts")
        for name_tag in tags or []:
            self._link(contact_tags, contact_id=contact.id, tag_id=self._tag(name_tag).id)
        return contact

    def goal(
        self,
        key: str,
        title: str,
        *,
        description: str | None = None,
        category: str | None = None,
        priority: str = Priority.MEDIUM.value,
        progress: int = 0,
        target: int | None = None,
        done: int | None = None,
        abandoned: bool = False,
        created: int = -30,
        project: str | None = None,
    ) -> Goal:
        status = (
            GoalStatus.COMPLETED.value
            if done is not None
            else GoalStatus.ABANDONED.value
            if abandoned
            else GoalStatus.ACTIVE.value
        )
        goal = Goal(
            **self._source(
                title=title,
                description=description,
                category=category,
                priority=priority,
                status=status,
                progress=100 if status == GoalStatus.COMPLETED.value else progress,
                target_date=_day(self.today, target) if target is not None else None,
                completed_at=_stamp(self.today, done, 18) if done is not None else None,
                created_at=_stamp(self.today, created),
                updated_at=_stamp(self.today, done if done is not None else created, 18),
            ),
            # two of the four demo goals serve a project, so the link is visible in the UI
            project_id=self.projects[project].id if project else None,
        )
        self.goals[key] = self._add(goal, "goals")
        return self.goals[key]

    def reminder(
        self,
        key: str,
        title: str,
        *,
        due: int,
        hour: int = 9,
        status: str = ReminderStatus.PENDING.value,
        entity_type: str | None = None,
        entity_id: str | None = None,
        notes: str | None = None,
        created: int = -6,
    ) -> Reminder:
        reminder = Reminder(
            **self._source(
                title=title,
                due_at=_stamp(self.today, due, hour),
                status=status,
                completed_at=_stamp(self.today, due, hour + 2)
                if status == ReminderStatus.DONE.value
                else None,
                entity_type=entity_type,
                entity_id=entity_id,
                notes=notes,
                created_at=_stamp(self.today, created),
                updated_at=_stamp(self.today, created),
            )
        )
        self.reminders[key] = self._add(reminder, "reminders")
        return reminder

    def activity(
        self,
        *,
        verb: str,
        entity_type: str,
        entity_title: str,
        entity_id: str | None = None,
        project_id: str | None = None,
        summary: str | None = None,
        href: str | None = None,
        when: int,
        hour: int = 10,
    ) -> ActivityLog:
        stamp = _stamp(self.today, when, hour)
        if href is None:
            href = links.href_for(entity_type, entity_id, project_id=project_id)
        row = ActivityLog(
            id=new_id(),
            workspace_id=self.workspace_id,
            verb=verb,
            entity_type=entity_type,
            entity_id=entity_id,
            entity_title=entity_title,
            summary=summary or f"{verb.title()} “{entity_title}”",
            project_id=project_id,
            href=href,
            actor=DEMO_ACTOR,
            payload={},
            created_at=stamp,
            updated_at=stamp,
        )
        return self._add(row, "activity_logs")

    # ---------------------------------------------------------------- finance
    # Money is written as Decimal here and float only at the JSON boundary (§2.1), so
    # every amount below arrives as a string and never round-trips through a float.
    def income_profile(
        self,
        key: str,
        name: str,
        *,
        currency: str,
        kind: str = IncomeKind.SALARY.value,
        gross: str | None = None,
        regime: str = TaxRegime.NONE.value,
        rate: str | None = None,
        slabs: list[dict[str, Any]] | None = None,
        notes: str | None = None,
        created: int = -90,
    ) -> IncomeProfile:
        profile = IncomeProfile(
            **self._source(
                name=name,
                kind=kind,
                gross_monthly=None if gross is None else Decimal(gross),
                currency=currency,
                tax_regime=regime,
                tax_rate=None if rate is None else Decimal(rate),
                slabs=slabs,
                notes=notes,
                created_at=_stamp(self.today, created),
                updated_at=_stamp(self.today, created),
            )
        )
        self.profiles[key] = self._add(profile, "income_profiles")
        return self.profiles[key]

    def exchange_rate(self, base: str, quote: str, rate: str, *, when: int) -> ExchangeRate:
        """One point of pair history, ``provider='demo'`` - the table has no ``source``.

        The ``(workspace, base, quote, as_of)`` UNIQUE doubles as the idempotency key, so a
        backfill over a book that already carries these dates returns the stored row and
        counts nothing new instead of tripping the constraint.
        """
        on = _day(self.today, when)
        existing = self.session.scalar(
            sa.select(ExchangeRate).where(
                ExchangeRate.workspace_id == self.workspace_id,
                ExchangeRate.base == base,
                ExchangeRate.quote == quote,
                ExchangeRate.as_of == on,
            )
        )
        if existing is not None:
            return existing
        stamp = _stamp(self.today, when, 8)
        row = ExchangeRate(
            id=new_id(),
            workspace_id=self.workspace_id,
            base=base,
            quote=quote,
            rate=Decimal(rate),
            as_of=on,
            provider=DEMO_ACTOR,
            created_at=stamp,
            updated_at=stamp,
        )
        return self._add(row, "exchange_rates")

    def service(
        self,
        key: str,
        name: str,
        *,
        code: str,
        unit: str = ServiceUnit.HOUR.value,
        price: str | None = None,
        currency: str | None = None,
        active: bool = True,
        description: str | None = None,
        created: int = -120,
    ) -> Service:
        row = Service(
            **self._source(
                name=name,
                code=code,
                description=description,
                unit=unit,
                default_price=None if price is None else Decimal(price),
                currency=currency,
                active=active,
                created_at=_stamp(self.today, created),
                updated_at=_stamp(self.today, created + 1),
            )
        )
        self.services[key] = self._add(row, "services")
        return self.services[key]

    def plan(
        self,
        key: str,
        service: str,
        name: str,
        *,
        price: str,
        currency: str,
        interval: str = PlanInterval.MONTHLY.value,
        units: str | None = None,
        overage: str | None = None,
        trial: int | None = None,
        active: bool = True,
        created: int = -120,
    ) -> ServicePlan:
        row = ServicePlan(
            **self._source(
                service_id=self.services[service].id,
                name=name,
                interval=interval,
                price=Decimal(price),
                currency=currency,
                included_units=None if units is None else Decimal(units),
                overage_rate=None if overage is None else Decimal(overage),
                trial_days=trial,
                active=active,
                created_at=_stamp(self.today, created),
                updated_at=_stamp(self.today, created + 1),
            )
        )
        self.plans[key] = self._add(row, "service_plans")
        return self.plans[key]

    def subscription(
        self,
        key: str,
        *,
        price: str,
        currency: str,
        started: int,
        interval: str = PlanInterval.MONTHLY.value,
        status: str = SubscriptionStatus.ACTIVE.value,
        plan: str | None = None,
        company: str | None = None,
        renews: int | None = None,
        cancelled: int | None = None,
        invoice: str | None = None,
        notes: str | None = None,
        created: int = -30,
    ) -> Subscription:
        row = Subscription(
            **self._source(
                plan_id=self.plans[plan].id if plan else None,
                company_id=self.companies[company].id if company else None,
                status=status,
                started_on=_day(self.today, started),
                renews_on=_day(self.today, renews) if renews is not None else None,
                cancelled_on=_day(self.today, cancelled) if cancelled is not None else None,
                price=Decimal(price),
                currency=currency,
                interval=interval,
                invoice_number=invoice,
                notes=notes,
                created_at=_stamp(self.today, created),
                updated_at=_stamp(self.today, created + 1),
            )
        )
        self.subscriptions[key] = self._add(row, "subscriptions")
        return self.subscriptions[key]

    def expense_category(self, key: str, name: str, *, kind: str, color: str) -> ExpenseCategory:
        """A §4 preset. ``system_key`` - not ``source`` - is what marks it as seeded."""
        stamp = _stamp(self.today, -365)
        row = ExpenseCategory(
            id=new_id(),
            workspace_id=self.workspace_id,
            name=name,
            kind=kind,
            system_key=key,
            color=color,
            archived=False,
            created_at=stamp,
            updated_at=stamp,
        )
        self.categories[key] = self._add(row, "expense_categories")
        return self.categories[key]

    def expense(
        self,
        key: str,
        label: str,
        amount: str,
        currency: str,
        *,
        paid_on: int | None = None,
        months_ago: int | None = None,
        category: str | None = None,
        recurring: bool = False,
        recurrence: str = ExpenseRecurrence.NONE.value,
        vendor: str | None = None,
        invoice: str | None = None,
        notes: str | None = None,
    ) -> Expense:
        """One logged payment.

        ``paid_on`` is a day offset from ``today``; ``months_ago`` is instead the same
        day-of-month that many months back (clamped), which is what makes a monthly chain
        renew exactly today however the calendar falls - the §6 due-soon rule needs that
        anchor. Exactly one of the two is passed.
        """
        anchor = (
            add_months(self.today, -months_ago)
            if months_ago is not None
            else _day(self.today, paid_on or 0)
        )
        stamp = dt.datetime.combine(anchor, dt.time(19))
        row = Expense(
            **self._source(
                label=label,
                amount=Decimal(amount),
                currency=currency,
                paid_on=anchor,
                category_id=self.categories[category].id if category else None,
                recurring=recurring,
                recurrence=recurrence,
                vendor=vendor,
                invoice_number=invoice,
                notes=notes,
                created_at=stamp,
                updated_at=stamp,
            )
        )
        self.expenses[key] = self._add(row, "expenses")
        return self.expenses[key]

    def income(
        self,
        key: str,
        label: str,
        amount: str,
        currency: str,
        *,
        received_on: int,
        status: str = IncomeStatus.PAID.value,
        service: str | None = None,
        subscription: str | None = None,
        method: str = IncomeMethod.BANK.value,
        invoice: str | None = None,
        notes: str | None = None,
        converted_to: str | None = None,
        converted_amount: str | None = None,
        converted_on: int | None = None,
    ) -> IncomeTransaction:
        """One inflow. ``converted_*`` is given as a whole triple or not at all (§2.3)."""
        converted = (
            {
                "converted_amount": Decimal(str(converted_amount)),
                "converted_currency": str(converted_to).upper(),
                "converted_at": _day(self.today, int(converted_on)),
            }
            if None not in (converted_to, converted_amount, converted_on)
            else {}
        )
        row = IncomeTransaction(
            **self._source(
                label=label,
                amount=Decimal(amount),
                currency=currency,
                received_on=_day(self.today, received_on),
                status=status,
                method=method,
                service_id=self.services[service].id if service else None,
                subscription_id=self.subscriptions[subscription].id if subscription else None,
                invoice_number=invoice,
                notes=notes,
                created_at=_stamp(self.today, received_on, 10),
                updated_at=_stamp(self.today, received_on, 10),
                **converted,
            )
        )
        self.income_rows[key] = self._add(row, "income_transactions")
        return self.income_rows[key]

    def scenario(
        self,
        key: str,
        name: str,
        *,
        currency: str,
        start: int,
        horizon: int = 12,
        kind: str = ScenarioKind.BUSINESS.value,
        status: str = ScenarioStatus.DRAFT.value,
        profile: str | None = None,
        assumptions: dict[str, Any] | None = None,
        notes: str | None = None,
        created: int = -20,
    ) -> CostScenario:
        row = CostScenario(
            **self._source(
                name=name,
                kind=kind,
                horizon_months=horizon,
                start_month=add_months(money.month_floor(self.today), start),
                currency=currency,
                base_income_profile_id=self.profiles[profile].id if profile else None,
                assumptions=assumptions,
                status=status,
                notes=notes,
                created_at=_stamp(self.today, created),
                updated_at=_stamp(self.today, created + 1),
            )
        )
        self.scenarios[key] = self._add(row, "cost_scenarios")
        return self.scenarios[key]

    def scenario_item(
        self,
        scenario: str,
        label: str,
        amount: str,
        *,
        direction: str = ScenarioDirection.COST.value,
        recurrence: str | None = PlanInterval.MONTHLY.value,
        currency: str | None = None,
        starts: int = 0,
        ends: int | None = None,
        category: str | None = None,
        notes: str | None = None,
    ) -> CostScenarioItem:
        parent = self.scenarios[scenario]
        first = money.month_floor(parent.start_month)
        row = CostScenarioItem(
            id=new_id(),
            workspace_id=self.workspace_id,
            scenario_id=parent.id,
            label=label,
            direction=direction,
            amount=Decimal(amount),
            currency=currency,
            recurrence=recurrence,
            starts_on=add_months(first, starts),
            ends_on=add_months(first, ends) if ends is not None else None,
            category_id=self.categories[category].id if category else None,
            notes=notes,
            created_at=_stamp(self.today, -12),
            updated_at=_stamp(self.today, -12),
        )
        return self._add(row, "cost_scenario_items")


# ------------------------------------------------------------------ demo content

_RLS_NOTE = """# RLS patterns that survived review

Use one policy per role, and read `tenant_id` from the session GUC - never from the
JWT claim inside the policy.

- `USING (tenant_id = current_setting('app.tenant_id')::uuid)`
- `WITH CHECK` on writes, otherwise a client can move rows between tenants
- `user_limit` from `tenants.config` is enforced **in the API**, not in a policy

> Two policies beat one clever policy. The diff stays reviewable."""

_IMPORT_NOTE = """## Import pipeline notes

CSV -> staging table -> validate -> upsert. Rejections must carry the row number so
the client can fix the file without guessing.

Acceptance:
- 5k rows under 3s
- idempotent re-run of the same file
"""

_MEETING_NOTE = """# Kickoff - Northwind (call notes)

Attendees: Ravi (CTO), Priya (PM), me.

- Order book is the source of truth; CRM mirrors, never mutates
- Phase 1 ships read-only dashboards
- **Next step:** schema draft by Friday, then a 45 minute review
"""

_CAREER_NOTE = """## Interview prep plan

1 week per topic, one system-design session per weekend.

- distributed transactions
- query planning + indexes
- writing up the RLS note
"""


def _seed_dataset(s: _Seeder) -> None:
    """One flat, readable description of the demo workload."""
    # ================================================================ projects
    s.project(
        "orderbook-crm",
        "OrderBook CRM",
        description="Multi-tenant order book plus a light CRM for Northwind: an "
        "RLS-first schema, an import pipeline and read-only dashboards.",
        category="client",
        status=ProjectStatus.IN_PROGRESS.value,
        priority=Priority.HIGH.value,
        start=-50,
        target=25,
        next_action="Send schema draft to Ravi",
        repository_url="https://github.com/example/orderbook",
        documentation_url="https://www.notion.so/orderbook-schema",
        created=-50,
        updated=-1,
    )
    s.project(
        "myos-dashboard",
        "MyOS Personal Dashboard",
        description="Own operating system: projects, tasks, notes and signals in one "
        "place. Phase 1 is the Python backend plus the Next.js UI.",
        category="personal",
        status=ProjectStatus.IN_PROGRESS.value,
        priority=Priority.URGENT.value,
        start=-35,
        target=45,
        next_action="Finish the notification rules and wire the command palette",
        repository_url="https://github.com/example/myos",
        created=-35,
        updated=0,
    )
    s.project(
        "northwind-billing",
        "Northwind Billing Sync",
        description="Nightly invoice + payment sync from the Northwind ledger into "
        "OrderBook, with a reconciliation report.",
        category="client",
        status=ProjectStatus.REVIEW.value,
        priority=Priority.MEDIUM.value,
        start=-24,
        target=6,
        next_action="Hand the reconciliation report to Priya",
        created=-24,
        updated=-2,
    )
    s.project(
        "ledger-insights",
        "Ledger Insights Prototype",
        description="Small analytics prototype over the ledger export: burn, runway "
        "and per-client margin.",
        category="business_idea",
        status=ProjectStatus.PLANNING.value,
        priority=Priority.MEDIUM.value,
        start=-8,
        target=40,
        next_action="Decide whether to keep it or fold it into OrderBook",
        manual_progress=15,
        created=-8,
        updated=-3,
    )
    s.project(
        "career-backend",
        "Career: Platform Backend Roles",
        description="Applications, take-homes and interviews for senior backend roles.",
        category="personal",
        status=ProjectStatus.PLANNING.value,
        priority=Priority.HIGH.value,
        start=-18,
        target=30,
        next_action="Book the Vantage Labs screen",
        created=-18,
        updated=-1,
    )
    s.project(
        "whatsapp-bot",
        "Agregator WhatsApp Bot",
        description="Order intake over WhatsApp for the aggregator pilot.",
        category="startup",
        status=ProjectStatus.ON_HOLD.value,
        priority=Priority.LOW.value,
        start=-60,
        target=-5,
        next_action="Wait for the Twilio budget decision",
        created=-60,
        updated=-13,
    )
    s.project(
        "team-ops",
        "Team Ops & Finance",
        description="Invoices, contracts, subscriptions and the monthly review.",
        category="internal",
        status=ProjectStatus.BACKLOG.value,
        priority=Priority.LOW.value,
        start=None,
        target=3,
        next_action="Break this into real tasks",
        created=-4,
        updated=-4,
    )
    s.project(
        "legacy-import",
        "Legacy Import Tooling",
        description="One-off CSV importers for the old PostgreSQL dumps.",
        category="internal",
        status=ProjectStatus.COMPLETED.value,
        priority=Priority.MEDIUM.value,
        start=-90,
        target=-14,
        next_action=None,
        created=-90,
        updated=-14,
    )

    # ==================================================================== tasks
    # OrderBook CRM: 13 tasks, 8 done => progress 62 (the API.md example)
    ob = "orderbook-crm"
    s.task("ob-1", "Design tenant schema", project=ob, status=TaskStatus.DONE.value,
           done=-38, created=-45, due=-38, priority=Priority.HIGH.value, tags=["schema"],
           estimated_minutes=480, actual_minutes=520, position=1,
           description="Tenants, users, orders and the `tenant_id` column on every table.")
    s.task("ob-2", "Row-level security policies", project=ob, status=TaskStatus.DONE.value,
           done=-30, created=-40, due=-30, priority=Priority.URGENT.value, tags=["schema", "rls"],
           estimated_minutes=360, actual_minutes=420, position=2,
           description="Policies per role; `app.tenant_id` from the session GUC.",
           notes="Five policies, one per role. `current_setting('app.tenant_id', true)` "
           "must never fall back to a default tenant - a missing GUC means zero rows.")
    s.task("ob-3", "Import pipeline skeleton", project=ob, status=TaskStatus.DONE.value,
           done=-24, created=-34, due=-24, priority=Priority.HIGH.value, tags=["import"],
           estimated_minutes=300, actual_minutes=300, position=3)
    s.task("ob-4", "Order book read model", project=ob, status=TaskStatus.DONE.value,
           done=-20, created=-30, due=-20, tags=["api"], estimated_minutes=240, actual_minutes=260, position=4)
    s.task("ob-5", "CSV validation rules", project=ob, status=TaskStatus.DONE.value,
           done=-16, created=-26, due=-16, tags=["import"], estimated_minutes=180, actual_minutes=150, position=5)
    s.task("ob-6", "Client dashboard wireframe", project=ob, status=TaskStatus.DONE.value,
           done=-12, created=-22, due=-12, priority=Priority.MEDIUM.value, tags=["ui"], position=6)
    s.task("ob-7", "Reconciliation queries", project=ob, status=TaskStatus.DONE.value,
           done=-9, created=-19, due=-9, tags=["billing"], position=7)
    s.task("ob-8", "Deployment runbook", project=ob, status=TaskStatus.DONE.value,
           done=-5, created=-15, due=-5, tags=["infra"], position=8)
    s.task("ob-9", "Enforce user_limit in the API", project=ob, status=TaskStatus.IN_PROGRESS.value,
           due=-4, created=-10, priority=Priority.HIGH.value, tags=["rls", "api"],
           estimated_minutes=240, actual_minutes=90, position=9,
           description="Gate the free tier to 3 orders per user via `user_limit` in "
           "`tenants.config`. Read it at the API boundary, not in a policy.\n\n"
           "Acceptance:\n- Free tier blocked on the 4th order\n- Upgrade prompt shown",
           notes="Overdue by design - this is the demo's overdue task.")
    s.task("ob-10", "Write migration notes", project=ob, due=2, created=-6,
           priority=Priority.HIGH.value, tags=["docs", "schema"], estimated_minutes=90, position=10,
           description="Summarise the alembic steps for the client's DBA.")
    s.task("ob-11", "Add order search endpoint", project=ob, status=TaskStatus.TODO.value,
           due=0, created=-4, priority=Priority.MEDIUM.value, tags=["api"], estimated_minutes=120, position=11,
           description="Due today: `GET /orders?q=` with tenant scoping.")
    s.task("ob-12", "Client review meeting", project=ob, status=TaskStatus.BLOCKED.value,
           due=6, created=-3, priority=Priority.MEDIUM.value, tags=["client"], position=12,
           notes="Blocked: waiting for Priya to confirm the attendees.")
    s.task("ob-13", "Weekly status email to Northwind", project=ob,
           due=7, created=-20, updated=-6, recurrence=Recurrence.WEEKLY.value,
           priority=Priority.LOW.value, tags=["client"], position=13,
           description="Recurring: three bullets - shipped, next, blocked.")

    # MyOS dashboard: 12 tasks, 5 done, 2 due today, subtasks, daily recurrence
    my = "myos-dashboard"
    s.task("my-1", "Design the data model", project=my, status=TaskStatus.DONE.value,
           done=-20, created=-32, due=-20, priority=Priority.HIGH.value, tags=["schema"], position=1)
    s.task("my-2", "API contract in API.md", project=my, status=TaskStatus.DONE.value,
           done=-15, created=-30, due=-15, tags=["docs"], position=2)
    s.task("my-3", "Backend Phase 1", project=my, status=TaskStatus.IN_PROGRESS.value,
           due=0, created=-12, priority=Priority.URGENT.value, tags=["api"], estimated_minutes=1800,
           actual_minutes=900, position=3,
           description="FastAPI + SQLAlchemy 2.0 + Alembic, one workspace, no auth yet.")
    for index, (child_title, child_status, child_due) in enumerate(
        (
            ("Routers for tasks and projects", TaskStatus.IN_PROGRESS.value, 0),
            ("Notification rules", TaskStatus.TODO.value, 1),
            ("Demo seed data", TaskStatus.TODO.value, 3),
        ),
        start=1,
    ):
        s.task(f"my-3-{index}", child_title, project=my, parent="my-3", status=child_status,
               due=child_due, created=-8, priority=Priority.HIGH.value, tags=["api"],
               position=30 + index)
    s.task("my-4", "Command palette search", project=my, status=TaskStatus.TODO.value,
           due=5, created=-9, priority=Priority.HIGH.value, tags=["ui"], estimated_minutes=300, position=4)
    s.task("my-5", "Dashboard insights rules", project=my, status=TaskStatus.DONE.value,
           done=-4, created=-10, due=-4, tags=["api"], position=5)
    s.task("my-6", "Task import tolerance tests", project=my, status=TaskStatus.TODO.value,
           due=8, created=-5, priority=Priority.MEDIUM.value, tags=["import"], position=6)
    s.task("my-7", "Daily standup note", project=my, due=1, created=-14, updated=-1,
           recurrence=Recurrence.DAILY.value, priority=Priority.LOW.value, tags=["personal"], position=7,
           description="One line: what moved, what is blocked.")
    s.task("my-8", "Pick a chart library", project=my, status=TaskStatus.DROPPED.value,
           done=-6, created=-11, due=-6, priority=Priority.LOW.value, position=8,
           notes="Dropped - the dashboard renders fine without charts.")
    s.task("my-9", "Export / backup endpoint", project=my, status=TaskStatus.TODO.value,
           due=11, created=-3, priority=Priority.MEDIUM.value, tags=["api"], position=9)
    s.task("my-10", "Settings page: goals", project=my, status=TaskStatus.TODO.value,
           due=None, created=-2, priority=Priority.LOW.value, tags=["ui"], position=10)
    s.task("my-11", "Timezone-aware date helpers", project=my, status=TaskStatus.DONE.value,
           done=-2, created=-7, due=-2, tags=["api"], position=11)

    # Northwind billing: 6 tasks, 5 done
    nb = "northwind-billing"
    s.task("nb-1", "Ledger export reader", project=nb, status=TaskStatus.DONE.value,
           done=-18, created=-22, due=-18, tags=["import"], position=1)
    s.task("nb-2", "Invoice <-> order mapping", project=nb, status=TaskStatus.DONE.value,
           done=-14, created=-20, due=-14, tags=["billing"], position=2)
    s.task("nb-3", "Nightly sync job", project=nb, status=TaskStatus.DONE.value,
           done=-10, created=-16, due=-10, tags=["infra"], position=3)
    s.task("nb-4", "Reconciliation report", project=nb, status=TaskStatus.DONE.value,
           done=-6, created=-12, due=-6, position=4)
    s.task("nb-5", "Handle partial payments", project=nb, status=TaskStatus.DONE.value,
           done=-3, created=-9, due=-3, tags=["billing"], position=5)
    s.task("nb-6", "Client sign-off on the report", project=nb, status=TaskStatus.IN_PROGRESS.value,
           due=4, created=-4, priority=Priority.HIGH.value, tags=["client"], position=6)

    # Ledger insights: 7 tasks, 1 done, monthly recurrence
    li = "ledger-insights"
    s.task("li-1", "Sketch the metrics", project=li, status=TaskStatus.DONE.value,
           done=-5, created=-7, due=-5, tags=["finance"], position=1)
    s.task("li-2", "Define burn and runway", project=li, due=9, created=-4, priority=Priority.HIGH.value,
           tags=["finance"], position=2)
    s.task("li-3", "Per-client margin query", project=li, due=14, created=-3, tags=["billing"], position=3)
    s.task("li-4", "Monthly subscription review", project=li, due=10, created=-25, updated=-9,
           recurrence=Recurrence.MONTHLY.value, priority=Priority.LOW.value, tags=["finance"], position=4,
           description="First of each month: check every subscription price and renewal date.")
    s.task("li-5", "Decide: prototype vs OrderBook", project=li, status=TaskStatus.BLOCKED.value,
           due=20, created=-3, priority=Priority.MEDIUM.value, position=5)
    s.task("li-6", "Cost scenario modelling", project=li, due=None, created=-1,
           priority=Priority.LOW.value, tags=["finance"], position=6)

    # Career: 4 tasks, 0 done, 2 overdue
    ca = "career-backend"
    s.task("ca-1", "Apply to Vantage Labs", project=ca, status=TaskStatus.DONE.value,
           done=-9, created=-12, due=-9, priority=Priority.HIGH.value, tags=["career"], position=1)
    s.task("ca-2", "System design: distributed transactions", project=ca, due=-3, created=-8,
           priority=Priority.HIGH.value, tags=["career", "learning"], position=2,
           description="Overdue demo task: 2 hours of notes plus one diagram.")
    s.task("ca-3", "Take-home for Kite Health", project=ca, status=TaskStatus.IN_PROGRESS.value,
           due=-1, created=-6, priority=Priority.URGENT.value, tags=["career"], position=3)
    s.task("ca-4", "Interview prep: query planning", project=ca, due=12, created=-2,
           tags=["learning", "career"], position=4)

    # WhatsApp bot: 3 tasks, none done, last touched 13 days ago => stalled
    wa = "whatsapp-bot"
    s.task("wa-1", "Twilio webhook spike", project=wa, status=TaskStatus.DONE.value,
           done=-40, created=-55, due=-40, tags=["api"], position=1)
    s.task("wa-2", "Order intake conversation design", project=wa, due=-30, created=-50,
           updated=-13, tags=["ui"], position=2)
    s.task("wa-3", "Budget approval", project=wa, status=TaskStatus.BLOCKED.value,
           due=-20, created=-45, updated=-13, priority=Priority.MEDIUM.value, position=3,
           notes="Blocked on the Twilio budget decision.")

    # Legacy import tooling: 3 tasks, all done (completed project => progress 100)
    lg = "legacy-import"
    s.task("lg-1", "Dump parser", project=lg, status=TaskStatus.DONE.value, done=-30,
           created=-70, due=-30, tags=["import"], position=1)
    s.task("lg-2", "Type coercion table", project=lg, status=TaskStatus.DONE.value, done=-22,
           created=-60, due=-22, tags=["import"], position=2)
    s.task("lg-3", "Write it up and archive", project=lg, status=TaskStatus.DONE.value, done=-14,
           created=-40, due=-14, tags=["docs"], position=3)
    # Team ops (backlog) deliberately has no tasks => the empty-project insight.

    # ============================================================== milestones
    s.milestone("ob-m1", "Schema approved by Northwind", project=ob, date=-25, done=-25,
                description="Sign-off on the tenant schema and RLS policies.")
    s.milestone("ob-m2", "Beta to first client users", project=ob, date=3,
                description="Three Northwind users on the beta.")
    s.milestone("ob-m3", "Go-live", project=ob, date=25, description="Production cut-over.")
    s.milestone("my-m1", "Backend Phase 1 shipped", project=my, date=6,
                description="Every API.md endpoint live and tested.")
    s.milestone("my-m2", "UI parity with the contract", project=my, date=30)
    s.milestone("nb-m1", "First reconciled month", project=nb, date=-8, done=-8)
    s.milestone("nb-m2", "Client sign-off", project=nb, date=5)
    s.milestone("li-m1", "Prototype demo to myself", project=li, date=40)
    s.milestone("ca-m1", "First interview loop", project=ca, date=-4,
                description="Missed on purpose: a past-date open milestone.")
    s.milestone("lg-m1", "Tooling archived", project=lg, date=-14, done=-14)

    # ==================================================================== notes
    s.note("rls", "RLS patterns", content=_RLS_NOTE, category="technical", project=ob,
           is_favorite=True, tags=["postgres", "security", "rls"], created=-30, updated=-2)
    s.note("import", "Import pipeline notes", content=_IMPORT_NOTE, category="project_doc",
           project=ob, tags=["import", "validation"], created=-22, updated=-5)
    s.note("kickoff", "Northwind kickoff call", content=_MEETING_NOTE, category="meeting",
           project=ob, tags=["client", "crm"], created=-45, updated=-45)
    s.note("billing", "Ledger quirks", category="project_doc", project=nb,
           content="## Ledger quirks\n\n- Invoice numbers restart each year\n- Partial "
           "payments arrive as separate rows\n- The `credit` flag is unreliable\n",
           tags=["billing"], created=-12, updated=-7)
    s.note("metrics", "Metrics worth computing", category="business_idea", project=li,
           content="Burn, runway, per-client margin, gross margin per order line.\n\n"
           "Everything else is a vanity chart.", tags=["finance"], created=-6, updated=-6)
    s.note("career", "Interview prep plan", content=_CAREER_NOTE, category="learning",
           project=ca, tags=["career", "interviews"], created=-15, updated=-1)
    s.note("twilio", "WhatsApp pilot - what broke", category="technical", project=wa,
           content="Webhook retries double-insert orders. Idempotency key = message sid.\n",
           tags=["api"], created=-50, updated=-13)
    s.note("postgres", "Postgres ops cheat sheet", category="resource",
           content="```sql\nSELECT pg_size_pretty(pg_database_size(current_database()));\n```\n"
           "\n- `VACUUM (ANALYZE)` after a bulk load\n- watch `pg_stat_user_tables.seq_scan`\n",
           tags=["postgres", "infra"], created=-40, updated=-9)
    s.note("pricing", "Freelance pricing note", category="startup",
           content="Day rate floor, and why retainer beats hourly for the aggregator work.\n",
           tags=["finance"], created=-25, updated=-25)
    s.note("standup", "Weekly review template", category="personal", is_favorite=True,
           content="# Weekly review\n\n- Shipped\n- Next\n- Blocked\n",
           tags=["process"], created=-18, updated=-3)
    s.note("decision", "Record an ADR", category="project_doc",
           content="## ADR template\n\nContext, decision, consequences. One page maximum.\n",
           tags=["docs", "process"], created=-11, updated=-11)
    s.note("idea", "Idea: order book for services", category="business_idea",
           content="The same schema works for recurring services - orders become plans.\n",
           tags=["ideas"], created=-2, updated=-2)

    # note relations (polymorphic) - deliberately leaves several notes unlinked
    s.relation("rls", "project", s.projects[ob].id, label="RLS review")
    s.relation("rls", "task", s.tasks["ob-2"].id, label="policies shipped in")
    s.relation("import", "task", s.tasks["ob-3"].id, label="pipeline design")
    s.relation("kickoff", "project", s.projects[ob].id)
    s.relation("billing", "task", s.tasks["nb-2"].id)
    s.relation("career", "note", s.notes["rls"].id, label="write-up topic")
    s.relation("twilio", "project", s.projects[wa].id)

    # =============================================== companies and contacts
    for client, fields in _DEMO_CLIENTS.items():
        s.company(client, **fields)

    s.contact("ravi", "Ravi Kumar", company="northwind", email="ravi@northwind.example",
              phone="+91 98000 00001", title="CTO", location="Bengaluru",
              kind=ContactKind.CLIENT.value, tags=["crm"], notes="Wants everything in writing.")
    s.contact("priya", "Priya Sharma", company="northwind", email="priya@northwind.example",
              title="Product Manager", location="Bengaluru", kind=ContactKind.CLIENT.value,
              tags=["crm"], notes="Best channel: Slack, before 11am IST.")
    s.contact("daniel", "Daniel Frost", company="vantage", email="daniel@vantage.example",
              title="Head of Platform", location="Berlin", kind=ContactKind.PROSPECT.value,
              tags=["career"])
    s.contact("aisha", "Aisha Khan", company="bluepeak", email="aisha@bluepeak.example",
              title="Founder", location="Berlin", kind=ContactKind.PARTNER.value,
              tags=["white-label"])
    s.contact("marco", "Marco Silva", company="kite", email="marco@kitehealth.example",
              title="Engineering Manager", location="Lisbon", kind=ContactKind.PROSPECT.value,
              tags=["career"])
    s.contact("nina", "Nina Patel", company=None, email="nina@example.com", title="Staff Engineer",
              location="Pune", kind=ContactKind.MENTOR.value, notes="Monthly 30 minute call.",
              created=-2)
    s.contact("tom", "Tom Reyes", company="solostack", email="tom@solostack.example",
              title="Support", location=None, kind=ContactKind.VENDOR.value, created=-1)
    s.contact("elena", "Elena Rossi", company=None, email="elena@example.com", title=None,
              location="Turin", kind=ContactKind.PERSONAL.value, created=0)

    # the kickoff note mentions a person, so this relation needs the contact rows
    s.relation("kickoff", "contact", s.contacts["ravi"].id, label="attendee")

    # =================================================================== goals
    s.goal("g-ship", "Ship OrderBook v1", category="client", priority=Priority.HIGH.value,
           progress=60, target=-12, description="Signed-off beta plus a live go-live date.",
           created=-45, project=ob)
    s.goal("g-clients", "Close two new clients", category="business", priority=Priority.HIGH.value,
           progress=40, target=40, description="One agency partner, one product company.")
    s.goal("g-writeup", "Publish the RLS write-up", category="personal", progress=100,
           done=-8, target=10, description="Notes -> article on the blog.", project=my)
    s.goal("g-rust", "Learn Rust properly", category="learning", priority=Priority.LOW.value,
           progress=10, target=120, abandoned=True)

    # ================================================================ reminders
    s.reminder("r-invoice", "Chase the Northwind invoice", due=-1, hour=9,
               entity_type="project", entity_id=s.projects[nb].id,
               notes="Net 30 was 12 days ago.")
    s.reminder("r-vps", "Renew the VPS before it locks", due=2, hour=10,
               entity_type="note", entity_id=s.notes["postgres"].id)
    s.reminder("r-contract", "Send the contract renewal", due=-6, hour=11,
               status=ReminderStatus.DONE.value, entity_type="contact",
               entity_id=s.contacts["aisha"].id)

    # ================================================================= activity
    s.activity(verb=ActivityVerb.CREATED.value, entity_type="project", entity_title="MyOS Personal Dashboard",
               entity_id=s.projects[my].id, project_id=s.projects[my].id, when=-35)
    s.activity(verb=ActivityVerb.COMPLETED.value, entity_type="task", entity_title="Design tenant schema",
               entity_id=s.tasks["ob-1"].id, project_id=s.projects[ob].id, when=-38)
    s.activity(verb=ActivityVerb.UPDATED.value, entity_type="note", entity_title="RLS patterns",
               entity_id=s.notes["rls"].id, when=-2, summary="Updated “RLS patterns”")
    s.activity(verb=ActivityVerb.CREATED.value, entity_type="task", entity_title="Enforce user_limit in the API",
               entity_id=s.tasks["ob-9"].id, project_id=s.projects[ob].id, when=-10)
    s.activity(verb=ActivityVerb.COMPLETED.value, entity_type="task", entity_title="Reconciliation report",
               entity_id=s.tasks["nb-4"].id, project_id=s.projects[nb].id, when=-6)
    s.activity(verb=ActivityVerb.COMPLETED.value, entity_type="milestone", entity_title="First reconciled month",
               entity_id=s.milestones["nb-m1"].id, project_id=s.projects[nb].id, when=-8)
    s.activity(verb=ActivityVerb.MOVED.value, entity_type="task", entity_title="Backend Phase 1",
               entity_id=s.tasks["my-3"].id, project_id=s.projects[my].id, when=-1,
               summary="Moved “Backend Phase 1” to in_progress")
    s.activity(verb=ActivityVerb.CREATED.value, entity_type="task", entity_title="Export / backup endpoint",
               entity_id=s.tasks["my-9"].id, project_id=s.projects[my].id, when=-3)
    s.activity(verb=ActivityVerb.UPDATED.value, entity_type="project", entity_title="Ledger Insights Prototype",
               entity_id=s.projects[li].id, project_id=s.projects[li].id, when=-3)
    s.activity(verb=ActivityVerb.CREATED.value, entity_type="note", entity_title="Interview prep plan",
               entity_id=s.notes["career"].id, when=-15)
    s.activity(verb=ActivityVerb.CREATED.value, entity_type="contact", entity_title="Nina Patel",
               entity_id=s.contacts["nina"].id, when=-2)
    s.activity(verb=ActivityVerb.CREATED.value, entity_type="contact", entity_title="Elena Rossi",
               entity_id=s.contacts["elena"].id, when=0)
    s.activity(verb=ActivityVerb.DELETED.value, entity_type="task", entity_title="Pick a chart library",
               entity_id=s.tasks["my-8"].id, project_id=s.projects[my].id, when=-6,
               summary="Deleted “Pick a chart library”")
    s.activity(verb=ActivityVerb.REOPENED.value, entity_type="task", entity_title="Write migration notes",
               entity_id=s.tasks["ob-10"].id, project_id=s.projects[ob].id, when=-1)
    s.activity(verb=ActivityVerb.UPDATED.value, entity_type="goal", entity_title="Ship OrderBook v1",
               entity_id=s.goals["g-ship"].id, when=-4, summary="Updated “Ship OrderBook v1”")
    s.activity(verb=ActivityVerb.CREATED.value, entity_type="reminder", entity_title="Chase the Northwind invoice",
               when=-1)
    s.activity(verb=ActivityVerb.COMPLETED.value, entity_type="task", entity_title="Timezone-aware date helpers",
               entity_id=s.tasks["my-11"].id, project_id=s.projects[my].id, when=-2)

    # =================================================================== finance
    _seed_finance(s)


def _hydrate_clients(s: _Seeder) -> None:
    """Give a finance backfill the client rows the money half points at.

    :func:`_seed_finance` names companies by seeder key ("northwind"), and those keys live
    in a running ``_Seeder``, not in the database - ``Company`` has no slug (§13). So a
    backfill reads the rows the first seed wrote by the one column that identifies them,
    and creates any client the user deleted: the demo has to end up the same shape however
    it got there.
    """
    for key, fields in _DEMO_CLIENTS.items():
        row = s.session.scalar(
            sa.select(Company).where(
                Company.workspace_id == s.workspace_id,
                Company.source == Source.DEMO.value,
                Company.name == fields["name"],
            )
        )
        s.companies[key] = row if row is not None else s.company(key, **fields)


def _seed_finance(s: _Seeder) -> None:
    """The money half of the demo, in the same clock-relative style as the rest.

    Four rows exist to keep the §6 notification rules honest - a subscription that
    renews inside the week, a recurring expense whose chain comes due today, an income
    row that is overdue, and one currency pair whose newest stored rate is older than
    ``RATE_STALE_DAYS`` - and the rest is the workload those rules have to fire inside.
    Amounts are strings so nothing is quantized twice (§2.1).
    """
    ccy = money.workspace_currency(s.session, s.workspace_id)

    # ------------------------------------------------------------ expense categories
    # §13 gives this table no `source`: the presets are found by `system_key`, which is
    # also why seeding twice never doubles them (services/expenses.ensure_presets).
    for key, name, kind, color in expenses_service.PRESET_CATEGORIES:
        already = s.session.scalar(
            sa.select(ExpenseCategory.id).where(
                ExpenseCategory.workspace_id == s.workspace_id, ExpenseCategory.system_key == key
            )
        )
        if already is None:
            s.expense_category(key, name, kind=kind, color=color)

    # ------------------------------------------------------------ exchange rates
    # history on the pairs the book is actually denominated in, so naming any of INR,
    # EUR or USD as the summary target resolves instead of 422-ing (§2.4), plus a
    # GBP→USD pair last touched 64 days ago, which is what makes a pair stale.
    s.exchange_rate("USD", "INR", "83.20", when=-45)
    s.exchange_rate("USD", "INR", "84.10", when=-2)
    s.exchange_rate("EUR", "INR", "88.90", when=-45)
    s.exchange_rate("EUR", "INR", "89.75", when=-2)
    s.exchange_rate("EUR", "USD", "1.1400", when=-45)
    s.exchange_rate("EUR", "USD", "1.1620", when=-2)
    s.exchange_rate("GBP", "USD", "1.2700", when=-64)

    # ------------------------------------------------------------ income profiles
    s.income_profile(
        "p-salary", "Northwind salary", currency=ccy, kind=IncomeKind.SALARY.value, gross="220000",
        regime=TaxRegime.SLAB.value,
        slabs=[
            {"up_to": 400000, "rate": 5},
            {"up_to": 800000, "rate": 15},
            {"up_to": 1200000, "rate": 25},
            {"up_to": None, "rate": 30},
        ],
        notes="TDS withheld monthly; the slabs are the annual ones on the notice.",
        created=-210,
    )
    s.income_profile(
        "p-contract", "Vantage Labs contract", currency="EUR", kind=IncomeKind.CONTRACT.value,
        gross="9500", regime=TaxRegime.PRESUMPTIVE.value, rate="15",
        notes="Presumptive scheme for the EU entity - the gross is what is taxed.",
        created=-150,
    )
    s.income_profile(
        "p-freelance", "Hourly work", currency=ccy, kind=IncomeKind.FREELANCE.value,
        gross="48000", regime=TaxRegime.FLAT.value, rate="30",
        notes="Flat rate, no deductions modelled.", created=-90,
    )

    # ------------------------------------------------------------ catalogue
    s.service(
        "svc-api", "Managed API platform", code="API-PLAT", unit=ServiceUnit.RETAINER.value,
        price="45000", currency=ccy,
        description="Multi-tenant API hosting with an SLO and a monthly capacity report.",
        created=-240,
    )
    s.service(
        "svc-eng", "Fractional backend engineering", code="BE-HRS", unit=ServiceUnit.HOUR.value,
        price="2400", currency=ccy,
        description="Hands-on engineering days, billed monthly in arrears.", created=-200,
    )
    s.service(
        "svc-audit", "Data pipeline audit", code="PIPE-AUDIT", unit=ServiceUnit.DAY.value,
        price="1800", currency="EUR",
        description="Two-day read-only audit of an ETL pipeline; written report within five days.",
        created=-140,
    )
    s.service(
        "svc-legacy", "Legacy order-book integration", code="OB-LEGACY", unit=ServiceUnit.FIXED.value,
        price="120000", currency=ccy, active=False,
        description="Retired once the OrderBook v1 schema shipped.", created=-300,
    )
    s.plan(
        "plan-growth", "svc-api", "Platform retainer — Growth", price="45000", currency=ccy,
        units="60", overage="900", created=-240,
    )
    s.plan(
        "plan-annual", "svc-api", "Platform retainer — Annual", interval=PlanInterval.YEARLY.value,
        price="486000", currency=ccy, units="720", overage="900", created=-240,
    )
    s.plan(
        "plan-pack", "svc-eng", "Engineering day pack", price="96000", currency=ccy,
        units="40", overage="2400", trial=14, created=-200,
    )
    s.plan(
        "plan-audit", "svc-audit", "Quarterly pipeline review", interval=PlanInterval.QUARTERLY.value,
        price="5400", currency="EUR", units="2", overage="1800", created=-140,
    )

    # ------------------------------------------------------------ subscriptions
    s.subscription(
        "sub-northwind", price="45000", currency=ccy, started=-182, renews=3,
        plan="plan-growth", company="northwind", invoice="NB-RET-0142",
        notes="The retainer that pays the rent. Renews inside the week.", created=-182,
    )
    s.subscription(
        "sub-kite", price="5400", currency="EUR", started=-120, renews=21,
        interval=PlanInterval.QUARTERLY.value, plan="plan-audit", company="kite",
        invoice="KH-Q3-014", notes="Quarterly review, invoiced with the report.", created=-120,
    )
    s.subscription(
        "sub-solostack", price="240", currency="USD", started=-5, renews=9,
        status=SubscriptionStatus.TRIALING.value, company="solostack",
        notes="Support bundle. The trial converts in nine days.", created=-5,
    )
    s.subscription(
        "sub-bluepeak", price="18000", currency=ccy, started=-240,
        status=SubscriptionStatus.PAUSED.value, company="bluepeak",
        notes="Paused while Bluepeak re-scopes the white-label work.", created=-240,
    )
    s.subscription(
        "sub-vantage", price="120", currency="EUR", started=-300, renews=-40, cancelled=-12,
        status=SubscriptionStatus.CANCELLED.value, company="vantage",
        notes="Cancelled when the EU work moved in-house.", created=-300,
    )

    # ------------------------------------------------------------ expenses
    s.expense(
        "e-rent", "Apartment rent", "42000", ccy, months_ago=1, recurring=True,
        recurrence=ExpenseRecurrence.MONTHLY.value, category="rent", vendor="Northgate Estates",
        notes="Standing order on this day of the month.",
    )
    s.expense(
        "e-insurance", "Health insurance premium", "18500", ccy, paid_on=-61, recurring=True,
        recurrence=ExpenseRecurrence.QUARTERLY.value, category="insurance",
        vendor="Meridian Health", invoice="MH-Q3-8841",
    )
    s.expense(
        "e-tax", "Advance tax — Q3", "65000", ccy, paid_on=-34, category="tax",
        vendor="Income Tax Department", invoice="ADV-Q3-2026",
    )
    s.expense(
        "e-design", "Design tool seats", "4500", ccy, paid_on=-12, recurring=True,
        recurrence=ExpenseRecurrence.MONTHLY.value, category="software", vendor="Pixel Foundry",
    )
    s.expense(
        "e-cloud", "Cloud hosting", "12800", ccy, paid_on=-8, recurring=True,
        recurrence=ExpenseRecurrence.MONTHLY.value, category="software", vendor="SoloStack",
        invoice="SS-HOST-1177",
    )
    s.expense(
        "e-workshop", "Workshop room — Lisbon", "480", "EUR", paid_on=-42, category="travel",
        vendor="Casa Bento", notes="Charged in EUR by the venue.",
    )
    s.expense(
        "e-groceries", "Groceries", "8600", ccy, paid_on=-3, recurring=True,
        recurrence=ExpenseRecurrence.WEEKLY.value, category="food", vendor="Market Road",
    )
    s.expense(
        "e-dinner", "Team dinner", "5400", ccy, paid_on=-15, category="food",
        vendor="Cantina Nord", notes="OrderBook phase-1 wrap.",
    )
    s.expense(
        "e-flights", "Bengaluru–Lisbon flights", "78500", ccy, paid_on=-45, category="travel",
        vendor="Skyline Travel", notes="Two seats for the Kite audit.",
    )
    s.expense(
        "e-transit", "Local transport — Lisbon", "3200", ccy, paid_on=-40, category="travel",
        vendor="Urbano",
    )
    s.expense(
        "e-visa", "Visa fee", "9500", ccy, paid_on=-70, category="travel", vendor="Embassy of Portugal",
    )
    s.expense(
        "e-domains", "Domain renewals", "3400", ccy, paid_on=-95, recurring=True,
        recurrence=ExpenseRecurrence.YEARLY.value, category="other", vendor="SoloStack",
    )
    s.expense(
        "e-accounts", "Accounting retainer", "9000", ccy, paid_on=-120, recurring=True,
        recurrence=ExpenseRecurrence.MONTHLY.value, category="other", vendor="Kite & Co Accountants",
    )
    s.expense(
        "e-gift", "OrderBook v1 launch gifts", "2600", ccy, paid_on=-2, category="other",
        vendor="Northgate Print Shop", notes="One per the Northwind team.",
    )
    s.expense(
        "e-coworking", "Coworking day passes", "6000", ccy, paid_on=-160, category="other",
        vendor="Harbour Works",
    )

    # ------------------------------------------------------------ income transactions
    s.income(
        "i-nw-last", "Northwind retainer — last month", "45000", ccy, received_on=-27,
        service="svc-api", subscription="sub-northwind", invoice="NB-INV-0141",
    )
    # the salary the p-salary profile describes: two paid months so cash_in_90d is a
    # number rather than the floor, which is what makes runway_months meaningful
    s.income("i-sal-last", "Northwind salary — last month", "220000", ccy, received_on=-32)
    s.income("i-sal-this", "Northwind salary — this month", "220000", ccy, received_on=-2)
    s.income(
        "i-nw-over", "Northwind — hours over the cap", "18000", ccy, received_on=-9,
        service="svc-eng", invoice="NB-INV-0142", method=IncomeMethod.UPI.value,
        notes="18 hours beyond the 60 the retainer includes.",
    )
    s.income(
        "i-nw-this", "Northwind retainer — this month", "45000", ccy, received_on=-3,
        status=IncomeStatus.INVOICED.value, service="svc-api", subscription="sub-northwind",
        invoice="NB-INV-0143", notes="Raised on the 1st, Net 15.",
    )
    # the overdue audit invoice carries a full conversion triple, priced at the rate the
    # ledger already holds for EUR→INR on that date (88.90), so §2.3 stays internally true
    s.income(
        "i-kite", "Kite Health — quarterly pipeline review", "5400", "EUR", received_on=-20,
        status=IncomeStatus.OVERDUE.value, service="svc-audit", subscription="sub-kite",
        invoice="KH-Q3-014", notes="Two weeks late; Marco asked for an extension.",
        converted_to=ccy, converted_amount="480060.00", converted_on=-20,
    )
    s.income(
        "i-vantage", "Vantage Labs — audit deposit", "2700", "EUR", received_on=12,
        status=IncomeStatus.EXPECTED.value, service="svc-audit", invoice="VL-AUD-01",
        notes="Due with the Q4 kickoff.",
    )
    s.income(
        "i-bluepeak", "Bluepeak white-label — milestone", "120000", ccy, received_on=7,
        status=IncomeStatus.EXPECTED.value, service="svc-api", invoice="BP-MS-02",
        notes="Payable on the dashboard handoff.",
    )
    s.income(
        "i-sprint", "Northwind — schema review sprint", "96000", ccy, received_on=-130,
        service="svc-eng", invoice="NB-INV-0128",
    )
    s.income(
        "i-sponsor", "OrderBook meetup sponsorship", "1500", "USD", received_on=-18,
        method=IncomeMethod.CARD.value, notes="Sponsored seat for the engineering meetup.",
    )
    s.income(
        "i-waived", "Kite Health — onboarding call", "900", "EUR", received_on=-50,
        status=IncomeStatus.WRITTEN_OFF.value, service="svc-audit",
        notes="Waived when the scope moved.",
    )

    # ------------------------------------------------------------ cost scenarios
    fy = s.scenario(
        "sc-fy", "FY plan — keep OrderBook", currency=ccy, start=0, horizon=12,
        status=ScenarioStatus.ACTIVE.value, profile="p-salary",
        assumptions={"inflation": 0.06, "tax_rate": 0.25},
        notes="The plan the dashboard opens on.", created=-20,
    )
    s.scenario_item(
        "sc-fy", "Northwind retainer", "45000", direction=ScenarioDirection.INCOME.value,
        currency=ccy, starts=0, ends=11,
    )
    s.scenario_item(
        "sc-fy", "Fractional engineering", "60000", direction=ScenarioDirection.INCOME.value,
        currency=ccy, starts=2, ends=11, notes="Starts once the day pack renews.",
    )
    s.scenario_item("sc-fy", "Apartment rent", "42000", currency=ccy, starts=0, category="rent")
    s.scenario_item(
        "sc-fy", "Health insurance premium", "18500", currency=ccy,
        recurrence=ExpenseRecurrence.QUARTERLY.value, starts=0, category="insurance",
    )
    s.scenario_item(
        "sc-fy", "Conference booth", "85000", currency=ccy,
        recurrence=PlanInterval.ONE_TIME.value, starts=3, category="other",
        notes="One-off: the booth that turns the prototype into a product.",
    )
    s.scenario(
        "sc-hire", "Hire a second engineer — what-if", currency=ccy, start=1, horizon=9,
        status=ScenarioStatus.DRAFT.value, assumptions={"inflation": 0.06},
        notes="Modelled before signing anyone.", created=-6,
    )
    s.scenario_item("sc-hire", "Existing retainer", "45000", direction=ScenarioDirection.INCOME.value, currency=ccy, starts=0)
    s.scenario_item("sc-hire", "Contractor salary", "120000", currency=ccy, starts=0)
    s.scenario_item(
        "sc-hire", "Equipment", "65000", currency=ccy,
        recurrence=PlanInterval.ONE_TIME.value, starts=0,
    )

    # ------------------------------------------------------------ finance activity
    # the same rule the API follows: every mutation has a row and a deep link (§4, §7)
    s.activity(
        verb=ActivityVerb.CREATED.value, entity_type="expense", entity_title="Apartment rent",
        entity_id=s.expenses["e-rent"].id, when=-31,
    )
    s.activity(
        verb=ActivityVerb.CREATED.value, entity_type="income",
        entity_title="Northwind retainer — this month", entity_id=s.income_rows["i-nw-this"].id,
        when=-3,
    )
    s.activity(
        verb=ActivityVerb.CREATED.value, entity_type="subscription",
        entity_title=money.subscription_label(s.subscriptions["sub-northwind"]),
        entity_id=s.subscriptions["sub-northwind"].id, when=-182,
    )
    s.activity(
        verb=ActivityVerb.UPDATED.value, entity_type="cost_scenario", entity_title=fy.name,
        entity_id=fy.id, when=-1, summary=f"Activated “{fy.name}”",
    )


# ------------------------------------------------------------------ public entry


def seed(
    session: Session,
    workspace_id: str | None = None,
    *,
    today: dt.date | None = None,
    refresh_notifications: bool = True,
) -> dict[str, Any]:
    """Insert the demo dataset - or the part of it that this database does not have yet.

    ``{ "created": {table: count}, "skipped": bool }`` - API.md ``POST /demo/seed``.

    A database seeded *before* Phase 3 passes the core check and used to answer
    ``skipped: true`` forever, which left its Finance screens empty until a reset - and
    reset is gated behind ``MYOS_ALLOW_DEMO_RESET``. So the skip is now per half: the money
    rows are backfilled on the same call, which is what keeps README's "seed and you have a
    demo" true for an install that predates this phase.
    """
    workspace = context.resolve_workspace(session)
    scope = workspace_id or workspace.id
    core = already_seeded(session, scope)
    if core and finance_seeded(session, scope):
        return {"created": {}, "skipped": True}
    day = today or today_utc()
    seeder = _Seeder(session, scope, day)
    if core:
        _hydrate_clients(seeder)
        _seed_finance(seeder)
    else:
        _seed_dataset(seeder)
    if refresh_notifications:
        result = notifications_service.refresh(session, scope, today=day)
        seeder.counts["notifications"] = int(result["created"])
    session.flush()
    return {"created": dict(sorted(seeder.counts.items())), "skipped": False}


def reset(session: Session, workspace_id: str | None = None, *, today: dt.date | None = None) -> dict[str, Any]:
    """Delete demo rows (``source='demo'``) and reseed. Derived notifications go too.

    Notifications are generated data, so every row for the workspace is cleared and
    rebuilt by the seed; user rows (``source='user'``) are never touched. The three
    finance tables with no ``source`` column (§13) are found by their own marker
    instead, which is why they are cleared here rather than by the loop below.
    """
    workspace = context.resolve_workspace(session)
    scope = workspace_id or workspace.id
    note_ids = list(
        session.scalars(sa.select(Note.id).where(Note.workspace_id == scope, Note.source == Source.DEMO.value))
    )
    task_ids = list(
        session.scalars(sa.select(Task.id).where(Task.workspace_id == scope, Task.source == Source.DEMO.value))
    )
    contact_ids = list(
        session.scalars(sa.select(Contact.id).where(Contact.workspace_id == scope, Contact.source == Source.DEMO.value))
    )
    scenario_ids = list(
        session.scalars(
            sa.select(CostScenario.id).where(
                CostScenario.workspace_id == scope, CostScenario.source == Source.DEMO.value
            )
        )
    )
    removed: dict[str, int] = {}
    if note_ids:
        removed["note_relations"] = int(
            session.execute(sa.delete(NoteRelation).where(NoteRelation.note_id.in_(note_ids))).rowcount or 0
        )
        removed["note_tags"] = int(
            session.execute(sa.delete(note_tags).where(note_tags.c.note_id.in_(note_ids))).rowcount or 0
        )
    if task_ids:
        removed["task_tags"] = int(
            session.execute(sa.delete(task_tags).where(task_tags.c.task_id.in_(task_ids))).rowcount or 0
        )
    if contact_ids:
        removed["contact_tags"] = int(
            session.execute(sa.delete(contact_tags).where(contact_tags.c.contact_id.in_(contact_ids))).rowcount or 0
        )
    if scenario_ids:
        # §13 gives items no `source` either: they are the scenario's own rows
        removed["cost_scenario_items"] = int(
            session.execute(
                sa.delete(CostScenarioItem).where(CostScenarioItem.scenario_id.in_(scenario_ids))
            ).rowcount
            or 0
        )
    # rates: `provider` is the marker, and only the seeder writes 'demo' there
    removed["exchange_rates"] = int(
        session.execute(
            sa.delete(ExchangeRate).where(
                ExchangeRate.workspace_id == scope, ExchangeRate.provider == DEMO_ACTOR
            )
        ).rowcount
        or 0
    )
    # preset categories: a seeded row is the (system_key, name) pair, so a category the
    # user named themselves - or renamed - is never deleted with them
    removed["expense_categories"] = int(
        session.execute(
            sa.delete(ExpenseCategory).where(
                ExpenseCategory.workspace_id == scope,
                sa.or_(
                    *[
                        sa.and_(ExpenseCategory.system_key == key, ExpenseCategory.name == name)
                        for key, name, _kind, _color in expenses_service.PRESET_CATEGORIES
                    ]
                ),
            )
        ).rowcount
        or 0
    )
    # subtasks of demo tasks that were re-parented: detach rather than orphan
    session.execute(
        sa.update(Task).where(Task.parent_task_id.in_(task_ids)).values(parent_task_id=None)
    )
    for model in _DEMO_TABLES:
        removed[model.__tablename__] = int(
            session.execute(
                sa.delete(model).where(model.workspace_id == scope, model.source == Source.DEMO.value)
            ).rowcount
            or 0
        )
    removed["notifications"] = int(
        session.execute(sa.delete(Notification).where(Notification.workspace_id == scope)).rowcount or 0
    )
    removed["activity_logs"] = int(
        session.execute(sa.delete(ActivityLog).where(ActivityLog.actor == DEMO_ACTOR)).rowcount or 0
    )
    # orphan tags are noise: drop the ones nothing references any more
    for tag_id, in list(
        session.execute(
            sa.select(Tag.id).where(
                Tag.workspace_id == scope,
                ~sa.select(sa.literal(1)).where(task_tags.c.tag_id == Tag.id).exists(),
                ~sa.select(sa.literal(1)).where(note_tags.c.tag_id == Tag.id).exists(),
                ~sa.select(sa.literal(1)).where(contact_tags.c.tag_id == Tag.id).exists(),
            )
        )
    ):
        session.execute(sa.delete(Tag).where(Tag.id == tag_id))
        removed["tags"] = removed.get("tags", 0) + 1
    session.flush()
    created = seed(session, scope, today=today)
    return {
        "created": created["created"],
        "skipped": False,
        "deleted": dict(sorted(removed.items())),
    }
