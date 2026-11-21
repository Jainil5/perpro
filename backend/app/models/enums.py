"""Canonical enumerations (API.md "Enumerations").

Each enum is stored as plain text with a database ``CHECK`` constraint built from
:data:`ENUMS`, so the values in API.md are the values in the schema. ``/meta``
serves the same structures, which makes it the frontend's single source of truth.
"""

from __future__ import annotations

from enum import StrEnum


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
}


def in_enum(name: str, value: str) -> bool:
    return value in ENUMS.get(name, ())
