"""All ORM models, imported here so ``Base.metadata`` is complete.

Alembic's ``env.py`` and ``app.core.db.init_db`` import this module; nothing else
should import models one by one. ``__all__`` is the contract: a phase adds its
models here and a migration next to it.
"""

from __future__ import annotations

from app.models.activity_logs import ActivityLog
from app.models.base import (
    ID_COLUMN,
    SourceMixin,
    TimestampMixin,
    enum_check,
    in_check,
    non_negative,
    range_check,
)
from app.models.contacts import Company, Contact
from app.models.goals import Goal
from app.models.notes import Note, NoteRelation
from app.models.notifications import Notification
from app.models.projects import Milestone, Project
from app.models.reminders import Reminder
from app.models.tags import Tag, contact_tags, note_tags, task_tags
from app.models.tasks import Task, TaskDependency
from app.models.workspace import User, Workspace, WorkspaceMember

__all__ = [
    # tenancy
    "Workspace",
    "User",
    "WorkspaceMember",
    # work
    "Project",
    "Milestone",
    "Task",
    "TaskDependency",
    "Tag",
    "task_tags",
    "note_tags",
    "contact_tags",
    # knowledge
    "Note",
    "NoteRelation",
    # people
    "Company",
    "Contact",
    # outcomes & signals
    "Goal",
    "Reminder",
    "Notification",
    "ActivityLog",
    # building blocks
    "ID_COLUMN",
    "TimestampMixin",
    "SourceMixin",
    "enum_check",
    "in_check",
    "range_check",
    "non_negative",
]

#: table name -> model, used by /export and the CLI
TABLE_MODELS: dict[str, type] = {
    Model.__tablename__: Model  # type: ignore[misc]
    for Model in (
        Workspace,
        User,
        WorkspaceMember,
        Project,
        Milestone,
        Task,
        TaskDependency,
        Tag,
        Note,
        NoteRelation,
        Company,
        Contact,
        Goal,
        Reminder,
        Notification,
        ActivityLog,
    )
}
