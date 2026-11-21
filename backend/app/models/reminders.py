"""Reminders: a point in time attached to an entity."""

from __future__ import annotations

import datetime as dt

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.utils import new_id
from app.models.base import ID_COLUMN, SourceMixin, TimestampMixin, enum_check
from app.models.enums import ReminderStatus


class Reminder(Base, TimestampMixin, SourceMixin):
    __tablename__ = "reminders"
    __table_args__ = (
        enum_check("status", "reminder.status"),
        sa.Index("ix_reminders_workspace_status_due", "workspace_id", "status", "due_at"),
        sa.Index("ix_reminders_entity", "entity_type", "entity_id"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    due_at: Mapped[dt.datetime | None] = mapped_column(sa.DateTime(timezone=True))
    status: Mapped[str] = mapped_column(sa.String(12), nullable=False, default=ReminderStatus.PENDING.value)
    #: soft link to whatever the reminder is about (task | project | note | contact | goal)
    entity_type: Mapped[str | None] = mapped_column(sa.String(24))
    entity_id: Mapped[str | None] = mapped_column(ID_COLUMN)
    notes: Mapped[str | None] = mapped_column(sa.Text)
    snoozed_until: Mapped[dt.datetime | None] = mapped_column(sa.DateTime(timezone=True))
    completed_at: Mapped[dt.datetime | None] = mapped_column(sa.DateTime(timezone=True))

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Reminder {self.title} @ {self.due_at}>"
