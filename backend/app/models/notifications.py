"""Derived notifications, made idempotent by ``dedupe_key``."""

from __future__ import annotations

import datetime as dt

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.utils import new_id
from app.models.base import ID_COLUMN, TimestampMixin, enum_check
from app.models.enums import Severity


class Notification(Base, TimestampMixin):
    __tablename__ = "notifications"
    __table_args__ = (
        enum_check("kind", "notification.kind"),
        enum_check("severity", "notification.severity"),
        sa.UniqueConstraint("dedupe_key", name="dedupe_key"),
        sa.Index("ix_notifications_workspace_read_created", "workspace_id", "read", "created_at"),
        sa.Index("ix_notifications_workspace_kind", "workspace_id", "kind"),
        sa.Index("ix_notifications_entity", "entity_type", "entity_id"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    severity: Mapped[str] = mapped_column(sa.String(12), nullable=False, default=Severity.INFO.value)
    title: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(sa.Text)
    entity_type: Mapped[str | None] = mapped_column(sa.String(24))
    entity_id: Mapped[str | None] = mapped_column(ID_COLUMN)
    href: Mapped[str | None] = mapped_column(sa.String(300))
    read: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    read_at: Mapped[dt.datetime | None] = mapped_column(sa.DateTime(timezone=True))
    #: stable identity of the *condition* (e.g. "task_overdue:<project_id>"); a refresh
    #: updates the open row instead of creating a second one and clears it once gone
    dedupe_key: Mapped[str] = mapped_column(sa.String(160), nullable=False)
    resolved_at: Mapped[dt.datetime | None] = mapped_column(sa.DateTime(timezone=True))

    @property
    def is_open(self) -> bool:
        return self.resolved_at is None

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Notification {self.kind}:{self.dedupe_key}>"
