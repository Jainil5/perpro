"""Tenancy: workspaces, users and memberships."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.core.utils import new_id
from app.models.base import ID_COLUMN, TimestampMixin, enum_check
from app.models.enums import MemberRole


class Workspace(Base, TimestampMixin):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    slug: Mapped[str] = mapped_column(sa.String(64), nullable=False, unique=True, index=True)
    timezone: Mapped[str] = mapped_column(sa.String(64), nullable=False, default="Asia/Kolkata")
    currency: Mapped[str] = mapped_column(sa.String(8), nullable=False, default="INR")

    members: Mapped[list["WorkspaceMember"]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan", lazy="selectin"
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Workspace {self.slug}>"


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(sa.String(255), nullable=False, unique=True, index=True)
    display_name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    timezone: Mapped[str | None] = mapped_column(sa.String(64))
    avatar_url: Mapped[str | None] = mapped_column(sa.String(500))

    memberships: Mapped[list["WorkspaceMember"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<User {self.email}>"


class WorkspaceMember(Base, TimestampMixin):
    __tablename__ = "workspace_members"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "user_id", name="workspace_user"),
        enum_check("role", "member.role"),
        sa.Index("ix_workspace_members_user_role", "user_id", "role"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(sa.String(16), nullable=False, default=MemberRole.OWNER.value)

    workspace: Mapped[Workspace] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="memberships")
