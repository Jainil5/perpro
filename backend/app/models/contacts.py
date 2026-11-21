"""People: contacts and companies."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.core.utils import new_id
from app.models.base import ID_COLUMN, SourceMixin, TimestampMixin, enum_check
from app.models.enums import ContactKind
from app.models.tags import contact_tags


class Company(Base, TimestampMixin, SourceMixin):
    __tablename__ = "companies"
    __table_args__ = (
        sa.Index("ix_companies_workspace_name", "workspace_id", "name"),
        sa.Index("ix_companies_workspace_industry", "workspace_id", "industry"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(160), nullable=False)
    website: Mapped[str | None] = mapped_column(sa.String(500))
    industry: Mapped[str | None] = mapped_column(sa.String(80))
    location: Mapped[str | None] = mapped_column(sa.String(120))
    notes: Mapped[str | None] = mapped_column(sa.Text)

    contacts: Mapped[list["Contact"]] = relationship(back_populates="company")

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Company {self.name}>"


class Contact(Base, TimestampMixin, SourceMixin):
    __tablename__ = "contacts"
    __table_args__ = (
        enum_check("kind", "contact.kind"),
        sa.Index("ix_contacts_workspace_name", "workspace_id", "name"),
        sa.Index("ix_contacts_workspace_kind", "workspace_id", "kind"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(160), nullable=False)
    email: Mapped[str | None] = mapped_column(sa.String(255))
    phone: Mapped[str | None] = mapped_column(sa.String(40))
    title: Mapped[str | None] = mapped_column(sa.String(120))
    # contacts are kept when their company is deleted (SET NULL)
    company_id: Mapped[str | None] = mapped_column(
        ID_COLUMN, sa.ForeignKey("companies.id", ondelete="SET NULL"), index=True
    )
    location: Mapped[str | None] = mapped_column(sa.String(120))
    kind: Mapped[str] = mapped_column(sa.String(24), nullable=False, default=ContactKind.OTHER.value)
    notes: Mapped[str | None] = mapped_column(sa.Text)

    company: Mapped[Company | None] = relationship(back_populates="contacts")
    tags: Mapped[list["Tag"]] = relationship(  # noqa: F821
        "Tag", secondary=contact_tags, lazy="selectin", order_by="Tag.name"
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Contact {self.name}:{self.kind}>"
