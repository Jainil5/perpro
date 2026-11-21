"""Projects and milestones."""

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
    range_check,
)
from app.models.enums import Priority, ProjectStatus


class Project(Base, TimestampMixin, SourceMixin):
    __tablename__ = "projects"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "slug", name="workspace_slug"),
        enum_check("status", "project.status"),
        enum_check("priority", "priority"),
        range_check("manual_progress", 0, 100),
        sa.Index("ix_projects_workspace_status", "workspace_id", "status"),
        sa.Index("ix_projects_workspace_priority", "workspace_id", "priority"),
        sa.Index("ix_projects_workspace_target_date", "workspace_id", "target_date"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(160), nullable=False)
    slug: Mapped[str] = mapped_column(sa.String(180), nullable=False)
    description: Mapped[str | None] = mapped_column(sa.Text)
    category: Mapped[str | None] = mapped_column(sa.String(64))
    status: Mapped[str] = mapped_column(
        sa.String(24), nullable=False, default=ProjectStatus.BACKLOG.value
    )
    priority: Mapped[str] = mapped_column(sa.String(12), nullable=False, default=Priority.MEDIUM.value)
    start_date: Mapped[dt.date | None] = mapped_column(sa.Date)
    target_date: Mapped[dt.date | None] = mapped_column(sa.Date)
    repository_url: Mapped[str | None] = mapped_column(sa.String(500))
    documentation_url: Mapped[str | None] = mapped_column(sa.String(500))
    next_action: Mapped[str | None] = mapped_column(sa.String(300))
    manual_progress: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)

    milestones: Mapped[list["Milestone"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", passive_deletes=True
    )
    tasks: Mapped[list["Task"]] = relationship(  # noqa: F821
        back_populates="project", passive_deletes=True
    )
    goals: Mapped[list["Goal"]] = relationship(  # noqa: F821
        back_populates="project", passive_deletes=True
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Project {self.slug}:{self.status}>"


class Milestone(Base, TimestampMixin, SourceMixin):
    __tablename__ = "milestones"
    __table_args__ = (
        enum_check("status", "milestone.status"),
        sa.Index("ix_milestones_workspace_date", "workspace_id", "date"),
        sa.Index("ix_milestones_project_status", "project_id", "status"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(sa.Text)
    date: Mapped[dt.date] = mapped_column(sa.Date, nullable=False)
    status: Mapped[str] = mapped_column(sa.String(12), nullable=False, default="open")
    completed_at: Mapped[dt.datetime | None] = mapped_column(sa.DateTime(timezone=True))

    project: Mapped[Project] = relationship(back_populates="milestones")

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Milestone {self.title} ({self.date})>"
