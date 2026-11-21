"""Notes and their polymorphic relations (the knowledge graph)."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.core.utils import new_id
from app.models.base import ID_COLUMN, SourceMixin, TimestampMixin, enum_check
from app.models.enums import NoteCategory
from app.models.projects import Project
from app.models.tags import note_tags


class Note(Base, TimestampMixin, SourceMixin):
    __tablename__ = "notes"
    __table_args__ = (
        enum_check("category", "note.category"),
        sa.Index("ix_notes_workspace_category", "workspace_id", "category"),
        sa.Index("ix_notes_workspace_updated", "workspace_id", "updated_at"),
        sa.Index("ix_notes_workspace_favorite", "workspace_id", "is_favorite"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: soft link to a project; SET NULL keeps the note when the project is deleted
    project_id: Mapped[str | None] = mapped_column(
        ID_COLUMN, sa.ForeignKey("projects.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    content: Mapped[str | None] = mapped_column(sa.Text)
    category: Mapped[str] = mapped_column(
        sa.String(24), nullable=False, default=NoteCategory.PERSONAL.value
    )
    is_favorite: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    #: denormalised copy of ``len(plain_text(content).split())`` for cheap list sorting
    word_count: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=0)

    project: Mapped[Project | None] = relationship()
    tags: Mapped[list["Tag"]] = relationship(  # noqa: F821
        "Tag", secondary=note_tags, lazy="selectin", order_by="Tag.name"
    )
    relations: Mapped[list["NoteRelation"]] = relationship(
        back_populates="note", cascade="all, delete-orphan", lazy="selectin"
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Note {self.title}:{self.category}>"


class NoteRelation(Base, TimestampMixin):
    """Polymorphic edge: this note -> any other entity (``target_type``/``target_id``)."""

    __tablename__ = "note_relations"
    __table_args__ = (
        sa.UniqueConstraint("note_id", "target_type", "target_id", name="note_target"),
        enum_check("target_type", "note_relation.target_type"),
        sa.Index("ix_note_relations_target", "target_type", "target_id"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    note_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("notes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: one of ENUMS["note_relation.target_type"]; there is no FK because the target
    #: type is chosen per row (task | note | project | milestone | contact | company | goal)
    target_type: Mapped[str] = mapped_column(sa.String(24), nullable=False)
    target_id: Mapped[str] = mapped_column(ID_COLUMN, nullable=False)
    #: free-form label of the edge, e.g. "documents" / "decision for"
    label: Mapped[str | None] = mapped_column(sa.String(64))
    created_by: Mapped[str | None] = mapped_column(ID_COLUMN)

    note: Mapped[Note] = relationship(back_populates="relations")

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<NoteRelation {self.note_id}->{self.target_type}:{self.target_id}>"
