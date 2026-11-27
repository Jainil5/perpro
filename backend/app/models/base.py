"""Model building blocks shared by every table."""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterable

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from app.core.utils import new_id, now_utc
from app.models.enums import ENUMS

#: string UUID4 primary keys, as mandated by API.md ("all ids are server-generated UUID4")
ID_COLUMN = sa.String(36)


class TimestampMixin:
    """``created_at`` / ``updated_at`` on every table (API.md response rule 3).

    The defaults call ``now_utc()`` through a lambda rather than passing the function
    object: a captured reference would outrank the module-level seam it came from, and the
    test clock (``tests/frozen_clock.py``) replaces that seam, not the object.
    """

    created_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, default=lambda: now_utc()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True), nullable=False, default=lambda: now_utc(), onupdate=lambda: now_utc()
    )


class SourceMixin:
    """``user`` | ``demo`` | ``import`` | ``ai`` — /demo/reset only wipes ``demo``."""

    source: Mapped[str] = mapped_column(
        sa.String(16),
        nullable=False,
        default="user",
        index=True,
        comment="origin of the row; 'demo' rows are the only ones /demo/reset removes",
    )


def enum_check(column: str, enum_key: str) -> sa.CheckConstraint:
    """CHECK constraint pinning ``column`` to the documented values of ``enum_key``.

    Named through the metadata naming convention, i.e. ``ck_<table>_<column>``.
    """
    return in_check(column, column, ENUMS[enum_key])


def in_check(column: str, name: str, values: Iterable[str]) -> sa.CheckConstraint:
    joined = ", ".join(f"'{value}'" for value in values)
    return sa.CheckConstraint(f"{column} IN ({joined})", name=name)


def range_check(column: str, low: int, high: int) -> sa.CheckConstraint:
    """``ck_<table>_<column>_range`` — used for the 0..100 progress columns."""
    return sa.CheckConstraint(f"{column} BETWEEN {low} AND {high}", name=f"{column}_range")


def non_negative(column: str) -> sa.CheckConstraint:
    """``ck_<table>_<column>_non_negative`` — minutes / position / counts."""
    return sa.CheckConstraint(f"{column} >= 0", name=f"{column}_non_negative")
