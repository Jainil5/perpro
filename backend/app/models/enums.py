"""Canonical enumerations (API.md "Enumerations").

Each enum is stored as plain text with a database ``CHECK`` constraint built from
:data:`ENUMS`, so the values in API.md are the values in the schema. ``/meta``
serves the same structures, which makes it the frontend's single source of truth.
"""

from __future__ import annotations

from enum import StrEnum

from app.core.currencies import CODES as CURRENCY_CODES


class ProjectStatus(StrEnum):
    BACKLOG = "backlog"
    PLANNING = "planning"
    IN_PROGRESS = "in_progress"
    ON_HOLD = "on_hold"
    REVIEW = "review"
    COMPLETED = "completed"
    ARCHIVED = "archived"

    @classmethod
    def terminal(cls) -> frozenset[str]:
        """Statuses that always report 100 % progress."""
        return frozenset({cls.COMPLETED, cls.ARCHIVED})


class TaskStatus(StrEnum):
    TODO = "todo"
    IN_PROGRESS = "in_progress"
    BLOCKED = "blocked"
    DONE = "done"
    DROPPED = "dropped"

    @classmethod
    def open_values(cls) -> tuple[str, ...]:
        """Not finished, not dropped: the set that can be overdue."""
        return (cls.TODO, cls.IN_PROGRESS, cls.BLOCKED)


class Priority(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"

    @classmethod
    def rank(cls) -> dict[str, int]:
        """Ascending rank, used by ``sort=priority`` (urgent first)."""
        return {cls.URGENT: 0, cls.HIGH: 1, cls.MEDIUM: 2, cls.LOW: 3}


class Recurrence(StrEnum):
    NONE = "none"
    DAILY = "daily"
    WEEKLY = "weekly"
    FORTNIGHTLY = "fortnightly"
    MONTHLY = "monthly"


class NoteCategory(StrEnum):
    TECHNICAL = "technical"
    AI_ML = "ai_ml"
    BUSINESS_IDEA = "business_idea"
    MEETING = "meeting"
    PROJECT_DOC = "project_doc"
    LEARNING = "learning"
    STARTUP = "startup"
    PERSONAL = "personal"
    RESOURCE = "resource"


class MilestoneStatus(StrEnum):
    OPEN = "open"
    DONE = "done"


class NotificationKind(StrEnum):
    TASK_OVERDUE = "task_overdue"
    TASK_DUE = "task_due"
    MILESTONE = "milestone"
    REMINDER = "reminder"
    PROJECT_STALLED = "project_stalled"
    SYSTEM = "system"
    # Phase 3 — Finance (PHASE3_FINANCE.md §6)
    SUBSCRIPTION_RENEWING = "subscription_renewing"
    EXPENSE_RECURRING_DUE = "expense_recurring_due"
    INCOME_OVERDUE = "income_overdue"
    RATE_STALE = "rate_stale"


class Severity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"

    @classmethod
    def rank(cls) -> dict[str, int]:
        return {cls.CRITICAL: 0, cls.WARNING: 1, cls.INFO: 2}


class ActivityVerb(StrEnum):
    CREATED = "created"
    UPDATED = "updated"
    COMPLETED = "completed"
    REOPENED = "reopened"
    DELETED = "deleted"
    COMMENTED = "commented"
    MOVED = "moved"


class ReminderStatus(StrEnum):
    PENDING = "pending"
    DONE = "done"


class GoalStatus(StrEnum):
    ACTIVE = "active"
    COMPLETED = "completed"
    ABANDONED = "abandoned"


class ContactKind(StrEnum):
    CLIENT = "client"
    PROSPECT = "prospect"
    PARTNER = "partner"
    VENDOR = "vendor"
    MENTOR = "mentor"
    PERSONAL = "personal"
    OTHER = "other"


class MemberRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"
    VIEWER = "viewer"


# --- Phase 3: Finance (PHASE3_FINANCE.md §5) ------------------------------------
# Values are the documented set and nothing else; the dotted ``ENUMS`` keys below
# are what /meta serves and what the ``Choice`` schemas bind to.


class IncomeKind(StrEnum):
    SALARY = "salary"
    FREELANCE = "freelance"
    CONTRACT = "contract"
    BUSINESS = "business"
    MIXED = "mixed"


class TaxRegime(StrEnum):
    NONE = "none"
    FLAT = "flat"
    SLAB = "slab"
    PRESUMPTIVE = "presumptive"


class ServiceUnit(StrEnum):
    HOUR = "hour"
    DAY = "day"
    FIXED = "fixed"
    RETAINER = "retainer"
    SEAT = "seat"


class PlanInterval(StrEnum):
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    YEARLY = "yearly"
    ONE_TIME = "one_time"

    @classmethod
    def recurring(cls) -> tuple[str, ...]:
        """Intervals that have a monthly equivalent — ``one_time`` does not (§3)."""
        return (cls.MONTHLY, cls.QUARTERLY, cls.YEARLY)


class SubscriptionStatus(StrEnum):
    TRIALING = "trialing"
    ACTIVE = "active"
    PAUSED = "paused"
    CANCELLED = "cancelled"
    EXPIRED = "expired"

    @classmethod
    def live(cls) -> frozenset[str]:
        """Statuses that still bill: a paused/cancelled/expired row renews for nobody."""
        return frozenset({cls.TRIALING, cls.ACTIVE})


class ExpenseCategoryKind(StrEnum):
    FIXED = "fixed"
    VARIABLE = "variable"
    ONE_OFF = "one_off"
    TAX = "tax"


class ExpenseRecurrence(StrEnum):
    """Same spirit as ``task.recurrence``, its own value set (no daily/fortnightly bills)."""

    NONE = "none"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    YEARLY = "yearly"


class IncomeStatus(StrEnum):
    EXPECTED = "expected"
    INVOICED = "invoiced"
    PAID = "paid"
    OVERDUE = "overdue"
    WRITTEN_OFF = "written_off"

    @classmethod
    def receivable(cls) -> frozenset[str]:
        """Money owed but not lost: invoiced or overdue."""
        return frozenset({cls.INVOICED, cls.OVERDUE})


class IncomeMethod(StrEnum):
    BANK = "bank"
    CARD = "card"
    UPI = "upi"
    CASH = "cash"
    CRYPTO = "crypto"
    OTHER = "other"


class ScenarioKind(StrEnum):
    PERSONAL = "personal"
    BUSINESS = "business"
    HYBRID = "hybrid"


class ScenarioStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


class ScenarioDirection(StrEnum):
    INCOME = "income"
    COST = "cost"


class Source(StrEnum):
    """Where a row came from. ``demo`` rows are the only ones /demo/reset wipes."""

    USER = "user"
    DEMO = "demo"
    IMPORT = "import"
    AI = "ai"


class RelationType(StrEnum):
    """Polymorphic target of ``note_relations``."""

    TASK = "task"
    NOTE = "note"
    PROJECT = "project"
    MILESTONE = "milestone"
    CONTACT = "contact"
    COMPANY = "company"
    GOAL = "goal"


class DependencyType(StrEnum):
    FINISH_TO_START = "finish_to_start"
    START_TO_FINISH = "start_to_finish"
    FINISH_TO_FINISH = "finish_to_finish"
    START_TO_START = "start_to_start"


#: enum key -> values, exactly as documented in API.md (keys keep their dotted form).
ENUMS: dict[str, list[str]] = {
    "project.status": [e.value for e in ProjectStatus],
    "task.status": [e.value for e in TaskStatus],
    "priority": [e.value for e in Priority],
    "task.recurrence": [e.value for e in Recurrence],
    "note.category": [e.value for e in NoteCategory],
    "notification.kind": [e.value for e in NotificationKind],
    "activity.verb": [e.value for e in ActivityVerb],
    # extras required by the Phase 1 endpoints (documented in DATA_MODEL.md)
    "milestone.status": [e.value for e in MilestoneStatus],
    "reminder.status": [e.value for e in ReminderStatus],
    "notification.severity": [e.value for e in Severity],
    "goal.status": [e.value for e in GoalStatus],
    "contact.kind": [e.value for e in ContactKind],
    "member.role": [e.value for e in MemberRole],
    "source": [e.value for e in Source],
    "note_relation.target_type": [e.value for e in RelationType],
    "task_dependency.type": [e.value for e in DependencyType],
    # Phase 3 — Finance
    "income.kind": [e.value for e in IncomeKind],
    "tax.regime": [e.value for e in TaxRegime],
    "service.unit": [e.value for e in ServiceUnit],
    "plan.interval": [e.value for e in PlanInterval],
    "subscription.status": [e.value for e in SubscriptionStatus],
    "expense.category.kind": [e.value for e in ExpenseCategoryKind],
    "expense.recurrence": [e.value for e in ExpenseRecurrence],
    "income.status": [e.value for e in IncomeStatus],
    "income.method": [e.value for e in IncomeMethod],
    "scenario.kind": [e.value for e in ScenarioKind],
    "scenario.status": [e.value for e in ScenarioStatus],
    "scenario.item.direction": [e.value for e in ScenarioDirection],
    # §13 gives this column no CHECK either, so the enforced set is declared here:
    # an item's cadence is an expense recurrence plus `one_time` (services/scenarios.py)
    "scenario.item.recurrence": [
        *[e.value for e in ExpenseRecurrence],
        PlanInterval.ONE_TIME.value,
    ],
    # served for form dropdowns; validated in the service, never a CHECK (§5)
    "currency.code": list(CURRENCY_CODES),
}


def in_enum(name: str, value: str) -> bool:
    return value in ENUMS.get(name, ())
