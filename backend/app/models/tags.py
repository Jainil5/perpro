"""Tags and the three many-to-many association tables."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.core.utils import new_id
from app.models.base import ID_COLUMN, TimestampMixin


def _association(table: str, column: str, target: str) -> sa.Table:
    """``<entity>_tags``: composite PK, cascading FKs, indexed on both sides."""
    return sa.Table(
        table,
        Base.metadata,
        sa.Column(
            f"{column}_id",
            ID_COLUMN,
            sa.ForeignKey(f"{column}s.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tag_id",
            ID_COLUMN,
            sa.ForeignKey("tags.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Index(f"ix_{table}_tag_id", "tag_id"),
        comment=f"{target} <-> tags",
    )


task_tags = _association("task_tags", "task", "tasks")
note_tags = _association("note_tags", "note", "notes")
contact_tags = _association("contact_tags", "contact", "contacts")


class Tag(Base, TimestampMixin):
    __tablename__ = "tags"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "name", name="workspace_name"),
        sa.Index("ix_tags_workspace_name", "workspace_id", "name"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: display form, kept as typed (case-insensitive uniqueness is enforced in the service)
    name: Mapped[str] = mapped_column(sa.String(64), nullable=False)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Tag {self.name}>"
