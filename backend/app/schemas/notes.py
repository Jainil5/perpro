"""Note schemas (detail, list summary, relations, tags)."""

from __future__ import annotations

from pydantic import Field, field_validator

from app.schemas.common import (
    Choice,
    OptionalStr,
    RequestModel,
    ResponseModel,
    RequiredStr,
    TagsIn,
    UtcDateTime,
)


class NoteRelationOut(ResponseModel):
    id: str
    target_type: str
    target_id: str
    #: resolved title of the target so the UI never needs a second request
    target_title: str | None = None
    label: str | None = None


class NoteBacklink(ResponseModel):
    note_id: str
    note_title: str


class NoteOut(ResponseModel):
    id: str
    title: str
    content: str | None = None
    category: str
    tags: list[str] = Field(default_factory=list)
    is_favorite: bool = False
    project_id: str | None = None
    word_count: int = 0
    relations: list[NoteRelationOut] = Field(default_factory=list)
    backlinks: list[NoteBacklink] = Field(default_factory=list)
    created_at: UtcDateTime
    updated_at: UtcDateTime


class NoteSummaryOut(ResponseModel):
    """List view: everything in ``note`` minus ``content``, plus ``excerpt``."""

    id: str
    title: str
    excerpt: str = ""
    category: str
    tags: list[str] = Field(default_factory=list)
    is_favorite: bool = False
    project_id: str | None = None
    word_count: int = 0
    relations: list[NoteRelationOut] = Field(default_factory=list)
    backlinks: list[NoteBacklink] = Field(default_factory=list)
    created_at: UtcDateTime
    updated_at: UtcDateTime


class NoteCategoryCount(ResponseModel):
    category: str
    count: int


class NoteListOut(ResponseModel):
    items: list[NoteSummaryOut] = Field(default_factory=list)
    total: int = 0
    categories: list[NoteCategoryCount] = Field(default_factory=list)


class NoteTagCount(ResponseModel):
    tag: str
    count: int


class RelationIn(RequestModel):
    target_type: Choice("note_relation.target_type", "target_type")
    target_id: str
    label: str | None = None

    @field_validator("target_type", "target_id")
    @classmethod
    def _not_blank(cls, value: str | None, info) -> str:
        text = (value or "").strip()
        if not text:
            raise ValueError(f"{info.field_name} must not be empty")
        return text


class NoteCreate(RequestModel):
    title: RequiredStr("title")
    content: str | None = None
    category: Choice("note.category", "category") | None = None
    tags: TagsIn = Field(default_factory=list)
    project_id: str | None = None
    is_favorite: bool = False
    relations: list[RelationIn] = Field(default_factory=list)


class NoteUpdate(RequestModel):
    title: OptionalStr("title") = None
    content: str | None = None
    category: Choice("note.category", "category") | None = None
    tags: TagsIn | None = None
    project_id: str | None = None
    is_favorite: bool | None = None
    #: replacing the whole relation set (add/remove in one call)
    relations: list[RelationIn] | None = None


class RelationCreateRequest(RequestModel):
    """``POST /notes/{id}/relations`` — one or many at once."""

    target_type: Choice("note_relation.target_type", "target_type") | None = None
    target_id: str | None = None
    label: str | None = None
    relations: list[RelationIn] | None = None

    @field_validator("target_id")
    @classmethod
    def _normalise_target_id(cls, value: str | None) -> str | None:
        return value.strip() if isinstance(value, str) else value
