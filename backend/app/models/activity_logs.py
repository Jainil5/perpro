"""The append-only activity log written by every mutating endpoint."""

from __future__ import annotations

import datetime as dt

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.utils import new_id
from app.models.base import ID_COLUMN, TimestampMixin, enum_check
from app.models.enums import ActivityVerb


class ActivityLog(Base, TimestampMixin):
    __tablename__ = "activity_logs"
    __table_args__ = (
        enum_check("verb", "activity.verb"),
        sa.Index("ix_activity_logs_workspace_created", "workspace_id", "created_at"),
        sa.Index("ix_activity_logs_workspace_project", "workspace_id", "project_id"),
        sa.Index("ix_activity_logs_entity", "entity_type", "entity_id"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    verb: Mapped[str] = mapped_column(sa.String(16), nullable=False, default=ActivityVerb.CREATED.value)
    entity_type: Mapped[str] = mapped_column(sa.String(24), nullable=False)
    #: soft reference - the target row may be deleted later, history must survive
    entity_id: Mapped[str | None] = mapped_column(ID_COLUMN)
    entity_title: Mapped[str | None] = mapped_column(sa.String(200))
    summary: Mapped[str | None] = mapped_column(sa.String(300))
    #: no FK on purpose: a deleted project must not take its history with it
    project_id: Mapped[str | None] = mapped_column(ID_COLUMN, index=True)
    href: Mapped[str | None] = mapped_column(sa.String(300))
    actor: Mapped[str] = mapped_column(sa.String(64), nullable=False, default="owner")
    #: arbitrary per-verb payload, e.g. {"status": "in_progress"} for a move
    payload: Mapped[dict | None] = mapped_column(sa.JSON, default=dict)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<ActivityLog {self.verb} {self.entity_type}:{self.entity_id}>"
