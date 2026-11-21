"""Notes: markdown knowledge items with tags, project links and polymorphic relations."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.errors import field_error, not_found, validation
from app.core.utils import word_count
from app.models import Note, NoteRelation, Project, Tag, note_tags
from app.models.enums import NoteCategory, Source
from app.services import activity, crud, serializers

_SORTS: dict[str, tuple[Any, ...]] = {
    "updated": (Note.updated_at.desc(), Note.title),
    "created": (Note.created_at.desc(), Note.title),
    "title": (Note.title,),
}


def list_notes(
    session: Session,
    workspace_id: str,
    *,
    category: str | None = None,
    tag: str | None = None,
    query: str | None = None,
    favorite: bool | None = None,
    project_id: str | None = None,
    sort: str = "updated",
    limit: int | None = None,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int, list[dict[str, Any]]]:
    """``GET /notes`` -> ``(note_summary items, total, category counts)``."""
    conditions = [Note.workspace_id == workspace_id]
    if category:
        conditions.append(Note.category == category)
    if favorite is not None:
        conditions.append(Note.is_favorite.is_(favorite))
    if project_id:
        if project_id == "none":
            conditions.append(Note.project_id.is_(None))
        else:
            conditions.append(Note.project_id == project_id)
    if query:
        needle = query.strip()
        conditions.append(
            sa.or_(
                crud.text_match(Note.title, needle),
                crud.text_match(Note.content, needle),
            )
        )
    statement = sa.select(Note).where(*conditions)
    if tag:
        statement = (
            statement.join(Note.tags)
            .where(sa.func.lower(Tag.name) == tag.strip().lstrip("#").lower())
            .distinct()
        )
    total = int(session.scalar(sa.select(sa.func.count(sa.distinct(Note.id))).where(*conditions)) or 0)
    rows = list(
        session.scalars(statement.order_by(*_SORTS.get(sort, _SORTS["updated"])).limit(limit).offset(offset))
    )
    items = [serializers.note_summary_payload(session, note) for note in rows]
    counts = session.execute(
        sa.select(Note.category, sa.func.count()).where(Note.workspace_id == workspace_id).group_by(Note.category)
    ).all()
    breakdown = sorted(
        serializers.category_breakdown(counts), key=lambda row: (-row["count"], row["category"])
    )
    return items, total, breakdown


def tag_counts(session: Session, workspace_id: str) -> list[dict[str, Any]]:
    """``GET /note-tags`` -> ``[{"tag": ..., "count": ...}]``."""
    rows = session.execute(
        sa.select(Tag.name, sa.func.count(note_tags.c.note_id))
        .select_from(Tag)
        .outerjoin(note_tags, note_tags.c.tag_id == Tag.id)
        .where(Tag.workspace_id == workspace_id)
        .group_by(Tag.id, Tag.name)
        .order_by(sa.func.count(note_tags.c.note_id).desc(), Tag.name)
    ).all()
    return [{"tag": name, "count": int(count)} for name, count in rows]


def validate_relation_target(session: Session, workspace_id: str, target_type: str, target_id: str) -> None:
    """One note link: the target must exist in this workspace (API.md rule 2)."""
    crud.validate_entity_link(
        session,
        workspace_id,
        target_type,
        target_id,
        type_field="target_type",
        id_field="target_id",
        label="relation",
    )


def _create_relations(
    session: Session, workspace_id: str, note: Note, relations: Sequence[dict[str, Any]]
) -> int:
    """Link the note to each target once; repeats inside the batch are ignored.

    ``note.relations`` is read first and extended as we go, because the session does
    not autoflush - a duplicate that is still pending would not be found by a query.
    """
    seen = {(relation.target_type, relation.target_id) for relation in note.relations}
    added = 0
    for relation in relations:
        target_type = str(relation["target_type"])
        target_id = str(relation["target_id"]).strip()
        if (target_type, target_id) in seen:
            continue
        validate_relation_target(session, workspace_id, target_type, target_id)
        session.add(
            NoteRelation(
                workspace_id=workspace_id,
                note_id=note.id,
                target_type=target_type,
                target_id=target_id,
                label=relation.get("label"),
            )
        )
        seen.add((target_type, target_id))
        added += 1
    if added:
        session.flush()
        # the collection was read above, so reload it to show the new rows
        session.expire(note, ["relations"])
    return added


def create_note(
    session: Session, workspace_id: str, data: dict[str, Any], *, source: str = Source.USER.value
) -> dict[str, Any]:
    payload = dict(data)
    if payload.get("project_id"):
        crud.validate_fk(
            session, Project, payload["project_id"], workspace_id=workspace_id, field="project_id"
        )
    for relation in payload.get("relations") or []:
        validate_relation_target(
            session, workspace_id, str(relation["target_type"]), str(relation["target_id"])
        )
    tags = list(payload.pop("tags", None) or [])
    relations = payload.pop("relations", None) or []
    note = Note(
        workspace_id=workspace_id,
        title=str(payload["title"]).strip(),
        content=payload.get("content"),
        category=payload.get("category") or NoteCategory.PERSONAL.value,
        project_id=payload.get("project_id"),
        is_favorite=bool(payload.get("is_favorite", False)),
        source=source,
    )
    note.word_count = word_count(note.content)
    session.add(note)
    session.flush()
    if tags:
        crud.set_tags(session, workspace_id, note, tags)
    _create_relations(session, workspace_id, note, relations)
    activity.created(
        session,
        workspace_id=workspace_id,
        entity_type="note",
        entity_id=note.id,
        entity_title=note.title,
        project_id=note.project_id,
    )
    return serializers.note_payload(session, note)


def update_note(
    session: Session, workspace_id: str, note_id: str, data: dict[str, Any]
) -> dict[str, Any]:
    note = crud.require(session, Note, note_id, workspace_id=workspace_id, label="note")
    payload = dict(data)
    if payload.get("project_id"):
        crud.validate_fk(
            session, Project, payload["project_id"], workspace_id=workspace_id, field="project_id"
        )
    if "title" in payload:
        note.title = str(payload.pop("title") or "").strip() or note.title
    if "content" in payload:
        note.content = payload.pop("content")
        note.word_count = word_count(note.content)
    if payload.get("category"):
        note.category = str(payload.pop("category"))
    if "project_id" in payload:
        note.project_id = payload.pop("project_id")
    if "is_favorite" in payload:
        note.is_favorite = bool(payload.pop("is_favorite"))
    tags = payload.pop("tags", None)
    relations = payload.pop("relations", None)
    session.flush()
    if tags is not None:
        crud.set_tags(session, workspace_id, note, list(tags or []))
    if relations is not None:
        # full replacement of the outgoing edges
        session.execute(sa.delete(NoteRelation).where(NoteRelation.note_id == note.id))
        session.flush()
        _create_relations(session, workspace_id, note, relations)
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="note",
        entity_id=note.id,
        entity_title=note.title,
        project_id=note.project_id,
    )
    return serializers.note_payload(session, note)


def get_note(session: Session, workspace_id: str, note_id: str) -> dict[str, Any]:
    note = crud.require(session, Note, note_id, workspace_id=workspace_id, label="note")
    return serializers.note_payload(session, note)


def delete_note(session: Session, workspace_id: str, note_id: str) -> dict[str, Any]:
    note = crud.require(session, Note, note_id, workspace_id=workspace_id, label="note")
    snapshot = {"id": note.id, "title": note.title, "project_id": note.project_id}
    session.delete(note)
    session.flush()
    activity.deleted(
        session,
        workspace_id=workspace_id,
        entity_type="note",
        entity_id=snapshot["id"],
        entity_title=snapshot["title"],
        project_id=None,
    )
    return snapshot


def add_relations(
    session: Session, workspace_id: str, note_id: str, relations: Sequence[dict[str, Any]]
) -> list[dict[str, Any]]:
    """``POST /notes/{id}/relations`` - returns the note's relation list after adding."""
    note = crud.require(session, Note, note_id, workspace_id=workspace_id, label="note")
    added = _create_relations(session, workspace_id, note, relations)
    if added:
        session.expire(note, ["relations"])
        activity.updated(
            session,
            workspace_id=workspace_id,
            entity_type="note",
            entity_id=note.id,
            entity_title=note.title,
            project_id=note.project_id,
            summary=f"Linked {added} relation{'s' if added != 1 else ''} to “{note.title}”",
            payload={"relations_added": added},
        )
    return serializers.relation_payloads(session, note)


def remove_relation(
    session: Session, workspace_id: str, note_id: str, relation_id: str
) -> dict[str, Any]:
    """``DELETE /notes/{id}/relations/{relation_id}``."""
    note = crud.require(session, Note, note_id, workspace_id=workspace_id, label="note")
    relation = session.get(NoteRelation, relation_id)
    if relation is None or relation.note_id != note.id:
        raise not_found("relation not found")
    snapshot = {"target_type": relation.target_type, "target_id": relation.target_id}
    session.delete(relation)
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="note",
        entity_id=note.id,
        entity_title=note.title,
        project_id=note.project_id,
        summary=f"Unlinked {snapshot['target_type']} from “{note.title}”",
        payload=snapshot,
    )
    return {"deleted": 1, **snapshot}
