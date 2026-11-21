"""Shared router dependencies: session, workspace scope, ``today``, enum queries.

Routers stay thin (ARCHITECTURE.md §3): they resolve the request context here, call a
service and hand the payload to a response model. No SQL and no rules live in a router.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Callable, Sequence
from typing import Annotated, Any

from fastapi import Depends, Query
from sqlalchemy.orm import Session

from app.core.db import get_session
from app.core.errors import field_error, validation
from app.models.enums import ENUMS
from app.services import context, serializers

#: one unit of work per request (commit on success, rollback on error)
DbSession = Annotated[Session, Depends(get_session)]


def workspace_scope(session: DbSession) -> str:
    """The id of the single Phase 1 workspace (created on first touch)."""
    return context.resolve_workspace(session).id


WorkspaceScope = Annotated[str, Depends(workspace_scope)]


def today_param(
    today: Annotated[
        dt.date | None,
        Query(description="YYYY-MM-DD; lets the whole API be tested without clock mocking"),
    ] = None,
) -> dt.date:
    return serializers.resolve_today(today)


Today = Annotated[dt.date, Depends(today_param)]


def enum_param(enum_key: str, field: str) -> Any:
    """Optional, enum-pinned query parameter: ``?status=nonsense`` is a 422.

    Blanks count as absent (``?status=`` behaves like no filter) and the usual
    casing/separator normalisation applies, matching the request-body rules.
    """
    return value_param(ENUMS[enum_key], field, default=None, unit=enum_key)


def value_param(
    allowed: Sequence[str], field: str, *, default: Any = None, unit: str | None = None
) -> Any:
    """Query parameter pinned to a fixed set of literal values (filters and sorts).

    ``default`` is returned when the parameter is absent or blank; ``None`` means
    "no filter". Anything outside ``allowed`` raises a 422 with the field detail.
    """
    label = unit or field
    options = tuple(allowed)

    def resolve(value: str | None = Query(default=None, alias=field)) -> Any:
        if value is None or not value.strip():
            return default
        candidate = value.strip().lower().replace("-", "_").replace(" ", "_")
        if candidate not in options:
            raise validation(
                f"{field} must be one of: {', '.join(options)}",
                [field_error(["query", field], f"'{value}' is not a valid {label}")],
            )
        return candidate

    depends: Callable[..., Any] = Depends(resolve)
    return depends


#: sort keys, per endpoint family (API.md `sort=updated|target|name` etc.)
def sort_param(*allowed: str, default: str, field: str = "sort") -> Any:
    """Same rules as :func:`value_param`, specialised for ``sort=``."""
    return value_param(allowed, field, default=default, unit="sort key")


__all__ = ["DbSession", "WorkspaceScope", "Today", "today_param", "workspace_scope", "enum_param", "sort_param"]
