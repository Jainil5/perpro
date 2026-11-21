"""Tasks (including subtasks via a self FK) and task dependencies."""

from __future__ import annotations

import datetime as dt

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.core.utils import new_id
from app.models.base import (
    ID_COLUMN,
    SourceMixin,
    TimestampMixin,
    enum_check,
    non_negative,
)
from app.models.enums import Priority, Recurrence, TaskStatus
from app.models.projects import Project
from app.models.tags import task_tags


class Task(Base, TimestampMixin, SourceMixin):
    __tablename__ = "tasks"
    __table_args__ = (
        enum_check("status", "task.status"),
        enum_check("priority", "priority"),
        enum_check("recurrence", "task.recurrence"),
        non_negative("estimated_minutes"),
        non_negative("actual_minutes"),
        non_negative("position"),
        sa.Index("ix_tasks_workspace_status", "workspace_id", "status"),
        sa.Index("ix_tasks_workspace_due_date", "workspace_id", "due_date"),
        sa.Index("ix_tasks_workspace_priority", "workspace_id", "priority"),
        sa.Index("ix_tasks_project_status", "project_id", "status"),
        sa.Index("ix_tasks_project_position", "project_id", "position"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # kept (SET NULL) when the project is deleted - API.md "Cascade: tasks become
    # project_id = null (they are *kept*)"
    project_id: Mapped[str | None] = mapped_column(
        ID_COLUMN, sa.ForeignKey("projects.id", ondelete="SET NULL"), index=True
    )
    parent_task_id: Mapped[str | None] = mapped_column(
        ID_COLUMN, sa.ForeignKey("tasks.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(sa.Text)
    notes: Mapped[str | None] = mapped_column(sa.Text)
    status: Mapped[str] = mapped_column(sa.String(16), nullable=False, default=TaskStatus.TODO.value)
    priority: Mapped[str] = mapped_column(sa.String(12), nullable=False, default=Priority.MEDIUM.value)
    due_date: Mapped[dt.date | None] = mapped_column(sa.Date, index=True)
    start_date: Mapped[dt.date | None] = mapped_column(sa.Date)
    estimated_minutes: Mapped[int | None] = mapped_column(sa.Integer)
    actual_minutes: Mapped[int | None] = mapped_column(sa.Integer)
    recurrence: Mapped[str] = mapped_column(sa.String(16), nullable=False, default=Recurrence.NONE.value)
    #: kanban ordering inside (project_id, status); lower first
    position: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    completed_at: Mapped[dt.datetime | None] = mapped_column(sa.DateTime(timezone=True))

    project: Mapped[Project | None] = relationship(back_populates="tasks")
    parent: Mapped["Task | None"] = relationship(
        "Task", remote_side="Task.id", back_populates="children"
    )
    children: Mapped[list["Task"]] = relationship(
        "Task", back_populates="parent", cascade="save-update, merge", passive_deletes=True
    )
    tags: Mapped[list["Tag"]] = relationship(  # noqa: F821
        "Tag", secondary=task_tags, lazy="selectin", order_by="Tag.name"
    )

    @property
    def is_open(self) -> bool:
        return self.status in TaskStatus.open_values()

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Task {self.title}:{self.status}>"


class TaskDependency(Base, TimestampMixin):
    __tablename__ = "task_dependencies"
    __table_args__ = (
        sa.UniqueConstraint("task_id", "depends_on_task_id", name="task_pair"),
        sa.CheckConstraint("task_id <> depends_on_task_id", name="not_self"),
        enum_check("type", "task_dependency.type"),
        sa.Index("ix_task_dependencies_depends_on", "depends_on_task_id"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    task_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    depends_on_task_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(sa.String(24), nullable=False, default="finish_to_start")
    lag_days: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)

    task: Mapped[Task] = relationship("Task", foreign_keys=[task_id])
    depends_on: Mapped[Task] = relationship("Task", foreign_keys=[depends_on_task_id])
