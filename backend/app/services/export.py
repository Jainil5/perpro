"""Full data dump for ``GET /export`` (and ``python -m app.cli export PATH``).

Shape from API.md::

    { "exported_at": "…Z", "workspace": {…}, "tables": { "<name>": [ {…}, … ] } }

Rows are dumped column-for-column - the stored values, not the API payloads - so the
file is a true backup a later import phase can restore from. ``payload``/JSON columns
come back as objects, datetimes get the ``Z`` suffix, dates are ``YYYY-MM-DD``.

Everything in ``tables`` belongs to the exported workspace: business rows carry
``workspace_id``, association rows are joined through their parent, and the tenancy
tables are limited to the active workspace and its members.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any

import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.core.utils import now_utc, to_utc_iso
from app.models import (
    TABLE_MODELS,
    Contact,
    Note,
    Task,
    User,
    Workspace,
    WorkspaceMember,
    contact_tags,
    note_tags,
    task_tags,
)
from app.services import context

#: dumped in this order: tenancy, work, knowledge, people, outcomes & signals, finance
#: (the ten Phase 3 tables in DATA_MODEL.md §13 order)
TABLE_ORDER: tuple[str, ...] = (
    "workspaces",
    "users",
    "workspace_members",
    "projects",
    "milestones",
    "tasks",
    "task_dependencies",
    "tags",
    "task_tags",
    "notes",
    "note_relations",
    "note_tags",
    "companies",
    "contacts",
    "contact_tags",
    "goals",
    "reminders",
    "notifications",
    "activity_logs",
    "income_profiles",
    "exchange_rates",
    "services",
    "service_plans",
    "subscriptions",
    "expense_categories",
    "expenses",
    "income_transactions",
    "cost_scenarios",
    "cost_scenario_items",
)

#: association name -> (association table, parent table, parent foreign key)
_ASSOCIATION_TABLES: dict[str, tuple[sa.Table, sa.Table, str]] = {
    "task_tags": (task_tags, Task.__table__, "task_id"),
    "note_tags": (note_tags, Note.__table__, "note_id"),
    "contact_tags": (contact_tags, Contact.__table__, "contact_id"),
}


def _jsonable(value: Any) -> Any:
    if isinstance(value, dt.datetime):
        return to_utc_iso(value)
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (bytes, bytearray)):
        return value.decode("utf-8", "replace")
    return value


def _rows(session: Session, model: type, statement: sa.Select) -> list[dict[str, Any]]:
    columns = [column.name for column in inspect(model).columns]
    found = session.execute(statement).scalars()
    return [{column: _jsonable(getattr(row, column)) for column in columns} for row in found]


def _scoped_statement(model: type, workspace_id: str) -> sa.Select:
    """The rows of *model* that belong to *workspace_id*, in a stable order."""
    statement = sa.select(model)
    if model is Workspace:
        statement = statement.where(model.id == workspace_id)
    elif model is User:
        members = sa.select(WorkspaceMember.user_id).where(
            WorkspaceMember.workspace_id == workspace_id
        )
        statement = statement.where(model.id.in_(members))
    elif hasattr(model, "workspace_id"):
        statement = statement.where(model.workspace_id == workspace_id)
    return statement.order_by(model.created_at, model.id)


def _dump_association(
    session: Session, entry: tuple[sa.Table, sa.Table, str], workspace_id: str
) -> list[dict[str, Any]]:
    table, parent, foreign_key = entry
    columns = [column.name for column in table.columns]
    statement = (
        sa.select(table)
        .join(parent, table.c[foreign_key] == parent.c.id)
        .where(parent.c.workspace_id == workspace_id)
        .order_by(*table.columns)
    )
    found = session.execute(statement).mappings()
    return [{column: _jsonable(row[column]) for column in columns} for row in found]


def export_payload(session: Session, workspace_id: str | None = None) -> dict[str, Any]:
    """``{exported_at, workspace, tables}`` for the active workspace."""
    workspace = context.resolve_workspace(session)
    scope = workspace_id or workspace.id
    tables: dict[str, list[dict[str, Any]]] = {}
    for name in TABLE_ORDER:
        if name in _ASSOCIATION_TABLES:
            tables[name] = _dump_association(session, _ASSOCIATION_TABLES[name], scope)
        elif name in TABLE_MODELS:
            model = TABLE_MODELS[name]
            tables[name] = _rows(session, model, _scoped_statement(model, scope))
        else:  # pragma: no cover - guards a future ordering typo
            raise KeyError(f"unknown table in export order: {name}")
    return {
        "exported_at": to_utc_iso(now_utc()),
        # already "Z"-formatted: `tables`/`workspace` are plain Any payloads
        "workspace": {
            key: _jsonable(value) for key, value in context.workspace_payload(workspace).items()
        },
        "tables": tables,
    }
