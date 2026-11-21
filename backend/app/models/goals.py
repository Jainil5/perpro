"""Goals: measurable outcomes with progress and a target date."""

from __future__ import annotations

import datetime as dt

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.core.utils import new_id
from app.models.base import ID_COLUMN, SourceMixin, TimestampMixin, enum_check, range_check
from app.models.enums import GoalStatus, Priority
from app.models.projects import Project


class Goal(Base, TimestampMixin, SourceMixin):
    __tablename__ = "goals"
    __table_args__ = (
        enum_check("status", "goal.status"),
        enum_check("priority", "priority"),
        range_check("progress", 0, 100),
        sa.Index("ix_goals_workspace_status", "workspace_id", "status"),
        sa.Index("ix_goals_workspace_target_date", "workspace_id", "target_date"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: the project this goal serves; deleting the project detaches the goal (SET NULL)
    project_id: Mapped[str | None] = mapped_column(
        ID_COLUMN, sa.ForeignKey("projects.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(sa.Text)
    category: Mapped[str | None] = mapped_column(sa.String(64))
    priority: Mapped[str] = mapped_column(sa.String(12), nullable=False, default=Priority.MEDIUM.value)
    status: Mapped[str] = mapped_column(sa.String(16), nullable=False, default=GoalStatus.ACTIVE.value)
    #: 0..100, maintained by the owner (task roll-ups arrive with a later phase)
    progress: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)
    target_date: Mapped[dt.date | None] = mapped_column(sa.Date)
    completed_at: Mapped[dt.datetime | None] = mapped_column(sa.DateTime(timezone=True))

    project: Mapped[Project | None] = relationship(back_populates="goals")

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Goal {self.title}:{self.progress}>"
