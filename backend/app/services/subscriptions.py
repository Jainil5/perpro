"""Subscriptions: the recurring commitments screen.

The stored columns say what a commitment costs and when it started; the screen needs to
know what it costs **per month**, when it next bills, and whether it bills at all any
more. All four are derived here (§7) and none is stored, so editing a price or pausing a
row cannot leave a stale monthly figure behind.

Three rules from PHASE3_FINANCE.md §4 shape the endpoints:

* ``started_on``, ``price`` and ``currency`` are required; ``interval`` is validated
  against ``plan.interval`` even though §13 gives the column no CHECK.
* a live row whose ``renews_on`` has passed is *accepted* and flagged in ``warnings`` -
  people log real renewals late, and refusing the row would lose the commitment entirely.
* ``cancelled_on`` before ``started_on`` is a 422: that row cannot be drawn on a timeline.

``sort=cost`` orders on the normalised monthly figure, which is not a column, so the
whole filtered set is read before paging. That is the only Finance list that has to: a
workspace's subscriptions are a list you can read at a glance, not a ledger.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.errors import field_error, validation
from app.core.utils import today_utc
from app.models import Company, ServicePlan, Subscription
from app.models.enums import PlanInterval, SubscriptionStatus
from app.services import activity, crud, money, rates

#: ``renews=`` windows (§4): what renews this month, this week, or already slipped past
RENEWS_WINDOWS = ("month", "week", "past")

#: the §5 ``plan.interval`` values; §13 gives the column no CHECK, so this is the contract
INTERVALS = tuple(item.value for item in PlanInterval)

#: sort key -> (column, default direction); ``cost`` is handled in Python below
_SORTS: dict[str, tuple[Any, str]] = {
    "renews": (Subscription.renews_on, "asc"),
    "price": (Subscription.price, "desc"),
    "created": (Subscription.created_at, "desc"),
}


def _order(sort: str, direction: str | None) -> tuple[Any, ...]:
    """Flip the key column only; ``id`` stays the final ascending tiebreaker (§4 addendum)."""
    column, default = _SORTS[sort]
    key = column.asc() if (direction or default).lower() == "asc" else column.desc()
    if sort == "renews":
        # a row that never renews belongs at the bottom of a renewal list in both
        # directions, so NULLs are pinned last rather than sorted as the smallest date
        return (Subscription.renews_on.is_(None).asc(), key, Subscription.price.asc(), Subscription.id.asc())
    return (key, Subscription.id.asc())


def _renews_on(row: Subscription, today: dt.date) -> dt.date | None:
    """The stored renewal date, or the next one its interval implies from ``started_on``.

    Derived, never written back: a recurring row with no ``renews_on`` still renews, and
    the screen has to say when.
    """
    if row.renews_on is not None:
        return row.renews_on
    if row.interval in PlanInterval.recurring():
        return money.next_occurrence(row.started_on, row.interval, today=today)
    return None


def is_running(row: Subscription, today: dt.date) -> bool:
    """Whether this row still bills: live status, started, and not cancelled yet (§4)."""
    if row.status not in SubscriptionStatus.live():
        return False
    if row.started_on > today:
        return False
    return row.cancelled_on is None or row.cancelled_on > today


def subscription_payload(row: Subscription, *, today: dt.date | None = None) -> dict[str, Any]:
    """One subscription plus the derived block §4 promises."""
    day = today or today_utc()
    monthly = money.monthly_normalise(row.price, row.interval)
    renews_on = _renews_on(row, day)
    plan = row.plan
    return {
        "id": row.id,
        "plan_id": row.plan_id,
        "plan": (
            {"id": plan.id, "name": plan.name, "interval": plan.interval} if plan is not None else None
        ),
        "company_id": row.company_id,
        "label": money.subscription_label(row),
        "status": row.status,
        "started_on": row.started_on,
        "renews_on": renews_on,
        "renews_in_days": None if renews_on is None else (renews_on - day).days,
        "cancelled_on": row.cancelled_on,
        "price": money.money(row.price, row.currency),
        "currency": row.currency,
        "interval": row.interval,
        "monthly_cost": None if monthly is None else money.money(monthly, row.currency),
        "annual_cost": None if monthly is None else money.money(monthly * Decimal(12), row.currency),
        "invoice_number": row.invoice_number,
        "notes": row.notes,
        "source": row.source,
        "is_running": is_running(row, day),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def warnings_for(row: Subscription, today: dt.date) -> list[str]:
    """What §4 asks the API to flag rather than refuse."""
    notes: list[str] = []
    renews_on = _renews_on(row, today)
    if row.status in SubscriptionStatus.live() and renews_on is not None and renews_on < today:
        notes.append(
            f"this {row.status} subscription was due on {renews_on}; "
            "log the renewal or set a future renews_on"
        )
    if row.interval == PlanInterval.ONE_TIME.value and row.renews_on is not None:
        notes.append("a one_time subscription does not renew; renews_on is shown but not used")
    if row.status == SubscriptionStatus.CANCELLED.value and row.cancelled_on is None:
        notes.append("cancelled without a cancelled_on date: the row is excluded from MRR but not dated")
    if row.started_on > today:
        notes.append("starts in the future; it does not count towards the burn until it does")
    return notes


def _window(row: Subscription, renews: str, today: dt.date) -> bool:
    """§4's ``renews=`` filter: only a row that still bills can renew in any window.

    ``live`` is the same test the burn and the overview's ``renewing_this_month`` use, so a
    cancelled or paused row cannot appear in "renews this month" here while being absent
    there.  A paused row keeps its ``renews_on`` - it is stored, just not due.
    """
    if row.status not in SubscriptionStatus.live():
        return False
    renews_on = _renews_on(row, today)
    if renews_on is None:
        return False
    if renews == "past":
        return renews_on < today
    if renews == "week":
        return today <= renews_on <= today + dt.timedelta(days=7)
    return money.month_floor(today) <= renews_on <= money.month_last(today)


# ---------------------------------------------------------------------------- the list


def list_subscriptions(
    session: Session,
    workspace_id: str,
    *,
    status: str | None = None,
    renews: str | None = None,
    query: str | None = None,
    company_id: str | None = None,
    plan_id: str | None = None,
    currency: str | None = None,
    sort: str = "renews",
    direction: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    today: dt.date | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """``GET /subscriptions`` - every derived figure is recomputed per row, per call."""
    day = today or today_utc()
    conditions = [Subscription.workspace_id == workspace_id]
    if status:
        conditions.append(Subscription.status == status)
    if company_id:
        conditions.append(Subscription.company_id == company_id)
    if plan_id:
        conditions.append(Subscription.plan_id == plan_id)
    if currency:
        conditions.append(Subscription.currency == rates.code_or_422(currency, "currency", in_query=True))
    if query:
        needle = query.strip()
        conditions.append(
            sa.or_(
                crud.text_match(Subscription.invoice_number, needle),
                crud.text_match(Subscription.notes, needle),
                crud.text_match(ServicePlan.name, needle),
            )
        )
    statement = (
        sa.select(Subscription)
        .outerjoin(ServicePlan, ServicePlan.id == Subscription.plan_id)
        .where(*conditions)
    )
    order = _order(sort, direction) if sort in _SORTS else (Subscription.id,)
    rows = list(session.scalars(statement.order_by(*order)))
    if renews:
        rows = [row for row in rows if _window(row, renews, day)]
    payloads = [subscription_payload(row, today=day) for row in rows]
    if sort == "cost":
        descending = (direction or "desc").lower() == "desc"
        # a normalised monthly figure that does not exist (one_time) sorts last either way
        payloads.sort(key=lambda item: (item["monthly_cost"] is None, item["label"]))
        payloads.sort(key=lambda item: item["monthly_cost"] or Decimal(0), reverse=descending)
    total = len(payloads)
    if limit is not None:
        payloads = payloads[max(0, offset) : max(0, offset) + limit]
    return payloads, total


def get_subscription(
    session: Session, workspace_id: str, subscription_id: str, *, today: dt.date | None = None
) -> dict[str, Any]:
    row = crud.require(
        session, Subscription, subscription_id, workspace_id=workspace_id, label="subscription"
    )
    return _with_warnings(row, today or today_utc())


# --------------------------------------------------------------------------- the write


def _interval(data: dict[str, Any], fallback: str | None) -> str | None:
    if "interval" not in data:
        return fallback
    raw = data["interval"]
    if raw is None or str(raw).strip() == "":
        return None
    key = str(raw).strip().lower()
    if key not in INTERVALS:
        raise validation(
            "interval is not a supported plan interval",
            [field_error(["body", "interval"], f"'{raw}' is not one of {', '.join(INTERVALS)}")],
        )
    return key


def _status(data: dict[str, Any], fallback: str) -> str:
    if not data.get("status"):
        return fallback
    key = str(data["status"]).strip().lower()
    allowed = tuple(item.value for item in SubscriptionStatus)
    if key not in allowed:
        raise validation(
            "status is not a supported subscription status",
            [field_error(["body", "status"], f"'{data.get('status')}' is not one of {', '.join(allowed)}")],
        )
    return key


def _dates(
    data: dict[str, Any], row: Subscription | None
) -> tuple[dt.date, dt.date | None, dt.date | None]:
    """``started_on`` / ``renews_on`` / ``cancelled_on`` with the §4 ordering rule applied."""
    started_on = data["started_on"] if "started_on" in data else (row.started_on if row else None)
    renews_on = data.get("renews_on") if "renews_on" in data else (row.renews_on if row else None)
    cancelled_on = (
        data.get("cancelled_on") if "cancelled_on" in data else (row.cancelled_on if row else None)
    )
    if started_on is None:
        raise validation(
            "started_on is required",
            [field_error(["body", "started_on"], "a commitment has to start somewhere")],
        )
    if cancelled_on is not None and cancelled_on < started_on:
        raise validation(
            "cancelled_on must not precede started_on",
            [field_error(["body", "cancelled_on"], f"{cancelled_on} is before started_on {started_on}")],
        )
    return started_on, renews_on, cancelled_on


def _price(data: dict[str, Any], fallback: Decimal | None) -> Decimal:
    raw = data["price"] if "price" in data else fallback
    if raw is None or str(raw).strip() == "":
        raise validation(
            "price is required",
            [field_error(["body", "price"], "a subscription without a price is a reminder")],
        )
    amount = Decimal(str(raw))
    if amount < 0:
        raise validation(
            "price must not be negative",
            [field_error(["body", "price"], f"{amount} is below zero")],
        )
    return amount


def _currency(data: dict[str, Any], fallback: str | None) -> str:
    """Required on create (§4); on patch, absent keeps the row's own currency."""
    raw = data.get("currency", fallback)
    if raw is None:
        raise validation(
            "currency is required",
            [field_error(["body", "currency"], "every money-bearing row carries an explicit currency")],
        )
    return money.require_currency(raw, "currency")


def _write(
    session: Session,
    workspace_id: str,
    data: dict[str, Any],
    *,
    source: str | None = None,
    row: Subscription | None = None,
) -> Subscription:
    """One body for POST and PATCH: validate, assign, flush, keep the row shape identical."""
    if "plan_id" in data:
        plan_id = data["plan_id"]
        if plan_id:
            crud.validate_fk(session, ServicePlan, str(plan_id), workspace_id=workspace_id, field="plan_id")
    else:
        plan_id = row.plan_id if row else None
    if data.get("company_id"):
        crud.validate_fk(
            session, Company, str(data["company_id"]), workspace_id=workspace_id, field="company_id"
        )
    started_on, renews_on, cancelled_on = _dates(data, row)
    if row is None:
        row = Subscription(workspace_id=workspace_id, source=source or "user")
        session.add(row)
    row.plan_id = plan_id
    if data.get("company_id"):
        row.company_id = str(data["company_id"])
    row.status = _status(data, row.status or SubscriptionStatus.ACTIVE.value)
    row.started_on = started_on
    row.renews_on = renews_on
    row.cancelled_on = cancelled_on
    row.price = _price(data, row.price)
    row.currency = _currency(data, row.currency)
    row.interval = _interval(data, row.interval or PlanInterval.MONTHLY.value)
    for field in ("invoice_number", "notes"):
        if field in data:
            setattr(row, field, data[field])
    session.flush()
    return row


def _with_warnings(row: Subscription, today: dt.date) -> dict[str, Any]:
    payload = subscription_payload(row, today=today)
    payload["warnings"] = warnings_for(row, today)
    return payload


def create_subscription(
    session: Session,
    workspace_id: str,
    data: dict[str, Any],
    *,
    today: dt.date | None = None,
    source: str = "user",
) -> dict[str, Any]:
    day = today or today_utc()
    if "price" not in data:
        raise validation(
            "price is required",
            [field_error(["body", "price"], "a subscription without a price is a reminder")],
        )
    row = _write(session, workspace_id, data, source=source)
    activity.created(
        session,
        workspace_id=workspace_id,
        entity_type="subscription",
        entity_id=row.id,
        entity_title=money.subscription_label(row),
    )
    return _with_warnings(row, day)


def update_subscription(
    session: Session,
    workspace_id: str,
    subscription_id: str,
    data: dict[str, Any],
    *,
    today: dt.date | None = None,
) -> dict[str, Any]:
    day = today or today_utc()
    row = crud.require(
        session, Subscription, subscription_id, workspace_id=workspace_id, label="subscription"
    )
    _write(session, workspace_id, data, row=row)
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="subscription",
        entity_id=row.id,
        entity_title=money.subscription_label(row),
    )
    return _with_warnings(row, day)


def delete_subscription(session: Session, workspace_id: str, subscription_id: str) -> dict[str, Any]:
    row = crud.require(
        session, Subscription, subscription_id, workspace_id=workspace_id, label="subscription"
    )
    snapshot = {
        "id": row.id,
        "label": money.subscription_label(row),
        "price": money.money(row.price, row.currency),
        "currency": row.currency,
    }
    session.delete(row)
    session.flush()
    activity.deleted(
        session,
        workspace_id=workspace_id,
        entity_type="subscription",
        entity_id=snapshot["id"],
        entity_title=snapshot["label"],
    )
    return snapshot


# --------------------------------------------------------------- pause / resume / cancel


def _set_status(
    session: Session,
    workspace_id: str,
    subscription_id: str,
    status: str,
    *,
    today: dt.date,
    summary: str,
) -> dict[str, Any]:
    """The shared body of ``/pause``, ``/resume`` and ``/cancel`` (§4)."""
    row = crud.require(
        session, Subscription, subscription_id, workspace_id=workspace_id, label="subscription"
    )
    row.status = status
    if status == SubscriptionStatus.CANCELLED.value:
        # cancelling today cannot pre-date the commitment (§4), so a future-dated row
        # collapses to its own start rather than failing the request
        row.cancelled_on = today if today >= row.started_on else row.started_on
    elif row.cancelled_on is not None:
        # pausing and resuming both say "this is still a commitment", so it stops being cancelled
        row.cancelled_on = None
    if status in SubscriptionStatus.live() and row.renews_on is not None and row.renews_on < today:
        # pushing a stale renewal forward is what the screen does by hand; doing it here
        # keeps the derived warning honest instead of permanent
        row.renews_on = money.next_occurrence(
            row.started_on, row.interval or PlanInterval.MONTHLY.value, today=today
        )
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="subscription",
        entity_id=row.id,
        entity_title=money.subscription_label(row),
        summary=summary,
    )
    return _with_warnings(row, today)


def pause(
    session: Session, workspace_id: str, subscription_id: str, *, today: dt.date | None = None
) -> dict[str, Any]:
    day = today or today_utc()
    row = crud.require(
        session, Subscription, subscription_id, workspace_id=workspace_id, label="subscription"
    )
    return _set_status(
        session,
        workspace_id,
        subscription_id,
        SubscriptionStatus.PAUSED.value,
        today=day,
        summary=f"Paused “{money.subscription_label(row)}”",
    )


def resume(
    session: Session, workspace_id: str, subscription_id: str, *, today: dt.date | None = None
) -> dict[str, Any]:
    day = today or today_utc()
    row = crud.require(
        session, Subscription, subscription_id, workspace_id=workspace_id, label="subscription"
    )
    return _set_status(
        session,
        workspace_id,
        subscription_id,
        SubscriptionStatus.ACTIVE.value,
        today=day,
        summary=f"Resumed “{money.subscription_label(row)}”",
    )


def cancel(
    session: Session, workspace_id: str, subscription_id: str, *, today: dt.date | None = None
) -> dict[str, Any]:
    day = today or today_utc()
    row = crud.require(
        session, Subscription, subscription_id, workspace_id=workspace_id, label="subscription"
    )
    return _set_status(
        session,
        workspace_id,
        subscription_id,
        SubscriptionStatus.CANCELLED.value,
        today=day,
        summary=f"Cancelled “{money.subscription_label(row)}”",
    )


__all__ = [
    "INTERVALS",
    "RENEWS_WINDOWS",
    "cancel",
    "create_subscription",
    "delete_subscription",
    "get_subscription",
    "is_running",
    "list_subscriptions",
    "pause",
    "resume",
    "subscription_payload",
    "update_subscription",
    "warnings_for",
]
