"""Demo seed and reset (``POST /demo/seed``, ``POST /demo/reset``, ``app.cli seed``).

Every row created here is tagged ``source = 'demo'`` (seeded activity rows use
``actor = 'demo'``), which is what makes :func:`reset` safe: it deletes only those
rows and leaves anything the user typed alone. Seeding is idempotent - if demo rows
already exist it does nothing and reports ``skipped: true``.

Dates are all relative to the real ``today``, so the demo always looks like a live
workload: overdue tasks, tasks due today, a recurring chain, subtasks, tags, one
stalled project, one project past its target date, one project without tasks,
milestones landing this week, notes linked to nothing, a goal past its target date
and unread notifications. ``OrderBook CRM`` gets 13 tasks of which 8 are done, so its
``progress`` is 62 - the exact number API.md shows.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.utils import new_id, today_utc
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
    Tag,
    Task,
    contact_tags,
    note_tags,
    task_tags,
)
from app.models.enums import (
    ActivityVerb,
    ContactKind,
    GoalStatus,
    Priority,
    ProjectStatus,
    Recurrence,
    ReminderStatus,
    Source,
    TaskStatus,
)
from app.services import context
from app.services import links
from app.services import notifications as notifications_service

#: ``activity_logs.actor`` for seeded rows - this is what reset keys on
DEMO_ACTOR = "demo"

#: source-tagged tables reset wipes, in a delete-safe order
_DEMO_TABLES: tuple[type, ...] = (Task, Milestone, Note, Project, Contact, Company, Goal, Reminder)


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
    s.company("northwind", "Northwind", website="https://northwind.example", industry="fintech",
              location="Bengaluru", notes="Anchor client. Pays on time, reviews late.")
    s.company("vantage", "Vantage Labs", website="https://vantage.example", industry="saas",
              location="Remote (EU)")
    s.company("kite", "Kite Health", industry="healthcare", location="Lisbon")
    s.company("bluepeak", "Bluepeak Studio", industry="agency", location="Berlin",
              notes="White-label partner for dashboards.")
    s.company("solostack", "SoloStack", industry="developer tools", location=None)

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


# ------------------------------------------------------------------ public entry


def seed(
    session: Session,
    workspace_id: str | None = None,
    *,
    today: dt.date | None = None,
    refresh_notifications: bool = True,
) -> dict[str, Any]:
    """Insert the demo dataset, or skip when it is already there.

    ``{ "created": {table: count}, "skipped": bool }`` - API.md ``POST /demo/seed``.
    """
    workspace = context.resolve_workspace(session)
    scope = workspace_id or workspace.id
    if already_seeded(session, scope):
        return {"created": {}, "skipped": True}
    day = today or today_utc()
    seeder = _Seeder(session, scope, day)
    _seed_dataset(seeder)
    if refresh_notifications:
        result = notifications_service.refresh(session, scope, today=day)
        seeder.counts["notifications"] = int(result["created"])
    session.flush()
    return {"created": dict(sorted(seeder.counts.items())), "skipped": False}


def reset(session: Session, workspace_id: str | None = None, *, today: dt.date | None = None) -> dict[str, Any]:
    """Delete demo rows (``source='demo'``) and reseed. Derived notifications go too.

    Notifications are generated data, so every row for the workspace is cleared and
    rebuilt by the seed; user rows (``source='user'``) are never touched.
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
