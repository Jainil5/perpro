"""Cost scenarios: a plan for the next N months, recomputed from its items on every read.

The one hard rule here (§4, DATA_MODEL §7) is that **the curve is never stored**. A
scenario row holds only its shape - name, kind, start month, horizon, currency, status -
and the months, the totals, the break-even month and the runway are derived from
``cost_scenario_items`` on every call. That is what makes "edit an item, the projection
moves" true rather than hoped for, and it is why ``GET /cost-scenarios/{id}`` returns items
nested instead of a cached total.

The curve itself (§3):

* an item is live in a month when the month overlaps ``[starts_on, ends_on]`` (an open end
  means "still running");
* its monthly figure is :func:`app.services.money.monthly_normalise` with the *scenario*
  horizon, so ``one_time`` divides by the horizon rather than vanishing;
* the sign comes from ``direction`` - ``cost`` reduces the net, ``income`` adds to it - via
  :func:`app.services.money.scenario_monthly`;
* ``cumulative`` runs from zero at the start month, so ``break_even_month`` is §3 read
  verbatim: the first month whose cumulative net is ``>= 0``, ``None`` when the horizon
  ends before that happens. An empty scenario therefore breaks even in its first month -
  no cost is indeed covered - rather than the code inventing a stricter rule the contract
  does not have.

Money is summed **per currency and converted per month** (:mod:`app.services.rates`), which
means a mixed-currency scenario needs a named ``?currency=`` - or the projection says
``null`` instead of inventing a total (§2.3).

``activate`` is the one write with a side effect on another row: §13's "one ``active`` per
workspace" is a rule the database cannot express, so the previous active scenario is
archived in the same transaction and *named* in the response, because silently replacing
someone's plan is not an acceptable API.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.errors import conflict, field_error, validation
from app.models import CostScenario, CostScenarioItem, ExpenseCategory, IncomeProfile
from app.models.enums import ScenarioDirection, ScenarioKind, ScenarioStatus
from app.services import activity, crud, money

SCENARIO_KINDS = tuple(item.value for item in ScenarioKind)
SCENARIO_STATUSES = tuple(item.value for item in ScenarioStatus)
DIRECTIONS = tuple(item.value for item in ScenarioDirection)
#: the recurrence set a scenario item may carry - §13 gives it no CHECK, §5 no enum key
RECURRENCES = money.SCENARIO_RECURRENCES

#: sort key -> (column, default direction); ``id`` is the always-ascending final tiebreaker
_SORTS: dict[str, tuple[Any, str]] = {
    "name": (CostScenario.name, "asc"),
    "start": (CostScenario.start_month, "asc"),
    "created": (CostScenario.created_at, "desc"),
    "updated": (CostScenario.updated_at, "desc"),
}


def _order(sort: str, direction: str | None) -> tuple[Any, ...]:
    """Flip only the requested key - the contract addendum's ``?dir=`` rule."""
    column, default = _SORTS[sort]
    asc = (direction or default).lower() == "asc"
    return ((column.asc() if asc else column.desc()), CostScenario.id.asc())


# ------------------------------------------------------------------------- scenarios


def scenario_payload(row: CostScenario, *, items: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """The stored shape. No figure derived from the items is in here - by design (§4)."""
    payload: dict[str, Any] = {
        "id": row.id,
        "name": row.name,
        "kind": row.kind,
        "horizon_months": row.horizon_months,
        "start_month": row.start_month,
        "currency": row.currency,
        "base_income_profile_id": row.base_income_profile_id,
        "assumptions": row.assumptions or {},
        "status": row.status,
        "notes": row.notes,
        "source": row.source,
        "item_count": len(row.items) if row.items is not None else 0,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }
    if items is not None:
        payload["items"] = items
    return payload


def list_scenarios(
    session: Session,
    workspace_id: str,
    *,
    status: str | None = None,
    kind: str | None = None,
    query: str | None = None,
    sort: str = "updated",
    direction: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    conditions = [CostScenario.workspace_id == workspace_id]
    if status:
        conditions.append(CostScenario.status == status)
    if kind:
        conditions.append(CostScenario.kind == kind)
    if query:
        needle = query.strip()
        conditions.append(
            sa.or_(
                crud.text_match(CostScenario.name, needle),
                crud.text_match(CostScenario.notes, needle),
            )
        )
    total = int(
        session.scalar(sa.select(sa.func.count()).select_from(CostScenario).where(*conditions)) or 0
    )
    statement = sa.select(CostScenario).where(*conditions).order_by(*_order(sort, direction))
    return [scenario_payload(row) for row in session.scalars(statement)], total


def get_scenario(session: Session, workspace_id: str, scenario_id: str) -> dict[str, Any]:
    row = crud.require(session, CostScenario, scenario_id, workspace_id=workspace_id, label="scenario")
    return scenario_payload(row, items=[item_payload(item) for item in _items(session, row)])


def create_scenario(
    session: Session, workspace_id: str, data: dict[str, Any], *, source: str = "user"
) -> dict[str, Any]:
    name = str(data.get("name") or "").strip()
    if not name:
        raise validation(
            "name is required", [field_error(["body", "name"], "a plan you cannot name is a plan you cannot pick")]
        )
    if data.get("start_month") in (None, ""):
        raise validation(
            "start_month is required",
            [field_error(["body", "start_month"], "the curve needs a first month")],
        )
    horizon = _horizon(data.get("horizon_months"))
    row = CostScenario(
        workspace_id=workspace_id,
        name=name,
        kind=_kind(data.get("kind")),
        horizon_months=horizon,
        start_month=money.month_floor(data["start_month"]),
        currency=_currency(data.get("currency")),
        base_income_profile_id=_profile(session, workspace_id, data.get("base_income_profile_id")),
        assumptions=_assumptions(data.get("assumptions")),
        status=_status(data.get("status")),
        notes=_text(data.get("notes")),
        source=source,
    )
    session.add(row)
    session.flush()
    activity.created(
        session, workspace_id=workspace_id, entity_type="scenario", entity_id=row.id, entity_title=row.name
    )
    return scenario_payload(row, items=[])


def update_scenario(
    session: Session, workspace_id: str, scenario_id: str, data: dict[str, Any]
) -> dict[str, Any]:
    row = crud.require(session, CostScenario, scenario_id, workspace_id=workspace_id, label="scenario")
    if data.get("name") is not None:
        name = str(data["name"]).strip()
        if not name:
            raise validation(
                "name must not be empty", [field_error(["body", "name"], "keep the plan nameable")]
            )
        row.name = name
    if data.get("kind") is not None:
        row.kind = _kind(data["kind"])
    if data.get("horizon_months") is not None:
        row.horizon_months = _horizon(data["horizon_months"])
    if data.get("start_month") is not None:
        row.start_month = money.month_floor(data["start_month"])
    if data.get("currency") is not None:
        row.currency = _currency(data["currency"])
    if "base_income_profile_id" in data:
        row.base_income_profile_id = _profile(session, workspace_id, data["base_income_profile_id"])
    if "assumptions" in data:
        row.assumptions = _assumptions(data["assumptions"])
    if data.get("status") is not None:
        row.status = _status(data["status"])
        if row.status == ScenarioStatus.ACTIVE.value:
            _archive_previous(session, workspace_id, row)
    if "notes" in data:
        row.notes = _text(data["notes"])
    # a shorter horizon re-shapes a one_time item's monthly slice, so it is not a no-op
    session.flush()
    activity.updated(
        session, workspace_id=workspace_id, entity_type="scenario", entity_id=row.id, entity_title=row.name
    )
    return get_scenario(session, workspace_id, row.id)


def delete_scenario(session: Session, workspace_id: str, scenario_id: str) -> dict[str, Any]:
    """Items go with it (§13 ``ON DELETE CASCADE``), so no orphan curve can be left behind."""
    row = crud.require(session, CostScenario, scenario_id, workspace_id=workspace_id, label="scenario")
    snapshot = {"id": row.id, "name": row.name}
    session.delete(row)
    session.flush()
    activity.deleted(
        session,
        workspace_id=workspace_id,
        entity_type="scenario",
        entity_id=snapshot["id"],
        entity_title=snapshot["name"],
    )
    return snapshot


def duplicate(session: Session, workspace_id: str, scenario_id: str) -> dict[str, Any]:
    """``POST /cost-scenarios/{id}/duplicate`` - a copy that starts as a draft (§4)."""
    row = crud.require(session, CostScenario, scenario_id, workspace_id=workspace_id, label="scenario")
    clone = CostScenario(
        workspace_id=workspace_id,
        name=_next_name(session, workspace_id, row.name),
        kind=row.kind,
        horizon_months=row.horizon_months,
        start_month=row.start_month,
        currency=row.currency,
        base_income_profile_id=row.base_income_profile_id,
        assumptions=dict(row.assumptions or {}),
        status=ScenarioStatus.DRAFT.value,
        notes=row.notes,
        source=row.source,
    )
    session.add(clone)
    session.flush()
    copied = 0
    for item in _items(session, row):
        session.add(
            CostScenarioItem(
                workspace_id=workspace_id,
                scenario_id=clone.id,
                label=item.label,
                direction=item.direction,
                amount=item.amount,
                currency=item.currency,
                recurrence=item.recurrence,
                starts_on=item.starts_on,
                ends_on=item.ends_on,
                category_id=item.category_id,
                notes=item.notes,
            )
        )
        copied += 1
    session.flush()
    activity.created(
        session,
        workspace_id=workspace_id,
        entity_type="scenario",
        entity_id=clone.id,
        entity_title=clone.name,
        summary=activity.summary_for("created", clone.name, detail=f"(copy of {row.name})"),
    )
    return {"scenario": get_scenario(session, workspace_id, clone.id), "copied_items": copied}


def activate(session: Session, workspace_id: str, scenario_id: str) -> dict[str, Any]:
    """Make this the one ``active`` scenario; the previous one is archived and named (§4)."""
    row = crud.require(session, CostScenario, scenario_id, workspace_id=workspace_id, label="scenario")
    previous = _archive_previous(session, workspace_id, row)
    row.status = ScenarioStatus.ACTIVE.value
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="scenario",
        entity_id=row.id,
        entity_title=row.name,
        summary=activity.summary_for(
            "updated", row.name, detail="set active" + (f" (archived {previous['name']})" if previous else "")
        ),
        payload={"archived": previous} if previous else {},
    )
    return {"scenario": get_scenario(session, workspace_id, row.id), "archived": previous}


def _archive_previous(
    session: Session, workspace_id: str, keep: CostScenario
) -> dict[str, Any] | None:
    """Archive the *other* active scenario, so the invariant is restored inside this call."""
    row = session.scalar(
        sa.select(CostScenario).where(
            CostScenario.workspace_id == workspace_id,
            CostScenario.status == ScenarioStatus.ACTIVE.value,
            CostScenario.id != keep.id,
        )
    )
    if row is None:
        return None
    named = {"id": row.id, "name": row.name}
    row.status = ScenarioStatus.ARCHIVED.value
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="scenario",
        entity_id=row.id,
        entity_title=row.name,
        summary=activity.summary_for("updated", row.name, detail="archived: another scenario was activated"),
    )
    return named


# ------------------------------------------------------------------------------ items


def item_payload(row: CostScenarioItem) -> dict[str, Any]:
    """One item, plus the monthly slice the curve will use (derived, never stored).

    ``monthly_amount`` is signed the way :func:`projection` signs it - ``cost`` negative,
    ``income`` positive - and a ``one_time`` figure only *has* a monthly value inside a
    horizon, so the divisor is this item's own scenario horizon.
    """
    scenario = row.scenario
    monthly = money.scenario_monthly(
        row.amount, row.direction, row.recurrence, scenario.horizon_months if scenario else 0
    )
    return {
        "id": row.id,
        "scenario_id": row.scenario_id,
        "label": row.label,
        "direction": row.direction,
        "amount": money.money(row.amount, row.currency or "USD"),
        "currency": row.currency,
        "recurrence": row.recurrence,
        "monthly_amount": None if monthly is None else money.money(monthly, row.currency or "USD"),
        "starts_on": row.starts_on,
        "ends_on": row.ends_on,
        "category_id": row.category_id,
        "notes": row.notes,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def list_items(session: Session, workspace_id: str, scenario_id: str) -> tuple[list[dict[str, Any]], int]:
    row = crud.require(session, CostScenario, scenario_id, workspace_id=workspace_id, label="scenario")
    items = [item_payload(item) for item in _items(session, row)]
    return items, len(items)


def create_item(
    session: Session, workspace_id: str, scenario_id: str, data: dict[str, Any]
) -> dict[str, Any]:
    scenario = crud.require(
        session, CostScenario, scenario_id, workspace_id=workspace_id, label="scenario"
    )
    if data.get("scenario_id") not in (None, "", scenario.id):
        raise conflict(
            "an item always belongs to the scenario in the path",
            [field_error(["body", "scenario_id"], f"the path says {scenario.id}, the body says {data['scenario_id']}")],
        )
    label = str(data.get("label") or "").strip()
    if not label:
        raise validation(
            "label is required", [field_error(["body", "label"], "a curve needs labelled lines")]
        )
    amount = _amount(data.get("amount"))
    if amount is None:
        raise validation(
            "amount is required", [field_error(["body", "amount"], "an item without a figure changes nothing")]
        )
    currency = _currency(data.get("currency"))
    row = CostScenarioItem(
        workspace_id=workspace_id,
        scenario_id=scenario.id,
        label=label,
        direction=_direction(data.get("direction")),
        amount=money.money(amount, currency or "USD"),
        currency=currency,
        recurrence=_recurrence(data.get("recurrence")),
        starts_on=_day(data.get("starts_on"), "starts_on"),
        ends_on=_day(data.get("ends_on"), "ends_on"),
        category_id=_category(session, workspace_id, data.get("category_id")),
        notes=_text(data.get("notes")),
    )
    _check_dates(row)
    session.add(row)
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="scenario",
        entity_id=scenario.id,
        entity_title=scenario.name,
        summary=activity.summary_for("updated", scenario.name, detail=f"added {row.label}"),
    )
    return item_payload(row)


def update_item(
    session: Session, workspace_id: str, item_id: str, data: dict[str, Any]
) -> dict[str, Any]:
    row = crud.require(session, CostScenarioItem, item_id, workspace_id=workspace_id, label="scenario item")
    if data.get("scenario_id") not in (None, "", row.scenario_id):
        target = crud.require(
            session, CostScenario, str(data["scenario_id"]), workspace_id=workspace_id, label="scenario"
        )
        row.scenario_id = target.id
    if data.get("label") is not None:
        label = str(data["label"]).strip()
        if not label:
            raise validation(
                "label must not be empty", [field_error(["body", "label"], "the curve legend reads this")]
            )
        row.label = label
    if data.get("direction") is not None:
        row.direction = _direction(data["direction"])
    if data.get("amount") is not None:
        amount = _amount(data["amount"])
        if amount is None:
            raise validation(
                "amount must not be null",
                [field_error(["body", "amount"], "an item cannot be emptied - delete it instead")],
            )
        row.amount = money.money(amount, row.currency or "USD")
    if data.get("currency") is not None:
        row.currency = _currency(data["currency"])
    if "recurrence" in data:
        row.recurrence = _recurrence(data["recurrence"])
    if "starts_on" in data:
        row.starts_on = _day(data["starts_on"], "starts_on")
    if "ends_on" in data:
        row.ends_on = _day(data["ends_on"], "ends_on")
    if "category_id" in data:
        row.category_id = _category(session, workspace_id, data["category_id"])
    if "notes" in data:
        row.notes = _text(data["notes"])
    _check_dates(row)
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="scenario_item",
        entity_id=row.id,
        entity_title=row.label,
    )
    return item_payload(row)


def delete_item(session: Session, workspace_id: str, item_id: str) -> dict[str, Any]:
    row = crud.require(session, CostScenarioItem, item_id, workspace_id=workspace_id, label="scenario item")
    snapshot = {"id": row.id, "name": row.label}
    session.delete(row)
    session.flush()
    activity.deleted(
        session,
        workspace_id=workspace_id,
        entity_type="scenario_item",
        entity_id=snapshot["id"],
        entity_title=snapshot["name"],
    )
    return snapshot


# ------------------------------------------------------------------------ projection


def _months(scenario: CostScenario, horizon: int) -> list[dt.date]:
    """The projection axis: ``horizon`` month starts from ``start_month`` (§3)."""
    first = money.month_floor(scenario.start_month)
    return [money.shift_month(first, index) for index in range(horizon)]


def _live_in(item: CostScenarioItem, month_first: dt.date, month_end: dt.date) -> bool:
    """Does the item cover any of this month? An open ``ends_on`` means "still running"."""
    start = item.starts_on
    if start is not None and start > month_end:
        return False
    end = item.ends_on
    if end is not None and end < month_first:
        return False
    return True


def projection(
    session: Session,
    workspace_id: str,
    scenario_id: str,
    *,
    today: dt.date,
    horizon_months: int | None = None,
    currency: str | None = None,
) -> dict[str, Any]:
    """``GET /cost-scenarios/{id}/projection`` - the curve, recomputed here and now.

    ``?horizon_months=`` asks for a different window than the stored one; the items are the
    same rows, only the axis (and a ``one_time`` item's divisor) changes.
    """
    scenario = crud.require(
        session, CostScenario, scenario_id, workspace_id=workspace_id, label="scenario"
    )
    horizon = _horizon(horizon_months, allow_none=True) or scenario.horizon_months
    target = currency.strip().upper() if currency else None
    if target:
        money.require_currency(target, "currency", in_query=True)
    months = _months(scenario, horizon)
    items = _items(session, scenario)

    codes = {item.currency for item in items if item.currency}
    if scenario.currency:
        codes.add(scenario.currency)
    resolved = money.resolve_currency(codes, target, fallback=scenario.currency)

    rows: list[dict[str, Any]] = []
    running = Decimal(0)
    for month in months:
        month_end = money.month_last(month)
        income: dict[str, Decimal] = {}
        cost: dict[str, Decimal] = {}
        for item in items:
            if not _live_in(item, month, month_end):
                continue
            monthly = money.scenario_monthly(item.amount, item.direction, item.recurrence, horizon)
            if monthly is None:
                continue
            bucket = income if item.direction == ScenarioDirection.INCOME.value else cost
            code = item.currency or resolved or "USD"
            bucket[code] = bucket.get(code, Decimal(0)) + abs(monthly)
        earned = money.sum_tally(session, workspace_id, income, resolved, as_of=month, today=today)
        spent = money.sum_tally(session, workspace_id, cost, resolved, as_of=month, today=today)
        net = (
            None
            if earned is None or spent is None
            else money.money(earned - spent, resolved or "USD")
        )
        if net is not None:
            running += net
        rows.append(
            {
                "month": money.month_label(month),
                "income": earned,
                "cost": spent,
                "net": net,
                "cumulative": None if net is None else money.money(running, resolved or "USD"),
            }
        )
    totals = {
        "income": _column_total(rows, "income", resolved),
        "cost": _column_total(rows, "cost", resolved),
        "net": _column_total(rows, "net", resolved),
    }
    return {
        "scenario": scenario_payload(scenario),
        "currency": resolved,
        "horizon_months": horizon,
        "months": rows,
        "totals": totals,
        "break_even_month": break_even_month(rows),
        "runway_months": runway_months(rows, resolved),
        "assumptions": dict(scenario.assumptions or {}),
    }


def _column_total(rows: list[dict[str, Any]], field: str, code: str | None) -> Decimal | None:
    """Sum a projection column - only when every month could be named in one currency."""
    if code is None:
        return None
    values = [row[field] for row in rows]
    if any(value is None for value in values):
        return None
    return money.money(sum(values, Decimal(0)), code)


def break_even_month(rows: list[dict[str, Any]]) -> str | None:
    """§3 verbatim: the first month whose cumulative net is ``>= 0``, else ``None``."""
    for row in rows:
        if row["cumulative"] is not None and row["cumulative"] >= 0:
            return row["month"]
    return None


def runway_months(rows: list[dict[str, Any]], code: str | None) -> float | None:
    """How many months of this curve the plan can pay for before it goes under.

    §3 only defines the overview's runway (``cash_in / monthly_burn``), so for a scenario
    the honest reading is "months until cumulative net turns negative". ``None`` when the
    curve never goes negative inside the horizon: an unbounded runway is not a JSON
    number, and the overview already says so (§3).
    """
    if code is None:
        return None
    for index, row in enumerate(rows):
        cumulative = row["cumulative"]
        if cumulative is not None and cumulative < 0:
            return float(index)
    return None


def compare(
    session: Session,
    workspace_id: str,
    *,
    a_id: str,
    b_id: str,
    currency: str | None = None,
    today: dt.date,
) -> dict[str, Any]:
    """``GET /cost-scenarios/compare?a=&b=`` - both curves on one axis, plus the delta.

    The axis is the union of the two horizons, so a 6-month plan can be read against a
    24-month one without either curve being cut or padded with invented months.  ``a`` and
    ``b`` keep their own plan's currency; ``delta`` is only printed when the two share one,
    or when the caller named a target for both (§2.3).
    """
    left = projection(session, workspace_id, a_id, today=today, currency=currency)
    right = projection(session, workspace_id, b_id, today=today, currency=currency)
    resolved = _shared_currency(left, right, currency)
    axis = _axis(left["months"], right["months"])
    by_month = {
        "a": {row["month"]: row for row in left["months"]},
        "b": {row["month"]: row for row in right["months"]},
    }
    months: list[dict[str, Any]] = []
    for label in axis:
        a_row, b_row = by_month["a"].get(label), by_month["b"].get(label)
        a_net = a_row["net"] if a_row else None
        b_net = b_row["net"] if b_row else None
        # ``delta`` is the one figure here that combines two curves, so it follows rule 3 in
        # reverse: with no shared code there is no currency to name it in, and a bare number
        # would be a blend of two (an INR net minus a USD net printed as if it were one thing)
        delta = (
            None
            if resolved is None or a_net is None or b_net is None
            else money.money(a_net - b_net, resolved)
        )
        months.append(
            {
                "month": label,
                "a": _curve(a_row),
                "b": _curve(b_row),
                "delta": delta,
            }
        )
    first = _first_break_even(left["break_even_month"], right["break_even_month"])
    return {
        "currency": resolved,
        "a": left["scenario"],
        "b": right["scenario"],
        "months": months,
        "totals": {"a": left["totals"], "b": right["totals"]},
        "break_even": {
            "a": left["break_even_month"],
            "b": right["break_even_month"],
            "first": first,
        },
    }


def _curve(row: dict[str, Any] | None) -> dict[str, Any]:
    """One month of one curve, or the honest "not in this scenario's horizon" shape."""
    if row is None:
        return {"income": None, "cost": None, "net": None, "cumulative": None, "in_horizon": False}
    return {
        "income": row["income"],
        "cost": row["cost"],
        "net": row["net"],
        "cumulative": row["cumulative"],
        "in_horizon": True,
    }


def _axis(a: list[dict[str, Any]], b: list[dict[str, Any]]) -> list[str]:
    labels = {row["month"] for row in a} | {row["month"] for row in b}
    return sorted(labels)


def _shared_currency(left: dict[str, Any], right: dict[str, Any], wanted: str | None) -> str | None:
    if wanted:
        return wanted.strip().upper()
    if left["currency"] and left["currency"] == right["currency"]:
        return left["currency"]
    return None


def _first_break_even(a: str | None, b: str | None) -> str | None:
    """Which plan gets to zero first - ``"a"``, ``"b"``, ``"both"`` or neither (§4)."""
    if a is None and b is None:
        return None
    if a is None:
        return "b"
    if b is None:
        return "a"
    if a == b:
        return "both"
    return "a" if a < b else "b"


# -------------------------------------------------------------------------- validation


def _items(session: Session, scenario: CostScenario) -> list[CostScenarioItem]:
    return list(
        session.scalars(
            sa.select(CostScenarioItem)
            .where(CostScenarioItem.scenario_id == scenario.id)
            .order_by(CostScenarioItem.starts_on, CostScenarioItem.label, CostScenarioItem.id)
        )
    )


def _next_name(session: Session, workspace_id: str, name: str) -> str:
    """``Copy`` suffixes that do not collide, because §13 puts no UNIQUE on scenario names."""
    base = f"{name} (copy)"
    taken = {
        row
        for row in session.scalars(
            sa.select(CostScenario.name).where(CostScenario.workspace_id == workspace_id)
        )
    }
    if base not in taken:
        return base
    index = 2
    while f"{name} (copy {index})" in taken:
        index += 1
    return f"{name} (copy {index})"


def _horizon(value: Any, *, allow_none: bool = False) -> int | None:
    if value in (None, ""):
        if allow_none:
            return None
        raise validation(
            "horizon_months is required",
            [field_error(["body", "horizon_months"], "a projection needs a number of months")],
        )
    try:
        months = int(value)
    except (TypeError, ValueError) as exc:
        raise validation(
            "horizon_months must be a whole number",
            [field_error(["body", "horizon_months"], f"'{value}' is not an integer")],
        ) from exc
    if months < 1 or months > 120:
        raise validation(
            "horizon_months must be between 1 and 120",
            [field_error(["body", "horizon_months"], f"{months} is outside 1..120")],
        )
    return months


def _kind(value: Any) -> str:
    text = (str(value).strip().lower().replace("-", "_").replace(" ", "_") if value else "") or ScenarioKind.PERSONAL.value
    if text not in SCENARIO_KINDS:
        raise _bad_enum(text, SCENARIO_KINDS, "kind")
    return text


def _status(value: Any) -> str:
    text = (str(value).strip().lower().replace("-", "_").replace(" ", "_") if value else "") or ScenarioStatus.DRAFT.value
    if text not in SCENARIO_STATUSES:
        raise _bad_enum(text, SCENARIO_STATUSES, "status")
    return text


def _direction(value: Any) -> str:
    text = (str(value).strip().lower().replace("-", "_") if value else "") or ScenarioDirection.COST.value
    if text not in DIRECTIONS:
        raise _bad_enum(text, DIRECTIONS, "direction")
    return text


def _recurrence(value: Any) -> str | None:
    if value in (None, ""):
        return None
    text = str(value).strip().lower().replace("-", "_").replace(" ", "_")
    if text not in RECURRENCES:
        raise _bad_enum(text, RECURRENCES, "recurrence")
    return text


def _currency(value: Any) -> str | None:
    if value in (None, ""):
        return None
    return money.require_currency(value, "currency")


def _amount(value: Any) -> Decimal | None:
    if value in (None, ""):
        return None
    amount = Decimal(str(value))
    if amount < 0:
        raise validation(
            "amount must not be negative",
            [
                field_error(
                    ["body", "amount"], "a negative cost is income - set direction=income instead"
                )
            ],
        )
    return amount


def _assumptions(value: Any) -> dict[str, Any] | None:
    if value in (None, ""):
        return None
    if not isinstance(value, dict):
        raise validation(
            "assumptions must be an object",
            [field_error(["body", "assumptions"], "expected {key: value}, e.g. {inflation: 0.06}")],
        )
    return dict(value)


def _day(value: Any, field: str) -> dt.date | None:
    if value in (None, ""):
        return None
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    try:
        return dt.date.fromisoformat(str(value).strip()[:10])
    except ValueError as exc:
        raise validation(
            f"{field} must be YYYY-MM-DD",
            [field_error(["body", field], f"'{value}' is not a date")],
        ) from exc


def _check_dates(row: CostScenarioItem) -> None:
    """§4: ``ends_on >= starts_on`` - a month-long line that ends before it starts is a typo."""
    if row.ends_on is not None and row.starts_on is not None and row.ends_on < row.starts_on:
        raise validation(
            "ends_on must not be before starts_on",
            [
                field_error(
                    ["body", "ends_on"],
                    f"{row.ends_on.isoformat()} is before {row.starts_on.isoformat()}",
                )
            ],
        )


def _profile(session: Session, workspace_id: str, value: Any) -> str | None:
    if value in (None, ""):
        return None
    crud.validate_fk(
        session, IncomeProfile, str(value), workspace_id=workspace_id, field="base_income_profile_id"
    )
    return str(value)


def _category(session: Session, workspace_id: str, value: Any) -> str | None:
    if value in (None, ""):
        return None
    crud.validate_fk(
        session, ExpenseCategory, str(value), workspace_id=workspace_id, field="category_id"
    )
    return str(value)


def _bad_enum(value: str, allowed: tuple[str, ...], field: str) -> Any:
    return validation(
        f"{field} must be one of: {', '.join(allowed)}",
        [field_error(["body", field], f"'{value}' is not a valid {field}")],
    )


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


__all__ = [
    "activate",
    "break_even_month",
    "compare",
    "create_item",
    "create_scenario",
    "delete_item",
    "delete_scenario",
    "duplicate",
    "get_scenario",
    "item_payload",
    "list_items",
    "list_scenarios",
    "projection",
    "runway_months",
    "scenario_payload",
    "update_item",
    "update_scenario",
]
