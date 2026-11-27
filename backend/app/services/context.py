"""Workspace scope: resolving ``MYOS_WORKSPACE`` and the counters for ``/meta``.

Phase 1 runs a single workspace. Every read is scoped to its id, so a row that
belongs to another workspace is invisible (404) or a conflict (409) - never a
silent leak. The workspace and its owner are created on first touch so a fresh
install answers ``GET /health`` and ``GET /workspace`` before any seeding.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.utils import now_utc
from app.models import (
    ActivityLog,
    Company,
    Contact,
    CostScenario,
    Expense,
    Goal,
    IncomeTransaction,
    Milestone,
    Note,
    Notification,
    Project,
    Reminder,
    Service,
    Subscription,
    Tag,
    Task,
    User,
    Workspace,
    WorkspaceMember,
)
from app.models.enums import ActivityVerb, MemberRole
from app.services import activity
from app.services import stats as stats_service


def resolve_workspace(session: Session, slug: str | None = None) -> Workspace:
    """The workspace row for ``MYOS_WORKSPACE`` (created if the database is empty)."""
    settings = get_settings()
    wanted = (slug or settings.workspace).strip() or "default"
    workspace = session.scalar(sa.select(Workspace).where(Workspace.slug == wanted))
    if workspace is None:
        # single workspace in Phase 1: fall back to whatever exists, else create it
        workspace = session.scalar(
            sa.select(Workspace).order_by(Workspace.created_at, Workspace.slug).limit(1)
        )
    if workspace is None:
        workspace = Workspace(
            name="MyOS", slug=wanted, timezone=settings.timezone, currency=settings.currency
        )
        session.add(workspace)
        session.flush()
    return workspace


def resolve_owner(session: Session, workspace: Workspace) -> User:
    """The owner user + membership, created on first touch."""
    member = session.scalar(
        sa.select(WorkspaceMember)
        .where(WorkspaceMember.workspace_id == workspace.id)
        .order_by(WorkspaceMember.role)
    )
    if member is not None:
        return member.user
    owner = User(email=f"owner@{workspace.slug}.local", display_name="Owner", timezone=workspace.timezone)
    session.add(owner)
    session.flush()
    session.add(WorkspaceMember(workspace_id=workspace.id, user_id=owner.id, role=MemberRole.OWNER.value))
    session.flush()
    return owner


def workspace_payload(workspace: Workspace) -> dict:
    return {
        "id": workspace.id,
        "name": workspace.name,
        "slug": workspace.slug,
        "timezone": workspace.timezone,
        "currency": workspace.currency,
        "created_at": workspace.created_at,
    }


def update_workspace(
    session: Session, workspace: Workspace, *, name: str | None = None,
    timezone: str | None = None, currency: str | None = None,
) -> dict:
    """``PATCH /workspace`` - only the three locale fields are editable in Phase 1."""
    supplied = {"name": name, "timezone": timezone, "currency": currency}
    changed = {field: value for field, value in supplied.items() if value is not None}
    for field, value in changed.items():
        setattr(workspace, field, value)
    if changed:
        # API.md response rule 3: updated_at moves on every write
        workspace.updated_at = now_utc()
        session.flush()
        activity.record(
            session,
            workspace_id=workspace.id,
            verb=ActivityVerb.UPDATED.value,
            entity_type="workspace",
            entity_id=workspace.id,
            entity_title=workspace.name,
            summary=f"Updated workspace {', '.join(sorted(changed))}",
        )
    return workspace_payload(workspace)


def _count(session: Session, model, workspace_id: str) -> int:
    return int(session.scalar(sa.select(sa.func.count()).select_from(model).where(model.workspace_id == workspace_id)) or 0)


def workspace_counts(session: Session, workspace_id: str, *, today=None) -> dict[str, int]:
    """Counts served by ``GET /meta`` - the frontend's stats source of truth."""
    aggregate = stats_service.workspace_aggregate(session, workspace_id, today=today)
    return {
        "projects": _count(session, Project, workspace_id),
        "tasks": _count(session, Task, workspace_id),
        "tasks_open": aggregate.open,
        "tasks_overdue": aggregate.overdue,
        "tasks_due_today": aggregate.due_today,
        "tasks_done": aggregate.done,
        "milestones": _count(session, Milestone, workspace_id),
        "notes": _count(session, Note, workspace_id),
        "contacts": _count(session, Contact, workspace_id),
        "companies": _count(session, Company, workspace_id),
        "tags": _count(session, Tag, workspace_id),
        "goals": _count(session, Goal, workspace_id),
        "reminders": _count(session, Reminder, workspace_id),
        "notifications": _count(session, Notification, workspace_id),
        "activity": _count(session, ActivityLog, workspace_id),
        # Phase 3 (PHASE3_FINANCE.md §4): one key per finance table the screens list
        "expenses": _count(session, Expense, workspace_id),
        "income": _count(session, IncomeTransaction, workspace_id),
        "subscriptions": _count(session, Subscription, workspace_id),
        "services": _count(session, Service, workspace_id),
        "scenarios": _count(session, CostScenario, workspace_id),
    }


__all__ = [
    "resolve_workspace",
    "resolve_owner",
    "workspace_payload",
    "update_workspace",
    "workspace_counts",
]
