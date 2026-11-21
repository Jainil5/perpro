"""Shared CRUD plumbing: scoping, FK validation, slugs, tags.

These are the three rules from API.md that every endpoint repeats, so they live in
one place instead of every router:

1. unknown id -> 404 ``not_found``
2. row that exists in another workspace -> 409 ``conflict``
3. a missing FK target -> 422 ``validation_error`` (never a silent ``null``)
"""

from __future__ import annotations

from typing import TypeVar

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.errors import conflict, not_found, validation, field_error
from app.core.utils import slugify
from app.models import Project, Tag

ModelT = TypeVar("ModelT")


def escape_like(term: str) -> str:
    """Make a user string safe for ``LIKE`` (``%``/``_``/``\\`` are literal)."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def text_match(column, term: str):
    """Case-insensitive substring test that behaves the same on SQLite and PG."""
    return sa.func.lower(column).like(f"%{escape_like(term.strip().lower())}%", escape="\\")


def require(
    session: Session,
    model: type[ModelT],
    entity_id: str,
    *,
    workspace_id: str | None = None,
    label: str | None = None,
) -> ModelT:
    """Load by id, scoped to the workspace; 404 when absent, 409 when foreign."""
    name = label or model.__tablename__
    row = session.get(model, entity_id)
    if row is None:
        raise not_found(f"{name} not found")
    if workspace_id is not None and getattr(row, "workspace_id", None) not in (None, workspace_id):
        raise conflict(f"{name} belongs to another workspace")
    return row


def validate_fk(
    session: Session,
    model: type,
    entity_id: str | None,
    *,
    workspace_id: str,
    field: str,
) -> None:
    """422 when a body references a row that does not exist in this workspace."""
    if entity_id is None:
        return
    exists = session.scalar(
        sa.select(sa.func.count()).select_from(model).where(model.id == entity_id)
    )
    if not exists:
        raise validation(
            f"{field} not found",
            [field_error(["body", field], f"{field} does not reference an existing record")],
        )
    row = session.get(model, entity_id)
    if row is not None and getattr(row, "workspace_id", None) not in (None, workspace_id):
        raise conflict(f"{field} belongs to another workspace")


def project_slug(session: Session, workspace_id: str, name: str, *, exclude_id: str | None = None) -> str:
    """Slug for a new/renamed project; the *name* is unique per workspace (409).

    Matching ignores case and surrounding spaces (the same rule tags use), so
    ``"Alpha One"`` and ``"alpha one"`` are one project, not two slugs.
    """
    existing = session.scalar(
        sa.select(Project).where(
            Project.workspace_id == workspace_id,
            sa.func.lower(sa.func.trim(Project.name)) == name.strip().lower(),
            Project.id != (exclude_id or ""),
        )
    )
    if existing is not None:
        raise conflict(f"a project named {existing.name!r} already exists")
    base = slugify(name, fallback="project")
    candidate = base
    counter = 2
    while True:
        clash = session.scalar(
            sa.select(Project.id).where(
                Project.workspace_id == workspace_id,
                Project.slug == candidate,
                Project.id != (exclude_id or ""),
            )
        )
        if clash is None:
            return candidate
        candidate = f"{base}-{counter}"
        counter += 1


def validate_entity_link(
    session: Session,
    workspace_id: str,
    entity_type: str | None,
    entity_id: str | None,
    *,
    type_field: str,
    id_field: str,
    label: str = "link target",
) -> None:
    """422 when a polymorphic ``type``/``id`` pair points at a missing row.

    ``note_relations`` and ``reminders`` reference many tables, so the pair cannot be
    a real foreign key; API.md response rule 2 still applies, checked by hand here.
    """
    from app.services import serializers

    if entity_type is None and entity_id is None:
        return
    if (entity_type is None) != (entity_id is None):
        raise validation(
            f"{type_field} and {id_field} must be supplied together",
            [
                field_error(
                    ["body", id_field if entity_type is None else type_field],
                    f"{label} needs both a type and an id",
                )
            ],
        )
    entry = serializers.TITLE_MODELS.get(str(entity_type))
    if entry is None:
        raise validation(
            f"unknown {type_field}: {entity_type}",
            [field_error(["body", type_field], f"unsupported {type_field}")],
        )
    target_id = str(entity_id).strip()
    entity = session.get(entry[0], target_id)
    if entity is None:
        raise validation(
            f"{entity_type} not found",
            [field_error(["body", id_field], f"no {entity_type} with that id")],
        )
    if getattr(entity, "workspace_id", None) not in (None, workspace_id):
        raise validation(
            f"{entity_type} belongs to another workspace",
            [field_error(["body", id_field], "cross workspace reference")],
        )


def get_or_create_tag(session: Session, workspace_id: str, name: str) -> Tag:
    cleaned = (name or "").strip().lstrip("#")
    if not cleaned:
        raise validation("tag names must not be empty", [field_error(["body", "tags"], "empty tag")])
    tag = session.scalar(
        sa.select(Tag).where(
            Tag.workspace_id == workspace_id, sa.func.lower(Tag.name) == cleaned.lower()
        )
    )
    if tag is None:
        tag = Tag(workspace_id=workspace_id, name=cleaned)
        session.add(tag)
        session.flush()
    return tag


def set_tags(session: Session, workspace_id: str, entity, names: list[str]) -> None:
    """Replace an entity's tags with ``names`` (case-insensitive reuse of Tag rows)."""
    wanted = []
    seen: set[str] = set()
    for raw in names:
        tag = get_or_create_tag(session, workspace_id, raw)
        if tag.id not in seen:
            seen.add(tag.id)
            wanted.append(tag)
    entity.tags = wanted
    session.flush()
