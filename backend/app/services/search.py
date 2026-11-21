"""Global search (``GET /search``).

One ranked list per entity type, in the order the command palette renders them.
Matching is case-insensitive ``LIKE`` over the title/name plus the
description/content columns API.md names, then Python-side ranking:

``exact`` (0) › ``prefix`` (1) › ``substring`` (2), ties broken by title then id, so
two identical searches always answer in the same order.

``q`` shorter than two characters returns ``{"groups": [], "total": 0}``.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Any, Sequence

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.utils import excerpt
from app.models import Company, Contact, Milestone, Note, Project, Task
from app.models.enums import TaskStatus
from app.schemas.results import SEARCH_GROUP_LABELS, SEARCH_GROUP_ORDER
from app.services import crud, links

#: group -> (model, columns searched).  The route each group links to is not here: it is
#: ``links.search_href(group, term)`` for the header and ``links.href_for(...)`` per item.
_SEARCH_MODELS: dict[str, tuple[type, tuple[Any, ...]]] = {
    "tasks": (Task, (Task.title, Task.description, Task.notes)),
    "projects": (Project, (Project.name, Project.description, Project.next_action)),
    "notes": (Note, (Note.title, Note.content)),
    "milestones": (Milestone, (Milestone.title, Milestone.description)),
    "contacts": (Contact, (Contact.name, Contact.title, Contact.notes)),
    "companies": (Company, (Company.name, Company.industry, Company.notes)),
}

RANK_EXACT = 0
RANK_PREFIX = 1
RANK_SUBSTRING = 2
#: rows pulled per group before ranking - the palette shows at most ``limit``
CANDIDATE_FACTOR = 6
MIN_QUERY_LENGTH = 2


@dataclass(frozen=True)
class Candidate:
    id: str
    title: str
    subtitle: str | None
    href: str
    badge: str | None


def rank(title: str, needle: str) -> int:
    lowered = (title or "").strip().lower()
    term = needle.strip().lower()
    if lowered == term:
        return RANK_EXACT
    if lowered.startswith(term):
        return RANK_PREFIX
    return RANK_SUBSTRING


def _matches(model: type, columns: Sequence[Any], workspace_id: str, needle: str) -> Any:
    return sa.and_(
        model.workspace_id == workspace_id,
        sa.or_(*[crud.text_match(column, needle) for column in columns]),
    )


def _candidate(group: str, row: Any, today: dt.date | None) -> Candidate | None:
    """The per-type title/subtitle/href/badge contract the palette renders.

    ``href`` always comes from :func:`app.services.links.href_for`, so a search result
    opens exactly the same place the activity feed and the notifications do.
    """
    if group == "tasks":
        project = row.project
        overdue = (
            today is not None
            and row.due_date is not None
            and row.status in TaskStatus.open_values()
            and row.due_date < today
        )
        return Candidate(
            id=row.id,
            title=row.title,
            subtitle=project.name if project else None,
            href=links.href_for("task", row.id),
            badge="overdue" if overdue else row.status,
        )
    if group == "projects":
        return Candidate(
            id=row.id,
            title=row.name,
            subtitle=row.description,
            href=links.href_for("project", row.id),
            badge=row.status,
        )
    if group == "notes":
        return Candidate(
            id=row.id,
            title=row.title,
            subtitle=excerpt(row.content),
            href=links.href_for("note", row.id),
            badge=row.category,
        )
    if group == "milestones":
        project = row.project
        return Candidate(
            id=row.id,
            title=row.title,
            subtitle=f"{project.name} · {row.date}" if project else str(row.date),
            href=links.href_for("milestone", row.id, project_id=row.project_id),
            badge=row.status,
        )
    if group == "contacts":
        return Candidate(
            id=row.id,
            title=row.name,
            subtitle=" · ".join(part for part in (row.title, row.email) if part),
            href=links.href_for("contact", row.id),
            badge=row.kind,
        )
    return Candidate(
        id=row.id,
        title=row.name,
        subtitle=row.industry,
        href=links.href_for("company", row.id),
        badge=None,
    )


def search(
    session: Session,
    workspace_id: str,
    *,
    query: str | None,
    limit: int = 8,
    today: dt.date | None = None,
) -> dict[str, Any]:
    """``GET /search?q=&limit=8`` -> ``{query, groups, total}``."""
    needle = (query or "").strip()
    if len(needle) < MIN_QUERY_LENGTH:
        return {"query": needle, "groups": [], "total": 0}

    groups: list[dict[str, Any]] = []
    total = 0
    for group in SEARCH_GROUP_ORDER:
        model, columns = _SEARCH_MODELS[group]
        rows = list(
            session.scalars(
                sa.select(model)
                .where(_matches(model, columns, workspace_id, needle))
                .order_by(model.id)
                .limit(max(limit * CANDIDATE_FACTOR, limit))
            )
        )
        candidates = [item for item in (_candidate(group, row, today) for row in rows) if item]
        ranked = sorted(
            candidates, key=lambda item: (rank(item.title, needle), item.title.lower(), item.id)
        )[:limit]
        if not ranked:
            continue
        total += len(ranked)
        groups.append(
            {
                "type": group,
                "label": SEARCH_GROUP_LABELS[group],
                "href": links.search_href(group, needle),
                "items": [
                    {
                        "id": item.id,
                        "title": item.title,
                        "subtitle": item.subtitle,
                        "href": item.href,
                        "badge": item.badge,
                    }
                    for item in ranked
                ],
            }
        )
    return {"query": needle, "groups": groups, "total": total}
