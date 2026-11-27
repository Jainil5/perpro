"""The service catalogue: what you sell, and the plans packaged on top of it.

Two tables, one screen (§4 of PHASE3_FINANCE.md). The maths here is deliberately small -
a service is a price per unit and a plan is a package - but three of its figures are
derived and never stored:

* ``monthly_price`` on a plan, normalised with the same :func:`app.services.money.monthly_normalise`
  the burn and the runway use, so a yearly plan costs the same per month here as it does on
  the overview;
* ``effective_rate`` (price ÷ ``included_units``), which is the number that lets a plan be
  compared with the bare per-unit price on the service;
* ``subscriber_count``, a live count - a cancelled subscription is history, not a customer.

A service detail also reports ``revenue`` from ``income_transactions.service_id``. That
figure is converted like every other total in Finance: per currency unless the caller names
one, and never across a gap in the rate ledger.

``utilisation_hours`` is ``null`` on purpose. The task roll-up needs a ``project_id`` on
the service, which §13 does not have; the field is in the response so the UI can bind to it
and the number arrives with the phase that owns the link - it is not faked from 0.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Sequence
from decimal import Decimal
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.models import IncomeTransaction, Service, ServicePlan, Subscription
from app.models.enums import IncomeStatus, PlanInterval, SubscriptionStatus
from app.services import activity, crud, money

#: sort key -> (column, default direction); ``id`` is always the final tiebreaker
_SERVICE_SORTS: dict[str, tuple[Any, str]] = {
    "updated": (Service.updated_at, "desc"),
    "name": (Service.name, "asc"),
    "price": (Service.default_price, "desc"),
}
_PLAN_SORTS: dict[str, tuple[Any, str]] = {
    "price": (ServicePlan.price, "desc"),
    "name": (ServicePlan.name, "asc"),
    "created": (ServicePlan.created_at, "desc"),
}

#: a stable secondary key per table, so equal sort keys never swap rows between pages
_SERVICE_TAIL = (Service.name.asc(), Service.id.asc())
_PLAN_TAIL = (ServicePlan.name.asc(), ServicePlan.id.asc())


def _order(
    sorts: dict[str, tuple[Any, str]], tail: Sequence[Any], sort: str, direction: str | None
) -> tuple[Any, ...]:
    """Flip only the requested key; ``?dir=`` absent keeps the documented default (§4 addendum)."""
    column, default = sorts[sort]
    key = column.asc() if (direction or default).lower() == "asc" else column.desc()
    return (key, *tail)


def _bool_filter(value: Any, column: Any, conditions: list[Any]) -> None:
    if value is not None:
        conditions.append(column.is_(bool(value)))


def service_payload(row: Service) -> dict[str, Any]:
    """One service as the API shows it: its own columns, no derived maths."""
    return {
        "id": row.id,
        "name": row.name,
        "code": row.code,
        "description": row.description,
        "unit": row.unit,
        "default_price": row.default_price,
        "currency": row.currency,
        "active": row.active,
        "source": row.source,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def plan_payload(
    row: ServicePlan,
    *,
    subscriber_count: int = 0,
    service: Service | None = None,
) -> dict[str, Any]:
    """One plan plus the three derived figures §4 promises."""
    code = row.currency or "USD"
    monthly = money.monthly_normalise(row.price, row.interval)
    units = Decimal(str(row.included_units)) if row.included_units is not None else None
    #: §4: the effective rate is price ÷ included_units - a per-unit figure for the plan's
    #: own period, so it is comparable with ``services.default_price`` and does not care
    #: which interval the plan is billed on.
    has_units = units is not None and units > 0
    return {
        "id": row.id,
        "service_id": row.service_id,
        "service": (
            {"id": service.id, "name": service.name, "unit": service.unit} if service else None
        ),
        "name": row.name,
        "interval": row.interval,
        "price": money.money(row.price, code),
        "currency": row.currency,
        "included_units": row.included_units,
        "overage_rate": row.overage_rate,
        "trial_days": row.trial_days,
        "active": row.active,
        "source": row.source,
        "monthly_price": None if monthly is None else money.money(monthly, code),
        "effective_rate": money.money(Decimal(str(row.price)) / units, code) if has_units else None,
        "subscriber_count": subscriber_count,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _live_subscriber_counts(
    session: Session, workspace_id: str, plan_ids: Sequence[str], *, today: dt.date
) -> dict[str, int]:
    """How many currently-billing subscriptions sit on each plan (one grouped query).

    ``today`` is a parameter rather than a call to the clock: a cancelled row only stops
    counting once its cancellation date has arrived, and that answer must not depend on
    which machine runs the query (PHASE3_FINANCE.md §9.1).
    """
    if not plan_ids:
        return {}
    rows = session.execute(
        sa.select(Subscription.plan_id, sa.func.count())
        .where(
            Subscription.workspace_id == workspace_id,
            Subscription.plan_id.in_(list(plan_ids)),
            Subscription.status.in_(tuple(SubscriptionStatus.live())),
            sa.or_(Subscription.cancelled_on.is_(None), Subscription.cancelled_on > today),
        )
        .group_by(Subscription.plan_id)
    ).all()
    return {plan_id: int(count) for plan_id, count in rows if plan_id}


# --------------------------------------------------------------------------- services


def list_services(
    session: Session,
    workspace_id: str,
    *,
    query: str | None = None,
    active: bool | None = None,
    unit: str | None = None,
    sort: str = "updated",
    direction: str | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    conditions: list[Any] = [Service.workspace_id == workspace_id]
    if query:
        needle = query.strip()
        conditions.append(
            sa.or_(
                crud.text_match(Service.name, needle),
                crud.text_match(Service.code, needle),
                crud.text_match(Service.description, needle),
            )
        )
    _bool_filter(active, Service.active, conditions)
    if unit:
        conditions.append(Service.unit == unit)
    total = int(session.scalar(sa.select(sa.func.count()).select_from(Service).where(*conditions)) or 0)
    statement = sa.select(Service).where(*conditions).order_by(
        *_order(_SERVICE_SORTS, _SERVICE_TAIL, sort, direction)
    )
    if limit is not None:
        statement = statement.limit(limit).offset(max(0, offset))
    return [service_payload(row) for row in session.scalars(statement)], total


def service_detail(
    session: Session, workspace_id: str, service_id: str, *, today: dt.date
) -> dict[str, Any]:
    """``GET /services/{id}`` - the row, its plans, and its revenue (§4)."""
    row = crud.require(session, Service, service_id, workspace_id=workspace_id, label="service")
    plans = list(
        session.scalars(
            sa.select(ServicePlan)
            .where(ServicePlan.service_id == row.id)
            .order_by(ServicePlan.price.desc(), ServicePlan.name, ServicePlan.id)
        )
    )
    counts = _live_subscriber_counts(session, workspace_id, [plan.id for plan in plans], today=today)
    payload = service_payload(row)
    payload["plans"] = [plan_payload(plan, subscriber_count=counts.get(plan.id, 0)) for plan in plans]
    payload["revenue"] = revenue_for(session, workspace_id, row.id, today=today)
    #: needs a ``services.project_id`` that §13 does not have - see the module docstring
    payload["utilisation_hours"] = None
    return payload


def revenue_for(
    session: Session,
    workspace_id: str,
    service_id: str,
    *,
    currency: str | None = None,
    today: dt.date,
) -> dict[str, Any]:
    """What this service has earned: paid rows, plus what is still owed on it."""
    rows = list(
        session.scalars(
            sa.select(IncomeTransaction).where(
                IncomeTransaction.workspace_id == workspace_id,
                IncomeTransaction.service_id == service_id,
            )
        )
    )
    paid = [row for row in rows if row.status == IncomeStatus.PAID.value]
    open_rows = [row for row in rows if row.status in IncomeStatus.receivable()]
    codes = {row.currency for row in rows}
    target = money.resolve_currency(codes, currency)
    return {
        "total": money.sum_tally(
            session, workspace_id, money.tally_by_currency(paid), target, as_of=today, today=today
        ),
        "currency": target,
        "paid_count": len(paid),
        "invoiced_amount": money.sum_tally(
            session,
            workspace_id,
            money.tally_by_currency(open_rows),
            target,
            as_of=today,
            today=today,
        ),
    }


def _resolve_service_currency(session: Session, workspace_id: str, data: dict[str, Any]) -> str | None:
    """``currency`` only matters when the row carries money (§2.5: the workspace default is for new rows)."""
    raw = data.get("currency")
    price = data.get("default_price")
    if raw is None:
        if price is None:
            return None
        return money.workspace_currency(session, workspace_id)
    return money.require_currency(raw, "currency")


def create_service(
    session: Session, workspace_id: str, data: dict[str, Any], *, source: str = "user"
) -> dict[str, Any]:
    name = str(data.get("name") or "").strip()
    if not name:
        raise _missing_name("name")
    code = (str(data["code"]).strip() if data.get("code") else None) or None
    if code:
        clash = session.scalar(
            sa.select(Service.id).where(
                Service.workspace_id == workspace_id, sa.func.lower(Service.code) == code.lower()
            )
        )
        if clash is not None:
            raise crud.conflict(
                f"a service coded {code!r} already exists",
                [crud.field_error(["body", "code"], "code is unique per workspace")],
            )
    price = _non_negative(data.get("default_price"), "default_price")
    row = Service(
        workspace_id=workspace_id,
        name=name,
        code=code,
        description=data.get("description"),
        unit=data.get("unit") or "hour",
        default_price=price,
        currency=_resolve_service_currency(session, workspace_id, data),
        active=bool(data.get("active", True)),
        project_template=data.get("project_template"),
        source=source,
    )
    session.add(row)
    session.flush()
    activity.created(
        session, workspace_id=workspace_id, entity_type="service", entity_id=row.id, entity_title=row.name
    )
    return service_payload(row)


def update_service(
    session: Session, workspace_id: str, service_id: str, data: dict[str, Any]
) -> dict[str, Any]:
    row = crud.require(session, Service, service_id, workspace_id=workspace_id, label="service")
    if data.get("name") is not None:
        name = str(data["name"]).strip()
        if not name:
            raise _missing_name("name")
        row.name = name
    if "code" in data:
        code = (str(data["code"]).strip() if data.get("code") else None) or None
        if code:
            clash = session.scalar(
                sa.select(Service.id).where(
                    Service.workspace_id == workspace_id,
                    sa.func.lower(Service.code) == code.lower(),
                    Service.id != row.id,
                )
            )
            if clash is not None:
                raise crud.conflict(
                    f"a service coded {code!r} already exists",
                    [crud.field_error(["body", "code"], "code is unique per workspace")],
                )
        row.code = code
    if "default_price" in data:
        row.default_price = _non_negative(data["default_price"], "default_price")
    if data.get("currency") is not None:
        row.currency = money.require_currency(data["currency"], "currency")
    for field in ("description", "unit", "active", "project_template"):
        if field in data:
            setattr(row, field, data[field])
    session.flush()
    activity.updated(
        session, workspace_id=workspace_id, entity_type="service", entity_id=row.id, entity_title=row.name
    )
    return service_payload(row)


def delete_service(session: Session, workspace_id: str, service_id: str) -> dict[str, Any]:
    """Plans cascade with it; ``subscriptions.plan_id`` is set null (§4, DATA_MODEL §8)."""
    row = crud.require(session, Service, service_id, workspace_id=workspace_id, label="service")
    snapshot = {"id": row.id, "name": row.name}
    session.delete(row)
    session.flush()
    activity.deleted(
        session, workspace_id=workspace_id, entity_type="service", entity_id=snapshot["id"],
        entity_title=snapshot["name"],
    )
    return snapshot


# ------------------------------------------------------------------------ service plans


def list_plans(
    session: Session,
    workspace_id: str,
    *,
    today: dt.date,
    service_id: str | None = None,
    interval: str | None = None,
    active: bool | None = None,
    sort: str = "price",
    direction: str | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> tuple[list[dict[str, Any]], int]:
    conditions: list[Any] = [ServicePlan.workspace_id == workspace_id]
    if service_id:
        crud.validate_fk(session, Service, service_id, workspace_id=workspace_id, field="service_id")
        conditions.append(ServicePlan.service_id == service_id)
    if interval:
        conditions.append(ServicePlan.interval == interval)
    _bool_filter(active, ServicePlan.active, conditions)
    total = int(
        session.scalar(sa.select(sa.func.count()).select_from(ServicePlan).where(*conditions)) or 0
    )
    statement = sa.select(ServicePlan).where(*conditions).order_by(
        *_order(_PLAN_SORTS, _PLAN_TAIL, sort, direction)
    )
    if limit is not None:
        statement = statement.limit(limit).offset(max(0, offset))
    rows = list(session.scalars(statement))
    services = _services_for(session, rows)
    counts = _live_subscriber_counts(session, workspace_id, [row.id for row in rows], today=today)
    return [
        plan_payload(row, subscriber_count=counts.get(row.id, 0), service=services.get(row.service_id))
        for row in rows
    ], total


def get_plan(session: Session, workspace_id: str, plan_id: str, *, today: dt.date) -> dict[str, Any]:
    row = crud.require(session, ServicePlan, plan_id, workspace_id=workspace_id, label="service plan")
    counts = _live_subscriber_counts(session, workspace_id, [row.id], today=today)
    return plan_payload(
        row,
        subscriber_count=counts.get(row.id, 0),
        service=row.service,
    )


def create_plan(
    session: Session, workspace_id: str, data: dict[str, Any], *, source: str = "user"
) -> dict[str, Any]:
    """Requires ``service_id`` (unknown ⇒ 422), ``name`` and ``price >= 0`` (§4)."""
    service_id = data.get("service_id")
    if not service_id:
        raise crud.validation(
            "service_id is required",
            [crud.field_error(["body", "service_id"], "a plan always packages a service")],
        )
    crud.validate_fk(session, Service, str(service_id), workspace_id=workspace_id, field="service_id")
    service = session.get(Service, str(service_id))
    name = str(data.get("name") or "").strip()
    if not name:
        raise _missing_name("name")
    price = _non_negative(data.get("price"), "price")
    if price is None:
        raise crud.validation(
            "price is required",
            [crud.field_error(["body", "price"], "a plan without a price is a description")],
        )
    currency = data.get("currency") or (service.currency if service else None)
    row = ServicePlan(
        workspace_id=workspace_id,
        service_id=str(service_id),
        name=name,
        interval=data.get("interval") or PlanInterval.MONTHLY.value,
        price=price,
        currency=money.require_currency(currency, "currency") if currency else None,
        included_units=_non_negative(data.get("included_units"), "included_units"),
        overage_rate=_non_negative(data.get("overage_rate"), "overage_rate"),
        trial_days=_trial_days(data.get("trial_days")),
        active=bool(data.get("active", True)),
        source=source,
    )
    session.add(row)
    session.flush()
    activity.created(
        session,
        workspace_id=workspace_id,
        entity_type="service_plan",
        entity_id=row.id,
        entity_title=row.name,
        project_id=None,
    )
    return plan_payload(row, subscriber_count=0, service=service)


def update_plan(
    session: Session, workspace_id: str, plan_id: str, data: dict[str, Any], *, today: dt.date
) -> dict[str, Any]:
    row = crud.require(session, ServicePlan, plan_id, workspace_id=workspace_id, label="service plan")
    if data.get("service_id"):
        crud.validate_fk(
            session, Service, str(data["service_id"]), workspace_id=workspace_id, field="service_id"
        )
        row.service_id = str(data["service_id"])
    if data.get("name") is not None:
        name = str(data["name"]).strip()
        if not name:
            raise _missing_name("name")
        row.name = name
    if "price" in data:
        price = _non_negative(data["price"], "price")
        if price is None:
            raise crud.validation(
                "price must not be null",
                [crud.field_error(["body", "price"], "a plan has to be priced")],
            )
        row.price = price
    if data.get("currency") is not None:
        row.currency = money.require_currency(data["currency"], "currency")
    for field in ("included_units", "overage_rate"):
        if field in data:
            setattr(row, field, _non_negative(data[field], field))
    for field in ("interval", "active"):
        if field in data:
            setattr(row, field, data[field])
    if "trial_days" in data:
        row.trial_days = _trial_days(data["trial_days"])
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="service_plan",
        entity_id=row.id,
        entity_title=row.name,
    )
    return get_plan(session, workspace_id, row.id, today=today)


def delete_plan(session: Session, workspace_id: str, plan_id: str) -> dict[str, Any]:
    row = crud.require(session, ServicePlan, plan_id, workspace_id=workspace_id, label="service plan")
    snapshot = {"id": row.id, "name": row.name}
    session.delete(row)
    session.flush()
    activity.deleted(
        session,
        workspace_id=workspace_id,
        entity_type="service_plan",
        entity_id=snapshot["id"],
        entity_title=snapshot["name"],
    )
    return snapshot


# -------------------------------------------------------------------------- validation


def _services_for(session: Session, plans: Sequence[ServicePlan]) -> dict[str, Service]:
    ids = {row.service_id for row in plans}
    if not ids:
        return {}
    return {
        row.id: row
        for row in session.scalars(sa.select(Service).where(Service.id.in_(list(ids))))
    }


def _missing_name(field: str) -> Any:
    return crud.validation(
        f"{field} is required",
        [crud.field_error(["body", field], f"{field} must not be empty")],
    )


def _non_negative(value: Any, field: str) -> Decimal | None:
    """Money-ish inputs: ``null`` is allowed (absent), a negative is a 422, never a silent 0."""
    if value is None or str(value).strip() == "":
        return None
    amount = Decimal(str(value))
    if amount < 0:
        raise crud.validation(
            f"{field} must not be negative",
            [crud.field_error(["body", field], f"{amount} is below zero")],
        )
    return amount


def _trial_days(value: Any) -> int | None:
    if value is None:
        return None
    days = int(value)
    if days < 0 or days > 90:
        raise crud.validation(
            "trial_days must be between 0 and 90",
            [crud.field_error(["body", "trial_days"], f"{days} is outside 0..90")],
        )
    return days


__all__ = [
    "create_plan",
    "create_service",
    "delete_plan",
    "delete_service",
    "get_plan",
    "list_plans",
    "list_services",
    "plan_payload",
    "revenue_for",
    "service_detail",
    "service_payload",
    "update_plan",
    "update_service",
]
