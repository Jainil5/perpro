"""``/notes``, ``/note-tags`` and the note relation endpoints.

One router with full paths (no prefix) so ``GET /note-tags`` - which API.md documents
outside the ``/notes`` tree, as a bare array of ``{tag, count}`` - can live next to the
note CRUD it belongs to.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.v1.deps import DbSession, WorkspaceScope, enum_param, sort_param
from app.schemas.notes import (
    NoteCreate,
    NoteListOut,
    NoteOut,
    NoteRelationOut,
    NoteTagCount,
    NoteUpdate,
    RelationCreateRequest,
    RelationIn,
)
from app.services import notes

router = APIRouter(tags=["notes"])

NOTE_SORTS = ("updated", "created", "title", "word_count")
CategoryQuery = Annotated[str | None, enum_param("note.category", "category")]
SortQuery = Annotated[str, sort_param(*NOTE_SORTS, default="updated")]


@router.get(
    "/notes", response_model=NoteListOut, summary="List note summaries with a category breakdown"
)
def list_notes(
    session: DbSession,
    scope: WorkspaceScope,
    category: CategoryQuery,
    sort: SortQuery,
    tag: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
    favorite: Annotated[bool | None, Query()] = None,
    project_id: Annotated[str | None, Query()] = None,
    limit: Annotated[int | None, Query(ge=1, le=500)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    items, total, categories = notes.list_notes(
        session,
        scope,
        category=category,
        tag=tag,
        query=q,
        favorite=favorite,
        project_id=project_id,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    return {"items": items, "total": total, "categories": categories}


@router.get(
    "/note-tags",
    response_model=list[NoteTagCount],
    summary="Tag counts (documented as a bare array)",
)
def list_note_tags(session: DbSession, scope: WorkspaceScope) -> list[dict]:
    return notes.tag_counts(session, scope)


@router.post(
    "/notes",
    response_model=NoteOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a note with tags and relations",
)
def create_note(session: DbSession, scope: WorkspaceScope, payload: NoteCreate) -> dict:
    return notes.create_note(session, scope, payload.model_dump())


@router.get("/notes/{note_id}", response_model=NoteOut, summary="One note with relations/backlinks")
def get_note(session: DbSession, scope: WorkspaceScope, note_id: str) -> dict:
    return notes.get_note(session, scope, note_id)


@router.patch("/notes/{note_id}", response_model=NoteOut, summary="Update a note")
def update_note(
    session: DbSession, scope: WorkspaceScope, note_id: str, payload: NoteUpdate
) -> dict:
    return notes.update_note(session, scope, note_id, payload.model_dump(exclude_unset=True))


@router.delete(
    "/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a note"
)
def delete_note(session: DbSession, scope: WorkspaceScope, note_id: str) -> Response:
    notes.delete_note(session, scope, note_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/notes/{note_id}/relations",
    response_model=list[NoteRelationOut],
    status_code=status.HTTP_201_CREATED,
    summary="Link the note to entities; answers with its full relation list",
)
def add_relations(
    session: DbSession, scope: WorkspaceScope, note_id: str, payload: RelationCreateRequest
) -> list[dict]:
    wanted: list[RelationIn] = list(payload.relations or [])
    if payload.target_type and payload.target_id:
        wanted.append(
            RelationIn(
                target_type=payload.target_type,
                target_id=payload.target_id,
                label=payload.label,
            )
        )
    return notes.add_relations(session, scope, note_id, [item.model_dump() for item in wanted])


@router.delete(
    "/notes/{note_id}/relations/{relation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove one relation",
)
def remove_relation(
    session: DbSession, scope: WorkspaceScope, note_id: str, relation_id: str
) -> Response:
    notes.remove_relation(session, scope, note_id, relation_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
