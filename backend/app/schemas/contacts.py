"""People schemas: contacts and companies."""

from __future__ import annotations

from pydantic import Field

from app.schemas.common import (
    Choice,
    ListEnvelope,
    OptionalStr,
    RequestModel,
    ResponseModel,
    RequiredStr,
    TagsIn,
    TextIn,
    UtcDateTime,
)


class ContactOut(ResponseModel):
    id: str
    name: str
    email: str | None = None
    phone: str | None = None
    title: str | None = None
    company_id: str | None = None
    #: denormalised company name, as documented in the API object shape
    company: str | None = None
    location: str | None = None
    kind: str
    tags: list[str] = Field(default_factory=list)
    notes: str | None = None
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ContactCreate(RequestModel):
    name: RequiredStr("name")
    email: str | None = None
    phone: str | None = None
    title: str | None = None
    company_id: str | None = None
    location: str | None = None
    kind: Choice("contact.kind", "kind") | None = None
    tags: TagsIn = Field(default_factory=list)
    notes: TextIn = None


class ContactUpdate(RequestModel):
    name: OptionalStr("name") = None
    email: str | None = None
    phone: str | None = None
    title: str | None = None
    company_id: str | None = None
    location: str | None = None
    kind: Choice("contact.kind", "kind") | None = None
    tags: TagsIn | None = None
    notes: TextIn = None


class CompanyOut(ResponseModel):
    id: str
    name: str
    website: str | None = None
    industry: str | None = None
    location: str | None = None
    notes: str | None = None
    contact_count: int = 0
    created_at: UtcDateTime
    updated_at: UtcDateTime


class CompanyCreate(RequestModel):
    name: RequiredStr("name")
    website: str | None = None
    industry: str | None = None
    location: str | None = None
    notes: TextIn = None


class CompanyUpdate(RequestModel):
    name: OptionalStr("name") = None
    website: str | None = None
    industry: str | None = None
    location: str | None = None
    notes: TextIn = None


class ContactListOut(ListEnvelope[ContactOut]):
    pass


class CompanyListOut(ListEnvelope[CompanyOut]):
    pass
