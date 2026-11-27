"""Income: the saved calculator profiles and the ledger of everything that came in.

Two tables, two very different jobs, one module because both are "money in".

``income_profiles`` stores **inputs only**. :func:`app.services.money.take_home` is the
whole calculator and it never writes, so a profile can be re-previewed after a rate change
without anything going stale - which is why ``PATCH /income-profiles/{id}`` accepts the maths
fields and returns the derived block rather than stored results (§4).

``income_transactions`` is a ledger row: it stores its own money and exactly two derived
flags (``is_overdue``, ``days_overdue``) come from the date, never from a column. Three
write rules are enforced here rather than by a CHECK:

* ``converted_amount`` / ``converted_currency`` / ``converted_at`` are all-or-none (§2.3).
  A partial triple would be a stored conversion nobody can prove, so a missing leg is a 422
  that names the leg.
* ``status=overdue`` with a ``received_on`` in the future is a 422 - the row contradicts
  itself, and the overdue notification rule (§6) would fire on money that is not late.
* ``POST /income/{id}/mark-paid`` only moves ``received_on`` when the row was ``expected``,
  because an *invoiced* row's date is the invoice date the UI already shows.

An amount is never summed across currencies here either: the summary delegates to
:func:`app.services.money.income_summary`, which tallies per currency first.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
from decimal import Decimal
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.currencies import exponent as currency_step
from app.core.errors import conflict, field_error, validation
from app.core.utils import today_utc
from app.models import IncomeProfile, IncomeTransaction, Service, Subscription
from app.models.enums import IncomeKind, IncomeMethod, IncomeStatus, TaxRegime
from app.services import activity, crud, money, rates

INCOME_KINDS = tuple(item.value for item in IncomeKind)
INCOME_STATUSES = tuple(item.value for item in IncomeStatus)
INCOME_METHODS = tuple(item.value for item in IncomeMethod)

#: sort key -> (column, default direction); ``id`` is the always-ascending final tiebreaker
_PROFILE_SORTS: dict[str, tuple[Any, str]] = {
    "name": (IncomeProfile.name, "asc"),
    "gross": (IncomeProfile.gross_monthly, "desc"),
    "created": (IncomeProfile.created_at, "desc"),
}
_SORTS: dict[str, tuple[Any, str]] = {
    "received_on": (IncomeTransaction.received_on, "desc"),
    "amount": (IncomeTransaction.amount, "desc"),
    "created": (IncomeTransaction.created_at, "desc"),
}


def _order(sorts: dict[str, tuple[Any, str]], column: Any, sort: str, direction: str | None) -> tuple[Any, ...]:
    """Flip only the requested key - the contract addendum's ``?dir=`` rule."""
    key_column, default = sorts[sort]
    asc = (direction or default).lower() == "asc"
    return ((key_column.asc() if asc else key_column.desc()), column.id.asc())


# --------------------------------------------------------------------- income profiles


def profile_payload(row: IncomeProfile) -> dict[str, Any]:
    """A stored profile plus the three figures §4 derives on read."""
    payload = {
        "id": row.id,
        "name": row.name,
        "kind": row.kind,
        "gross_monthly": None if row.gross_monthly is None else money.money(row.gross_monthly, row.currency),
        "currency": row.currency,
        "tax_regime": row.tax_regime,
        "tax_rate": row.tax_rate,
        "slabs": row.slabs or [],
        "notes": row.notes,
        "source": row.source,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }
    payload.update(money.profile_derived(row))
    return payload


def list_profiles(
    session: Session,
    workspace_id: str,
    *,
    kind: str | None = None,
    query: str | None = None,
    sort: str = "name",
    direction: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    conditions: list[Any] = [IncomeProfile.workspace_id == workspace_id]
    if kind:
        conditions.append(IncomeProfile.kind == kind)
    if query:
        needle = query.strip()
        conditions.append(
            sa.or_(
                crud.text_match(IncomeProfile.name, needle),
                crud.text_match(IncomeProfile.notes, needle),
            )
        )
    total = int(
        session.scalar(sa.select(sa.func.count()).select_from(IncomeProfile).where(*conditions)) or 0
    )
    statement = sa.select(IncomeProfile).where(*conditions).order_by(
        *_order(_PROFILE_SORTS, IncomeProfile, sort, direction)
    )
    return [profile_payload(row) for row in session.scalars(statement)], total


def get_profile(session: Session, workspace_id: str, profile_id: str) -> dict[str, Any]:
    return profile_payload(
        crud.require(session, IncomeProfile, profile_id, workspace_id=workspace_id, label="income profile")
    )


def create_profile(
    session: Session, workspace_id: str, data: dict[str, Any], *, source: str = "user"
) -> dict[str, Any]:
    name = str(data.get("name") or "").strip()
    if not name:
        raise validation(
            "name is required",
            [field_error(["body", "name"], "a profile without a name cannot be picked later")],
        )
    if data.get("currency") is None:
        raise validation(
            "currency is required",
            [field_error(["body", "currency"], "the calculator needs to know what it is taxing")],
        )
    currency = money.require_currency(data["currency"], "currency")
    _check_unique_profile(session, workspace_id, name)
    gross = _gross(data.get("gross_monthly"))
    regime = _regime(data.get("tax_regime"))
    tax_rate = _tax_rate(data.get("tax_rate"), regime)
    slabs = _slabs(data.get("slabs"), regime)
    _check_regime(regime, tax_rate, slabs)
    row = IncomeProfile(
        workspace_id=workspace_id,
        name=name,
        kind=_kind(data.get("kind")),
        gross_monthly=gross,
        currency=currency,
        tax_regime=regime,
        tax_rate=tax_rate,
        slabs=slabs,
        notes=_text(data.get("notes")),
        source=source,
    )
    session.add(row)
    session.flush()
    activity.created(
        session,
        workspace_id=workspace_id,
        entity_type="income_profile",
        entity_id=row.id,
        entity_title=row.name,
    )
    return profile_payload(row)


def update_profile(
    session: Session, workspace_id: str, profile_id: str, data: dict[str, Any]
) -> dict[str, Any]:
    row = crud.require(
        session, IncomeProfile, profile_id, workspace_id=workspace_id, label="income profile"
    )
    if data.get("name") is not None:
        name = str(data["name"]).strip()
        if not name:
            raise validation(
                "name must not be empty", [field_error(["body", "name"], "a profile needs a name")]
            )
        _check_unique_profile(session, workspace_id, name, exclude_id=row.id)
        row.name = name
    if data.get("currency") is not None:
        row.currency = money.require_currency(data["currency"], "currency")
    if "gross_monthly" in data:
        row.gross_monthly = _gross(data["gross_monthly"])
    if data.get("kind") is not None:
        row.kind = _kind(data["kind"])
    if "tax_regime" in data:
        row.tax_regime = _regime(data["tax_regime"])
    if "tax_rate" in data:
        row.tax_rate = _tax_rate(data["tax_rate"], row.tax_regime)
    if "slabs" in data:
        row.slabs = _slabs(data["slabs"], row.tax_regime)
    if "notes" in data:
        row.notes = _text(data["notes"])
    _require_tax_inputs(row)
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="income_profile",
        entity_id=row.id,
        entity_title=row.name,
    )
    return profile_payload(row)


def delete_profile(session: Session, workspace_id: str, profile_id: str) -> dict[str, Any]:
    """Scenarios keep their own items, so §13's ``SET NULL`` only clears the link (§4)."""
    row = crud.require(
        session, IncomeProfile, profile_id, workspace_id=workspace_id, label="income profile"
    )
    snapshot = {"id": row.id, "name": row.name}
    session.delete(row)
    session.flush()
    activity.deleted(
        session,
        workspace_id=workspace_id,
        entity_type="income_profile",
        entity_id=snapshot["id"],
        entity_title=snapshot["name"],
    )
    return snapshot


def preview(data: dict[str, Any]) -> dict[str, Any]:
    """``POST /income-profiles/preview`` - the calculator, nothing saved.

    ``money.take_home`` does every branch (none/flat/slab/presumptive, monthly vs annual)
    and returns Decimals; the API boundary is the only place that quantises for the wire.
    """
    result = money.take_home(data)
    code = result["currency"]
    for field in (
        "gross",
        "taxable",
        "tax",
        "net",
        "net_monthly",
        "net_annual",
        "deductions_total",
    ):
        result[field] = money.money(result[field], code)
    result["effective_tax_rate"] = float(money.quantize(result["effective_tax_rate"], "USD"))
    result.pop("_annual", None)
    return result


def _check_unique_profile(
    session: Session, workspace_id: str, name: str, *, exclude_id: str | None = None
) -> None:
    conditions = [
        IncomeProfile.workspace_id == workspace_id,
        sa.func.lower(IncomeProfile.name) == name.lower(),
    ]
    if exclude_id:
        conditions.append(IncomeProfile.id != exclude_id)
    if session.scalar(sa.select(IncomeProfile.id).where(*conditions)) is not None:
        raise conflict(
            f"an income profile named {name!r} already exists",
            [field_error(["body", "name"], "name is unique per workspace")],
        )


def _kind(value: Any) -> str | None:
    if value is None or str(value).strip() == "":
        return IncomeKind.SALARY.value
    text = str(value).strip().lower().replace("-", "_").replace(" ", "_")
    if text not in INCOME_KINDS:
        raise _bad_enum(text, INCOME_KINDS, "kind")
    return text


def _regime(value: Any) -> str:
    text = (str(value).strip().lower() if value else "") or TaxRegime.NONE.value
    if text not in money.TAX_REGIMES:
        raise _bad_enum(text, money.TAX_REGIMES, "tax_regime")
    return text


def _tax_rate(value: Any, regime: str | None) -> Decimal | None:
    if value is None or str(value).strip() == "":
        return None
    rate = Decimal(str(value))
    if rate < 0 or rate > 100:
        raise validation(
            "tax_rate must be between 0 and 100",
            [field_error(["body", "tax_rate"], f"{rate} is not a percentage between 0 and 100")],
        )
    return rate


def _slabs(value: Any, regime: str | None) -> list[dict[str, Any]] | None:
    if value is None:
        return None
    if not isinstance(value, list):
        raise validation(
            "slabs must be a list", [field_error(["body", "slabs"], "expected [{up_to, rate}]")]
        )
    rows: list[dict[str, Any]] = []
    for index, item in enumerate(value):
        if not isinstance(item, dict):
            raise validation(
                "slabs must be objects",
                [field_error(["body", "slabs", index], f"{item!r} is not {{up_to, rate}}")],
            )
        rate = Decimal(str(item.get("rate") or 0))
        if rate < 0 or rate > 100:
            raise validation(
                "slab rates must be between 0 and 100",
                [field_error(["body", "slabs", index, "rate"], f"{rate} is not a percentage")],
            )
        up_to = item.get("up_to")
        ceiling = None if up_to is None else Decimal(str(up_to))
        if ceiling is not None and ceiling <= 0:
            raise validation(
                "slab ceilings must be positive",
                [
                    field_error(
                        ["body", "slabs", index, "up_to"], "use null for the open top slab"
                    )
                ],
            )
        rows.append({"up_to": None if ceiling is None else float(ceiling), "rate": float(rate)})
    return rows


def _gross(value: Any) -> Decimal | None:
    if value is None or str(value).strip() == "":
        return None
    amount = Decimal(str(value))
    if amount < 0:
        raise validation(
            "gross_monthly must not be negative",
            [field_error(["body", "gross_monthly"], "a negative gross is a cost, not income")],
        )
    return amount


def _check_regime(
    regime: str | None, tax_rate: Decimal | None, slabs: list[dict[str, Any]] | None
) -> None:
    """§4: a regime other than ``none`` has to say how much it charges.

    Without a rate or slabs the derived ``monthly_net`` would be a made-up number, so the
    row is refused at the door rather than printed as 0.00 (§2's "never a made-up number").
    """
    if regime in (None, TaxRegime.NONE.value):
        return
    if tax_rate is None and not slabs:
        raise validation(
            f"tax_regime {regime} needs tax_rate or slabs",
            [
                field_error(
                    ["body", "tax_rate"],
                    f"the {regime} regime cannot be calculated without a rate or slabs",
                )
            ],
        )


def _require_tax_inputs(row: IncomeProfile) -> None:
    """The same §4 rule for a stored row, used by PATCH where the fields arrive one at a time."""
    _check_regime(row.tax_regime, row.tax_rate, row.slabs)


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


# ------------------------------------------------------------------ income transactions


def transaction_payload(
    row: IncomeTransaction, *, today: dt.date | None = None, service: Service | None = None
) -> dict[str, Any]:
    """The ledger shape §4 promises, always with the origin the ledger screen prints.

    ``service`` is passed in when the caller already has it (the FK is a lazy load
    otherwise); the key is always present so a list never has to guess whether a row
    genuinely came from nothing or was simply read without its join.
    """
    payload = money.income_row_payload(row, today)
    payload["service"] = (
        {"id": service.id, "name": service.name, "unit": service.unit} if service is not None else None
    )
    return payload


def _conditions(
    session: Session,
    workspace_id: str,
    *,
    status: str | None = None,
    start: dt.date | None = None,
    end: dt.date | None = None,
    service_id: str | None = None,
    subscription_id: str | None = None,
    currency: str | None = None,
    query: str | None = None,
) -> list[Any]:
    """The WHERE shared by the list and the CSV export - one filter set, two readers.

    A foreign key in the filter is validated rather than ignored: an export of
    ``service_id=<someone else's row>`` would otherwise be a silent empty file.
    """
    conditions: list[Any] = [IncomeTransaction.workspace_id == workspace_id]
    if status:
        conditions.append(IncomeTransaction.status == status)
    if start:
        conditions.append(IncomeTransaction.received_on >= start)
    if end:
        conditions.append(IncomeTransaction.received_on <= end)
    if service_id:
        crud.validate_fk(session, Service, service_id, workspace_id=workspace_id, field="service_id")
        conditions.append(IncomeTransaction.service_id == service_id)
    if subscription_id:
        crud.validate_fk(
            session, Subscription, subscription_id, workspace_id=workspace_id, field="subscription_id"
        )
        conditions.append(IncomeTransaction.subscription_id == subscription_id)
    if currency:
        conditions.append(IncomeTransaction.currency == rates.code_or_422(currency, "currency", in_query=True))
    if query:
        needle = query.strip()
        conditions.append(
            sa.or_(
                crud.text_match(IncomeTransaction.label, needle),
                crud.text_match(IncomeTransaction.invoice_number, needle),
                crud.text_match(IncomeTransaction.notes, needle),
            )
        )
    return conditions


def list_transactions(
    session: Session,
    workspace_id: str,
    *,
    status: str | None = None,
    start: dt.date | None = None,
    end: dt.date | None = None,
    service_id: str | None = None,
    subscription_id: str | None = None,
    currency: str | None = None,
    query: str | None = None,
    sort: str = "received_on",
    direction: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    today: dt.date,
) -> tuple[list[dict[str, Any]], int]:
    conditions = _conditions(
        session,
        workspace_id,
        status=status,
        start=start,
        end=end,
        service_id=service_id,
        subscription_id=subscription_id,
        currency=currency,
        query=query,
    )
    total = int(
        session.scalar(sa.select(sa.func.count()).select_from(IncomeTransaction).where(*conditions))
        or 0
    )
    statement = sa.select(IncomeTransaction).where(*conditions).order_by(
        *_order(_SORTS, IncomeTransaction, sort, direction)
    )
    if limit is not None:
        statement = statement.limit(limit).offset(max(0, offset))
    return [
        transaction_payload(row, today=today, service=row.service)
        for row in session.scalars(statement)
    ], total


def get_transaction(session: Session, workspace_id: str, row_id: str, *, today: dt.date) -> dict[str, Any]:
    row = crud.require(
        session, IncomeTransaction, row_id, workspace_id=workspace_id, label="income transaction"
    )
    return transaction_payload(row, today=today, service=row.service)


CSV_COLUMNS = (
    "id",
    "received_on",
    "label",
    "amount",
    "currency",
    "status",
    "method",
    "invoice_number",
    "service",
    "subscription_id",
    "converted_amount",
    "converted_currency",
    "converted_at",
    "notes",
)


def export_csv(
    session: Session,
    workspace_id: str,
    *,
    status: str | None = None,
    start: dt.date | None = None,
    end: dt.date | None = None,
    service_id: str | None = None,
    subscription_id: str | None = None,
    currency: str | None = None,
    query: str | None = None,
    today: dt.date | None = None,
) -> str:
    """``GET /income/export.csv`` - the filtered ledger, then a per-currency totals block.

    Same shape as the expense export (§4) and for the same reason: the file is generated per
    request, never written to disk, and the totals are comments so a spreadsheet cannot read
    them as another data row.  Money is totalled **per currency** and nothing is converted
    (§2.3) - a spreadsheet is exactly the place where a reader cannot tell what code a bare
    number was in.  ``received`` is the paid subset of the same rows, because the difference
    between "invoiced 6000" and "paid 6000" is the reason the ledger exists.
    """
    day = today or today_utc()
    conditions = _conditions(
        session,
        workspace_id,
        status=status,
        start=start,
        end=end,
        service_id=service_id,
        subscription_id=subscription_id,
        currency=currency,
        query=query,
    )
    rows = list(
        session.scalars(
            sa.select(IncomeTransaction)
            .where(*conditions)
            .order_by(IncomeTransaction.received_on, IncomeTransaction.label, IncomeTransaction.id)
        )
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    totals: dict[str, Decimal] = {}
    received: dict[str, Decimal] = {}
    for row in rows:
        amount = Decimal(str(row.amount))
        totals[row.currency] = totals.get(row.currency, Decimal(0)) + amount
        if row.status == IncomeStatus.PAID.value:
            received[row.currency] = received.get(row.currency, Decimal(0)) + amount
        writer.writerow(
            [
                row.id,
                row.received_on.isoformat(),
                row.label,
                str(money.money(amount, row.currency)),
                row.currency,
                row.status,
                row.method or "",
                row.invoice_number or "",
                row.service.name if row.service else "",
                row.subscription_id or "",
                "" if row.converted_amount is None else str(
                    money.money(row.converted_amount, row.converted_currency or row.currency)
                ),
                row.converted_currency or "",
                "" if row.converted_at is None else row.converted_at.isoformat(),
                (row.notes or "").replace("\r", " ").replace("\n", " "),
            ]
        )
    writer.writerow([])
    window = (
        f"{start.isoformat()}..{end.isoformat()}"
        if start and end
        else (f"until {day.isoformat()}" if end or start else day.isoformat())
    )
    buffer.write(f"# income {window}\n")
    buffer.write(f"# rows,{len(rows)}\n")
    for code, amount in sorted(totals.items()):
        buffer.write(f"# total,{code},{money.money(amount, code)}\n")
    for code, amount in sorted(received.items()):
        buffer.write(f"# received,{code},{money.money(amount, code)}\n")
    return buffer.getvalue()


def create_transaction(
    session: Session,
    workspace_id: str,
    data: dict[str, Any],
    *,
    today: dt.date,
    source: str = "user",
) -> dict[str, Any]:
    for field, message in (
        ("label", "a ledger row with no label is unreadable"),
        ("currency", "every money row names its currency"),
        ("received_on", "the ledger is ordered by date"),
    ):
        if data.get(field) in (None, ""):
            raise validation(f"{field} is required", [field_error(["body", field], message)])
    amount = _amount(data.get("amount"))
    if amount is None:
        raise validation(
            "amount is required", [field_error(["body", "amount"], "an income row needs a figure")]
        )
    status = _status(data.get("status"))
    received_on = _as_date(data["received_on"])
    _check_overdue(status, received_on, today)
    converted = _converted(data, session, workspace_id, currency=money.require_currency(data["currency"], "currency"), amount=amount)
    service_id = _link(session, workspace_id, Service, data.get("service_id"), "service_id")
    subscription_id = _link(
        session, workspace_id, Subscription, data.get("subscription_id"), "subscription_id"
    )
    row = IncomeTransaction(
        workspace_id=workspace_id,
        label=str(data["label"]).strip(),
        amount=money.money(amount, str(data["currency"]).strip().upper()),
        currency=str(data["currency"]).strip().upper(),
        received_on=received_on,
        status=status,
        invoice_number=_text(data.get("invoice_number")),
        method=_method(data.get("method")),
        service_id=service_id,
        subscription_id=subscription_id,
        notes=_text(data.get("notes")),
        source=source,
        **converted,
    )
    session.add(row)
    session.flush()
    activity.created(
        session,
        workspace_id=workspace_id,
        entity_type="income",
        entity_id=row.id,
        entity_title=row.label,
        project_id=None,
    )
    return transaction_payload(row, today=today, service=row.service)


def update_transaction(
    session: Session, workspace_id: str, row_id: str, data: dict[str, Any], *, today: dt.date
) -> dict[str, Any]:
    row = crud.require(
        session, IncomeTransaction, row_id, workspace_id=workspace_id, label="income transaction"
    )
    if data.get("label") is not None:
        label = str(data["label"]).strip()
        if not label:
            raise validation(
                "label must not be empty", [field_error(["body", "label"], "a row needs a label")]
            )
        row.label = label
    if data.get("currency") is not None:
        row.currency = money.require_currency(data["currency"], "currency")
    if data.get("amount") is not None:
        amount = _amount(data["amount"])
        if amount is None:
            raise validation(
                "amount must not be null",
                [field_error(["body", "amount"], "a ledger row cannot be emptied")],
            )
        row.amount = money.money(amount, row.currency)
    if data.get("received_on") is not None:
        row.received_on = _as_date(data["received_on"])
    if data.get("status") is not None:
        row.status = _status(data["status"])
    if "method" in data:
        row.method = _method(data["method"])
    if "invoice_number" in data:
        row.invoice_number = _text(data["invoice_number"])
    if "notes" in data:
        row.notes = _text(data["notes"])
    if data.get("service_id") is not None:
        row.service_id = _link(session, workspace_id, Service, data["service_id"], "service_id")
    if data.get("subscription_id") is not None:
        row.subscription_id = _link(
            session, workspace_id, Subscription, data["subscription_id"], "subscription_id"
        )
    _check_overdue(row.status, row.received_on, today)
    if "converted_amount" in data or "converted_currency" in data or "converted_at" in data:
        for key, value in _converted(
            data, session, workspace_id, currency=row.currency, amount=row.amount, partial=row
        ).items():
            setattr(row, key, value)
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="income",
        entity_id=row.id,
        entity_title=row.label,
    )
    return transaction_payload(row, today=today, service=row.service)


def delete_transaction(session: Session, workspace_id: str, row_id: str) -> dict[str, Any]:
    row = crud.require(
        session, IncomeTransaction, row_id, workspace_id=workspace_id, label="income transaction"
    )
    snapshot = {"id": row.id, "name": row.label}
    session.delete(row)
    session.flush()
    activity.deleted(
        session,
        workspace_id=workspace_id,
        entity_type="income",
        entity_id=snapshot["id"],
        entity_title=snapshot["name"],
    )
    return snapshot


def mark_paid(session: Session, workspace_id: str, row_id: str, *, today: dt.date) -> dict[str, Any]:
    """``POST /income/{id}/mark-paid`` - paid, and dated today if it was only *expected*."""
    row = crud.require(
        session, IncomeTransaction, row_id, workspace_id=workspace_id, label="income transaction"
    )
    was_expected = row.status == IncomeStatus.EXPECTED.value
    row.status = IncomeStatus.PAID.value
    if was_expected:
        row.received_on = today
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="income",
        entity_id=row.id,
        entity_title=row.label,
        summary=activity.summary_for(
            "updated", row.label, detail="marked paid" + (" from today" if was_expected else "")
        ),
    )
    return transaction_payload(row, today=today, service=row.service)


def summary(
    session: Session,
    workspace_id: str,
    *,
    month: Any,
    currency: str | None = None,
    today: dt.date,
) -> dict[str, Any]:
    """``GET /income/summary`` - the whole payload is derived in :mod:`app.services.money`."""
    target = currency.strip().upper() if currency else None
    if target:
        money.require_currency(target, "currency", in_query=True)
    return money.income_summary(session, workspace_id, month=month, currency=target, today=today)


# -------------------------------------------------------------------------- validation


def _amount(value: Any) -> Decimal | None:
    if value is None or str(value).strip() == "":
        return None
    return Decimal(str(value))


def _as_date(value: Any) -> dt.date:
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    text = str(value or "").strip()
    try:
        return dt.date.fromisoformat(text[:10])
    except ValueError as exc:
        raise validation(
            "received_on must be YYYY-MM-DD",
            [field_error(["body", "received_on"], f"'{value}' is not a date")],
        ) from exc


def _status(value: Any) -> str:
    text = (str(value).strip().lower() if value else "") or IncomeStatus.EXPECTED.value
    if text not in INCOME_STATUSES:
        raise _bad_enum(text, INCOME_STATUSES, "status")
    return text


def _method(value: Any) -> str | None:
    if value is None or str(value).strip() == "":
        return None
    text = str(value).strip().lower().replace("-", "_").replace(" ", "_")
    if text not in INCOME_METHODS:
        raise _bad_enum(text, INCOME_METHODS, "method")
    return text


def _check_overdue(status: str, received_on: dt.date, today: dt.date) -> None:
    if status == IncomeStatus.OVERDUE.value and received_on > today:
        raise validation(
            "an overdue row cannot be dated in the future",
            [
                field_error(
                    ["body", "status"],
                    f"received_on {received_on.isoformat()} is after {today.isoformat()}",
                )
            ],
        )


def _converted(
    data: dict[str, Any],
    session: Session,
    workspace_id: str,
    *,
    currency: str,
    amount: Decimal,
    partial: IncomeTransaction | None = None,
) -> dict[str, Any]:
    """The all-or-none triple (§2.3), with the stored legs counted when a PATCH sends one.

    Passing **all three null** clears the conversion, which is a legitimate edit - a rate
    that was entered wrong has to be removable without deleting the row.

    The stated figure is the user's own record, so it is stored as given. It is only
    *cross-checked* when the workspace actually has a rate for the pair on that date: then a
    disagreement of more than one minor unit is a 422 naming the pair, because a row that
    contradicts the ledger cannot be explained later (§2.3, "nothing is converted silently").
    """
    legs = ("converted_amount", "converted_currency", "converted_at")
    given = {key: (key in data) for key in legs}
    if not any(given.values()):
        return {}
    values = {
        key: data[key] if given[key] else (getattr(partial, key) if partial is not None else None)
        for key in legs
    }
    filled = [key for key, value in values.items() if value not in (None, "")]
    if filled and len(filled) != 3:
        missing = sorted(set(legs) - set(filled))
        raise validation(
            "the converted_* triple is all-or-none",
            [
                field_error(["body", name], f"{name} is missing; stored conversions need all three")
                for name in missing
            ],
        )
    if not filled:
        return {key: None for key in legs}

    target = money.require_currency(values["converted_currency"], "converted_currency")
    on = _as_date(values["converted_at"])
    stated = money.money(Decimal(str(values["converted_amount"])), target)
    row = rates.latest_row(session, workspace_id, currency, target, on_or_before=on)
    if row is not None:
        expected = money.money(amount * Decimal(row.rate), target)
        if abs(stated - expected) > currency_step(target):
            raise validation(
                f"converted_amount disagrees with the stored {currency}→{target} rate on {on.isoformat()}",
                [
                    field_error(
                        ["body", "converted_amount"],
                        f"{currency} {amount} at {float(row.rate)} is {float(expected)}",
                    )
                ],
            )
    return {
        "converted_amount": stated,
        "converted_currency": target,
        "converted_at": on,
    }


def _link(session: Session, workspace_id: str, model: type, value: Any, field: str) -> str | None:
    if value in (None, ""):
        return None
    crud.validate_fk(session, model, str(value), workspace_id=workspace_id, field=field)
    return str(value)


__all__ = [
    "CSV_COLUMNS",
    "create_profile",
    "create_transaction",
    "delete_profile",
    "delete_transaction",
    "export_csv",
    "get_profile",
    "get_transaction",
    "list_profiles",
    "list_transactions",
    "mark_paid",
    "preview",
    "profile_payload",
    "summary",
    "transaction_payload",
    "update_profile",
    "update_transaction",
]
