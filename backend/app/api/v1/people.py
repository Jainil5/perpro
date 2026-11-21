"""``/contacts`` and ``/companies`` - the people directory (API.md "People")."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.v1.deps import DbSession, WorkspaceScope, enum_param
from app.schemas.contacts import (
    CompanyCreate,
    CompanyListOut,
    CompanyOut,
    CompanyUpdate,
    ContactCreate,
    ContactListOut,
    ContactOut,
    ContactUpdate,
)
from app.services import people, serializers

router = APIRouter(tags=["people"])

KindQuery = Annotated[str | None, enum_param("contact.kind", "kind")]


@router.get("/contacts", response_model=ContactListOut, summary="List contacts")
def list_contacts(
    session: DbSession,
    scope: WorkspaceScope,
    kind: KindQuery,
    q: Annotated[str | None, Query(description="name/email/title/location substring")] = None,
    company_id: Annotated[str | None, Query()] = None,
    tag: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    items, total = people.list_contacts(
        session, scope, query=q, company_id=company_id, tag=tag, kind=kind, limit=limit, offset=offset
    )
    return serializers.page_payload(items, total, limit=limit, offset=offset)


@router.post(
    "/contacts",
    response_model=ContactOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a contact",
)
def create_contact(session: DbSession, scope: WorkspaceScope, payload: ContactCreate) -> dict:
    return people.create_contact(session, scope, payload.model_dump())


@router.get("/contacts/{contact_id}", response_model=ContactOut, summary="One contact")
def get_contact(session: DbSession, scope: WorkspaceScope, contact_id: str) -> dict:
    return people.get_contact(session, scope, contact_id)


@router.patch("/contacts/{contact_id}", response_model=ContactOut, summary="Update a contact")
def update_contact(
    session: DbSession, scope: WorkspaceScope, contact_id: str, payload: ContactUpdate
) -> dict:
    return people.update_contact(
        session, scope, contact_id, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/contacts/{contact_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a contact",
)
def delete_contact(session: DbSession, scope: WorkspaceScope, contact_id: str) -> Response:
    people.delete_contact(session, scope, contact_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/companies", response_model=CompanyListOut, summary="List companies")
def list_companies(session: DbSession, scope: WorkspaceScope) -> dict:
    items, total = people.list_companies(session, scope)
    return {"items": items, "total": total}


@router.post(
    "/companies",
    response_model=CompanyOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a company",
)
def create_company(session: DbSession, scope: WorkspaceScope, payload: CompanyCreate) -> dict:
    return people.create_company(session, scope, payload.model_dump())


@router.patch("/companies/{company_id}", response_model=CompanyOut, summary="Update a company")
def update_company(
    session: DbSession, scope: WorkspaceScope, company_id: str, payload: CompanyUpdate
) -> dict:
    return people.update_company(
        session, scope, company_id, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/companies/{company_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a company (its contacts survive without a company)",
)
def delete_company(session: DbSession, scope: WorkspaceScope, company_id: str) -> Response:
    people.delete_company(session, scope, company_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
