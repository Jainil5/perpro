"""People: contacts and companies (the Phase 1 directory)."""

from __future__ import annotations

import datetime as dt
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.models import Company, Contact, Tag
from app.models.enums import ContactKind, Source
from app.services import activity, crud, serializers

_CONTACT_FIELDS = ("email", "phone", "title", "location", "kind", "notes")
_COMPANY_FIELDS = ("website", "industry", "location", "notes")


def list_contacts(
    session: Session,
    workspace_id: str,
    *,
    query: str | None = None,
    company_id: str | None = None,
    tag: str | None = None,
    kind: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    conditions = [Contact.workspace_id == workspace_id]
    if company_id:
        if company_id == "none":
            conditions.append(Contact.company_id.is_(None))
        else:
            conditions.append(Contact.company_id == company_id)
    if kind:
        conditions.append(Contact.kind == kind)
    if query:
        needle = query.strip()
        conditions.append(
            sa.or_(
                crud.text_match(Contact.name, needle),
                crud.text_match(Contact.email, needle),
                crud.text_match(Contact.title, needle),
                crud.text_match(Contact.location, needle),
                crud.text_match(Contact.notes, needle),
            )
        )
    statement = sa.select(Contact).where(*conditions)
    if tag:
        statement = (
            statement.join(Contact.tags)
            .where(sa.func.lower(Tag.name) == tag.strip().lstrip("#").lower())
            .distinct()
        )
    total = int(session.scalar(sa.select(sa.func.count(sa.distinct(Contact.id))).where(*conditions)) or 0)
    rows = list(session.scalars(statement.order_by(Contact.name, Contact.id).limit(limit).offset(offset)))
    return [serializers.contact_payload(row) for row in rows], total


def _create_contact(
    session: Session, workspace_id: str, data: dict[str, Any], source: str
) -> dict[str, Any]:
    payload = dict(data)
    if payload.get("company_id"):
        crud.validate_fk(
            session, Company, payload["company_id"], workspace_id=workspace_id, field="company_id"
        )
    tags = list(payload.pop("tags", None) or [])
    contact = Contact(
        workspace_id=workspace_id,
        name=str(payload["name"]).strip(),
        kind=payload.get("kind") or ContactKind.OTHER.value,
        company_id=payload.get("company_id"),
        source=source,
    )
    for field in _CONTACT_FIELDS:
        if field in payload:
            setattr(contact, field, payload[field])
    session.add(contact)
    session.flush()
    if tags:
        crud.set_tags(session, workspace_id, contact, tags)
    activity.created(
        session,
        workspace_id=workspace_id,
        entity_type="contact",
        entity_id=contact.id,
        entity_title=contact.name,
    )
    return serializers.contact_payload(contact)


def create_contact(session: Session, workspace_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return _create_contact(session, workspace_id, data, Source.USER.value)


def update_contact(
    session: Session, workspace_id: str, contact_id: str, data: dict[str, Any]
) -> dict[str, Any]:
    contact = crud.require(session, Contact, contact_id, workspace_id=workspace_id, label="contact")
    payload = dict(data)
    if payload.get("company_id"):
        crud.validate_fk(
            session, Company, payload["company_id"], workspace_id=workspace_id, field="company_id"
        )
    if "name" in payload:
        contact.name = str(payload.pop("name") or "").strip() or contact.name
    if "company_id" in payload:
        contact.company_id = payload.pop("company_id")
    if payload.get("kind"):
        contact.kind = str(payload.pop("kind"))
    tags = payload.pop("tags", None)
    for field in _CONTACT_FIELDS:
        if field in payload:
            setattr(contact, field, payload[field])
    session.flush()
    if tags is not None:
        crud.set_tags(session, workspace_id, contact, list(tags or []))
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="contact",
        entity_id=contact.id,
        entity_title=contact.name,
    )
    return serializers.contact_payload(contact)


def get_contact(session: Session, workspace_id: str, contact_id: str) -> dict[str, Any]:
    contact = crud.require(session, Contact, contact_id, workspace_id=workspace_id, label="contact")
    return serializers.contact_payload(contact)


def delete_contact(session: Session, workspace_id: str, contact_id: str) -> dict[str, Any]:
    contact = crud.require(session, Contact, contact_id, workspace_id=workspace_id, label="contact")
    snapshot = {"id": contact.id, "name": contact.name}
    session.delete(contact)
    session.flush()
    activity.deleted(
        session,
        workspace_id=workspace_id,
        entity_type="contact",
        entity_id=snapshot["id"],
        entity_title=snapshot["name"],
    )
    return snapshot


def list_companies(session: Session, workspace_id: str) -> tuple[list[dict[str, Any]], int]:
    rows = list(
        session.scalars(
            sa.select(Company)
            .where(Company.workspace_id == workspace_id)
            .order_by(Company.name, Company.id)
        )
    )
    return serializers.company_payloads(session, rows), len(rows)


def create_company(
    session: Session, workspace_id: str, data: dict[str, Any], *, source: str = Source.USER.value
) -> dict[str, Any]:
    company = Company(
        workspace_id=workspace_id,
        name=str(data["name"]).strip(),
        source=source,
    )
    for field in _COMPANY_FIELDS:
        if field in data:
            setattr(company, field, data[field])
    session.add(company)
    session.flush()
    activity.created(
        session,
        workspace_id=workspace_id,
        entity_type="company",
        entity_id=company.id,
        entity_title=company.name,
    )
    return serializers.company_payload(company)


def update_company(
    session: Session, workspace_id: str, company_id: str, data: dict[str, Any]
) -> dict[str, Any]:
    company = crud.require(session, Company, company_id, workspace_id=workspace_id, label="company")
    if "name" in data:
        company.name = str(data["name"] or "").strip() or company.name
    for field in _COMPANY_FIELDS:
        if field in data:
            setattr(company, field, data[field])
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="company",
        entity_id=company.id,
        entity_title=company.name,
    )
    return serializers.company_payload(company)


def delete_company(session: Session, workspace_id: str, company_id: str) -> dict[str, Any]:
    """Contacts survive with ``company_id`` set to null (schema: ``ON DELETE SET NULL``)."""
    company = crud.require(session, Company, company_id, workspace_id=workspace_id, label="company")
    snapshot = {"id": company.id, "name": company.name}
    session.execute(
        sa.update(Contact).where(Contact.company_id == company.id).values(company_id=None)
    )
    session.delete(company)
    session.flush()
    activity.deleted(
        session,
        workspace_id=workspace_id,
        entity_type="company",
        entity_id=snapshot["id"],
        entity_title=snapshot["name"],
    )
    return snapshot


def new_contacts_in_window(
    session: Session, workspace_id: str, today: dt.date, days: int = 30
) -> int:
    since = dt.datetime.combine(today - dt.timedelta(days=days), dt.time.min)
    return int(
        session.scalar(
            sa.select(sa.func.count())
            .select_from(Contact)
            .where(Contact.workspace_id == workspace_id, Contact.created_at >= since)
        )
        or 0
    )
