"""Money maths: normalisation, tax, conversion and the derived Finance summaries.

Everything here is *derived*. Nothing in this module writes a stored total: the curve,
the burn and the runway are computed from the rows on every call, which is the only way
editing an item cannot leave a stale sum behind (DATA_MODEL.md §7, PHASE3_FINANCE.md §3).

Three rules govern the arithmetic:

1. ``Decimal`` end to end, one ``quantize`` at the very end with ``ROUND_HALF_UP``. The
   intermediate values are never rounded, so a 12-month projection of ``1/3``-sized
   slices adds back to the yearly figure instead of drifting by a cent.
2. Money is only ever summed *per currency*. A cross-currency total is produced when the
   caller names the currency (:func:`resolve_currency` + :func:`sum_tally`) and every
   bucket can be converted - otherwise the answer is ``None``, never a made-up sum.
3. A rate is looked up, not guessed: conversion goes through :mod:`app.services.rates`,
   so a missing pair is a 422 naming the pair and the date.

``period`` parameters accept both ``YYYY-MM`` and a first-of-month date, and every month
label this module emits is ``YYYY-MM`` (PHASE3_FINANCE.md §3 plus the column-header
addendum in API.md).
"""

from __future__ import annotations

import calendar
import datetime as dt
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.currencies import CODES as CURRENCY_CODES, quantize
from app.core.errors import field_error, validation
from app.core.utils import add_months, today_utc
from app.models import (
    CostScenario,
    Expense,
    ExpenseCategory,
    IncomeProfile,
    IncomeTransaction,
    Service,
    Subscription,
    Workspace,
)
from app.models.enums import (
    ExpenseRecurrence,
    IncomeStatus,
    PlanInterval,
    ScenarioDirection,
    SubscriptionStatus,
    TaxRegime,
)
from app.services import rates

#: the runway window: "income received minus expenses paid in the last 90 days" (§3)
CASH_WINDOW_DAYS = 90
#: the overview's month series, and the expense summary's documented 12-month series
SUMMARY_MONTHS = 6
EXPENSE_SERIES_MONTHS = 12

ZERO = Decimal(0)
ONE = Decimal(1)
HUNDRED = Decimal(100)

#: recurrence values a scenario item may carry (§3): the expense set plus ``one_time``.
#: §13 gives ``cost_scenario_items.recurrence`` no CHECK and §5 no enum key, so this tuple
#: is the contract and ``scenarios.py`` validates against it.
SCENARIO_RECURRENCES = (
    ExpenseRecurrence.NONE.value,
    ExpenseRecurrence.WEEKLY.value,
    ExpenseRecurrence.MONTHLY.value,
    ExpenseRecurrence.QUARTERLY.value,
    ExpenseRecurrence.YEARLY.value,
    PlanInterval.ONE_TIME.value,
)


# ---------------------------------------------------------------- currency and month


def require_currency(code: Any, field: str = "currency", *, in_query: bool = False) -> str:
    """Upper-case + registry-check a currency code; anything else is a 422."""
    text = str(code or "").strip().upper()
    if text not in CURRENCY_CODES:
        raise validation(
            f"{field} is not a supported currency",
            [
                field_error(
                    ["query" if in_query else "body", field],
                    f"'{code}' is not in the currency registry",
                )
            ],
        )
    return text


def money(amount: Any, code: str) -> Decimal:
    """Quantise ``amount`` to ``code``'s minor units (the only rounding in the pipeline)."""
    return quantize(amount, code)


def month_floor(value: Any) -> dt.date:
    """First of the month for ``value``: accepts ``YYYY-MM``, ``YYYY-MM-01`` or a date."""
    day = _as_date(value)
    return dt.date(day.year, day.month, 1)


def month_label(day: dt.date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def month_last(day: dt.date) -> dt.date:
    """Last day of the month ``day`` falls in - 2032-02-29 included (§9.1)."""
    return dt.date(day.year, day.month, calendar.monthrange(day.year, day.month)[1])


def shift_month(first: dt.date, months: int) -> dt.date:
    """``first`` is always the 1st, so :func:`add_months` cannot clamp a day away."""
    return add_months(first, months)


def months_inclusive(start_first: dt.date, end_first: dt.date) -> int:
    return (end_first.year - start_first.year) * 12 + (end_first.month - start_first.month) + 1


def months_range(end: dt.date, count: int) -> list[dt.date]:
    """``count`` month starts ending with the month that contains ``end``."""
    current = month_floor(end)
    return [shift_month(current, index - count + 1) for index in range(count)]


def _as_date(value: Any) -> dt.date:
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    text = str(value or "").strip()
    if len(text) == 7 and text[4] == "-":
        text = f"{text}-01"
    try:
        return dt.date.fromisoformat(text[:10])
    except ValueError:
        raise validation(
            "month must be YYYY-MM or YYYY-MM-01",
            [field_error(["query", "month"], f"'{value}' is not a month")],
        ) from None


# -------------------------------------------------------------------- normalisation


def monthly_normalise(
    amount: Any, interval: str | None, *, horizon_months: int | None = None
) -> Decimal | None:
    """Turn a recurring figure into a monthly one (§3), or ``None`` when it has none.

    ``weekly`` is ``x 52/12`` rather than ``x 4`` because a year is not 48 weeks; a
    ``one_time`` figure only has a monthly value inside a scenario horizon, so outside a
    scenario (no horizon) it is excluded from the monthly number and shown separately.
    """
    value = Decimal(str(amount if amount is not None else 0))
    key = (interval or "").strip().lower() or None
    if key in (None, ExpenseRecurrence.NONE.value):
        return None
    if key == PlanInterval.MONTHLY.value:
        return value
    if key == ExpenseRecurrence.WEEKLY.value:
        return value * Decimal(52) / Decimal(12)
    if key == PlanInterval.QUARTERLY.value:
        return value / Decimal(3)
    if key == PlanInterval.YEARLY.value:
        return value / Decimal(12)
    if key == PlanInterval.ONE_TIME.value:
        if not horizon_months or horizon_months < 1:
            return None
        return value / Decimal(int(horizon_months))
    raise validation(
        f"unknown interval: {interval}",
        [field_error(["body", "interval"], f"'{interval}' is not a recognised recurrence")],
    )


def annual_normalise(
    amount: Any, interval: str | None, *, horizon_months: int | None = None
) -> Decimal | None:
    """The yearly figure, derived from the monthly one so the two can never disagree."""
    monthly = monthly_normalise(amount, interval, horizon_months=horizon_months)
    return None if monthly is None else monthly * Decimal(12)


#: how far each recurring interval steps, in days (weekly) or months (the rest)
_TERM_STEPS: dict[str, tuple[int | None, int | None]] = {
    ExpenseRecurrence.WEEKLY.value: (7, None),
    ExpenseRecurrence.MONTHLY.value: (None, 1),
    ExpenseRecurrence.QUARTERLY.value: (None, 3),
    ExpenseRecurrence.YEARLY.value: (None, 12),
}


def next_occurrence(paid_on: dt.date, recurrence: str | None, *, today: dt.date) -> dt.date | None:
    """The next date a recurring row comes due, on or after ``today``.

    Anchored on the row's own ``paid_on`` so a monthly bill paid on the 27th renews on the
    27th, and a leap-day anchor lands on 1 March in a common year (``add_months`` clamps),
    which is what a real standing order does. A row whose ``paid_on`` is still ahead of
    ``today`` has not been paid yet, so it is its own next occurrence.
    """
    key = (recurrence or "").strip().lower() or None
    if key in (None, ExpenseRecurrence.NONE.value):
        return None
    step = _TERM_STEPS.get(key)
    if step is None:
        raise validation(
            f"unknown recurrence: {recurrence}",
            [field_error(["body", "recurrence"], f"'{recurrence}' is not a recurring interval")],
        )
    if paid_on >= today:
        return paid_on
    days, months = step
    if days is not None:
        span = (today - paid_on).days
        return paid_on + dt.timedelta(days=days * -(-span // days))  # ceil, no loop
    elapsed = (today.year - paid_on.year) * 12 + (today.month - paid_on.month)
    if today.day > paid_on.day:  # the step must clear the whole of today's month
        elapsed += 1
    return add_months(paid_on, months * max(1, -(-elapsed // months)))


# ---------------------------------------------------------------------------- tax


@dataclass(frozen=True)
class Deduction:
    label: str
    amount: Decimal
    pre_tax: bool


def _deductions(rows: Sequence[Mapping[str, Any]] | None) -> list[Deduction]:
    items: list[Deduction] = []
    for index, row in enumerate(rows or ()):
        amount = Decimal(str(row.get("amount") or 0))
        if amount < 0:
            raise validation(
                "deduction amounts must not be negative",
                [field_error(["body", "deductions", index, "amount"], "a deduction below zero adds income")],
            )
        items.append(
            Deduction(
                label=str(row.get("label") or f"deduction {index + 1}"),
                amount=amount,
                pre_tax=bool(row.get("pre_tax", True)),
            )
        )
    return items


def _slabs(rows: Sequence[Mapping[str, Any]] | None) -> list[tuple[Decimal | None, Decimal]]:
    parsed: list[tuple[Decimal | None, Decimal]] = []
    for index, row in enumerate(rows or ()):
        up_to = row.get("up_to")
        rate = Decimal(str(row.get("rate") or 0))
        if rate < 0 or rate > HUNDRED:
            raise validation(
                "slab rates must be between 0 and 100",
                [
                    field_error(
                        ["body", "slabs", index, "rate"], f"{rate} is not a percentage between 0 and 100"
                    )
                ],
            )
        ceiling = None if up_to is None else Decimal(str(up_to))
        if ceiling is not None and ceiling <= 0:
            raise validation(
                "slab ceilings must be positive",
                [field_error(["body", "slabs", index, "up_to"], "use null for the open top slab")],
            )
        parsed.append((ceiling, rate))
    return parsed


def _slab_tax(
    taxable: Decimal, slabs: Sequence[tuple[Decimal | None, Decimal]]
) -> tuple[Decimal, list[dict[str, Any]]]:
    """Cumulative brackets over ``taxable``; returns the tax and the per-slab breakdown."""
    tax = ZERO
    breakdown: list[dict[str, Any]] = []
    lower = ZERO
    for ceiling, rate in slabs:
        upper = taxable if ceiling is None else min(ceiling, taxable)
        slice_width = upper - lower
        if slice_width <= 0:
            break
        amount = slice_width * rate / HUNDRED
        tax += amount
        breakdown.append({"from": lower, "to": upper, "rate": rate, "amount": amount})
        lower = upper
        if ceiling is None or lower >= taxable:
            break
    return tax, breakdown


def take_home(data: Mapping[str, Any]) -> dict[str, Any]:
    """The income calculator (``POST /income-profiles/preview``) - nothing is stored.

    All the maths happens on the **annual** axis, then both axes are reported: monthly
    tax slabs and a yearly bonus cannot be reconciled on a monthly figure, and dividing
    once at the end is the smallest possible rounding error.
    """
    code = require_currency(data.get("currency"))
    gross_monthly_in = data.get("gross_monthly")
    gross_annual_in = data.get("gross_annual")
    if gross_monthly_in is None and gross_annual_in is None:
        raise validation(
            "gross_monthly or gross_annual is required",
            [field_error(["body", "gross_monthly"], "the calculator needs a gross figure")],
        )
    period = (data.get("period") or "monthly").strip().lower()
    if period not in ("monthly", "annual"):
        raise validation(
            "period must be monthly or annual",
            [field_error(["body", "period"], f"'{period}' is not a period")],
        )
    for field_name, value in (("gross_monthly", gross_monthly_in), ("gross_annual", gross_annual_in)):
        if value is not None and Decimal(str(value)) < 0:
            raise validation(
                f"{field_name} must not be negative",
                [field_error(["body", field_name], "a negative gross is a cost, not income")],
            )

    annual_gross = (
        Decimal(str(gross_annual_in))
        if gross_annual_in is not None
        else Decimal(str(gross_monthly_in)) * Decimal(12)
    )
    monthly_gross = annual_gross / Decimal(12)

    regime = (data.get("tax_regime") or TaxRegime.NONE.value).strip().lower()
    if regime not in TAX_REGIMES:
        raise validation(
            "tax_regime is not supported",
            [field_error(["body", "tax_regime"], f"'{regime}' is not one of {', '.join(TAX_REGIMES)}")],
        )
    tax_rate = data.get("tax_rate")
    slabs = _slabs(data.get("slabs"))
    deductions = _deductions(data.get("deductions"))
    pre_tax_total = sum((item.amount for item in deductions if item.pre_tax), ZERO)
    post_tax_total = sum((item.amount for item in deductions if not item.pre_tax), ZERO)
    other_income = Decimal(str(data.get("other_income") or 0))
    if other_income < 0:
        raise validation(
            "other_income must not be negative",
            [field_error(["body", "other_income"], "other income cannot reduce the profile")],
        )

    warnings: list[str] = []
    taxable = annual_gross - pre_tax_total
    if taxable < 0:
        warnings.append("pre-tax deductions exceed the gross; taxable income was floored at zero")
        taxable = ZERO

    rate = None if tax_rate is None else Decimal(str(tax_rate))
    if rate is not None and (rate < 0 or rate > HUNDRED):
        raise validation(
            "tax_rate must be between 0 and 100",
            [field_error(["body", "tax_rate"], f"{rate} is not a percentage between 0 and 100")],
        )

    if regime == TaxRegime.NONE.value:
        tax, breakdown = ZERO, []
        if slabs or rate is not None:
            warnings.append("tax_regime is 'none', so the rate and slabs you gave are not applied")
    elif regime == TaxRegime.PRESUMPTIVE.value:
        # presumptive taxes the *gross*: the whole point is that deductions do not apply
        if not slabs and rate is None:
            warnings.append("presumptive regime with no tax_rate charges no tax")
        tax, breakdown = (rate or ZERO) * annual_gross / HUNDRED, []
        if pre_tax_total:
            warnings.append("presumptive tax is charged on gross, so pre-tax deductions do not reduce it")
    elif regime == TaxRegime.SLAB.value:
        if not slabs:
            warnings.append("slab regime with no slabs charges no tax")
            tax, breakdown = ZERO, []
        else:
            tax, breakdown = _slab_tax(taxable, slabs)
            if slabs[-1][0] is not None:
                top = slabs[-1][0]
                if taxable > top:
                    warnings.append(
                        f"the top slab ends at {top}; income above it was left untaxed - end the list with up_to null"
                    )
        if rate is not None:
            warnings.append("tax_rate is ignored by the slab regime; the slabs carry the rates")
    else:  # flat
        if rate is None:
            warnings.append("flat regime with no tax_rate charges no tax")
        tax = (rate or ZERO) * taxable / HUNDRED
        breakdown = []
        if slabs:
            warnings.append("slabs are ignored by the flat regime; set tax_regime to slab to use them")

    net_annual = annual_gross - tax - post_tax_total + other_income * Decimal(12)
    effective = (tax / annual_gross * HUNDRED) if annual_gross else ZERO
    gross_on_axis = annual_gross if period == "annual" else monthly_gross
    taxable_on_axis = taxable if period == "annual" else taxable / Decimal(12)

    return {
        "currency": code,
        "period": period,
        "gross": gross_on_axis,
        "taxable": taxable_on_axis,
        "tax": (tax if period == "annual" else tax / Decimal(12)),
        "net": (net_annual if period == "annual" else net_annual / Decimal(12)),
        "net_monthly": net_annual / Decimal(12),
        "net_annual": net_annual,
        "effective_tax_rate": effective,
        "slab_breakdown": [
            {key: _round(value, code) if key in ("from", "to", "amount") else _round(value, "USD") for key, value in item.items()}
            for item in breakdown
        ],
        "deductions_total": post_tax_total + pre_tax_total,
        "warnings": warnings,
        "_annual": {
            "gross": annual_gross,
            "taxable": taxable,
            "tax": tax,
            "pre_tax_deductions": pre_tax_total,
            "post_tax_deductions": post_tax_total,
            "other_income_annual": other_income * Decimal(12),
        },
    }


#: ``tax.regime`` (§5) - the calculator's accepted regimes, in declaration order.
TAX_REGIMES = tuple(item.value for item in TaxRegime)


def _round(value: Any, code: str) -> Any:
    """Money fields round to the profile currency; percentages are plain 2-dp numbers."""
    return quantize(value, code)


def _profile_tax_args(profile: IncomeProfile) -> dict[str, Any]:
    """The stored inputs, as the calculator wants them.

    ``gross_monthly`` is nullable in §13, so an empty profile previews a zero gross rather
    than raising the calculator's "needs a gross figure" 422 - a list of saved profiles is
    a read, not a request to calculate.
    """
    return {
        "gross_monthly": profile.gross_monthly if profile.gross_monthly is not None else ZERO,
        "period": "monthly",
        "currency": profile.currency,
        "tax_regime": profile.tax_regime or TaxRegime.NONE.value,
        "tax_rate": profile.tax_rate,
        "slabs": profile.slabs or [],
        "deductions": [],
        "other_income": ZERO,
    }


def profile_derived(profile: IncomeProfile) -> dict[str, Any]:
    """``monthly_net`` / ``effective_tax_rate`` / ``annual_gross`` for a stored profile."""
    result = take_home(_profile_tax_args(profile))
    return {
        "monthly_net": money(result["net_monthly"], profile.currency),
        "annual_gross": money(Decimal(str(result["_annual"]["gross"])), profile.currency),
        "effective_tax_rate": float(_round(result["effective_tax_rate"], "USD")),
    }


# ------------------------------------------------------------------- conversion


def resolve_currency(
    codes: Iterable[str], target: str | None, *, fallback: str | None = None
) -> str | None:
    """The currency the headline figures may be reported in - or ``None`` (§2.3)."""
    if target:
        return target
    unique = {code for code in codes if code}
    if len(unique) == 1:
        return unique.pop()
    if not unique:
        return fallback
    return None


def sum_tally(
    session: Session,
    workspace_id: str,
    tally: Mapping[str, Decimal],
    currency: str | None,
    *,
    as_of: dt.date,
    today: dt.date | None = None,
) -> Decimal | None:
    """Total a per-currency tally in ``currency``, or ``None`` when it cannot be named.

    Every bucket is converted through :func:`app.services.rates.quote_for`, so a missing
    pair raises 422 naming the pair and the date rather than quietly dropping a currency.
    """
    if currency is None:
        return None
    total = ZERO
    for code, amount in tally.items():
        if amount == 0:
            continue
        quote = rates.quote_for(session, workspace_id, code, currency, as_of=as_of, today=today)
        total += amount * quote.rate
    return money(total, currency)


def by_currency(tally: Mapping[str, Decimal]) -> list[dict[str, Any]]:
    """The per-currency view §2.3 always allows, sorted by code for a stable table."""
    return [{"currency": code, "amount": money(value, code)} for code, value in sorted(tally.items())]


# --------------------------------------------------------------------- the ledgers


def _expense_rows(
    session: Session, workspace_id: str, *, start: dt.date, end: dt.date, until: dt.date | None = None
) -> Sequence[Expense]:
    statement = sa.select(Expense).where(
        Expense.workspace_id == workspace_id, Expense.paid_on >= start, Expense.paid_on <= end
    )
    if until is not None:
        statement = statement.where(Expense.paid_on <= until)
    return list(session.scalars(statement.order_by(Expense.paid_on, Expense.label, Expense.id)))


def _income_rows(
    session: Session,
    workspace_id: str,
    *,
    start: dt.date,
    end: dt.date,
    statuses: Sequence[str] | None = None,
) -> Sequence[IncomeTransaction]:
    conditions = [
        IncomeTransaction.workspace_id == workspace_id,
        IncomeTransaction.received_on >= start,
        IncomeTransaction.received_on <= end,
    ]
    if statuses:
        conditions.append(IncomeTransaction.status.in_(tuple(statuses)))
    return list(
        session.scalars(
            sa.select(IncomeTransaction).where(*conditions).order_by(
                IncomeTransaction.received_on, IncomeTransaction.label, IncomeTransaction.id
            )
        )
    )


def tally_by_currency(rows: Sequence[Any], *, code_of="currency", value_of="amount") -> dict[str, Decimal]:
    tally: dict[str, Decimal] = {}
    for row in rows:
        code = getattr(row, code_of)
        value = Decimal(str(getattr(row, value_of) or 0))
        tally[code] = tally.get(code, ZERO) + value
    return tally


def monthly_tally(
    rows: Sequence[Any], *, months: Sequence[dt.date], date_of: str, normalise: bool = False
) -> dict[dt.date, dict[str, Decimal]]:
    """``{month_first: {currency: total}}`` over ``months`` - one pass, no SQL per month."""
    index = {month_floor(day): day for day in months}
    out: dict[dt.date, dict[str, Decimal]] = {day: {} for day in index.values()}
    for row in rows:
        stamp: dt.date | None = getattr(row, date_of, None)
        if stamp is None:
            continue
        bucket = index.get(month_floor(stamp))
        if bucket is None:
            continue
        amount = Decimal(str(getattr(row, "amount", 0) or 0))
        if normalise:
            amount = monthly_normalise(amount, getattr(row, "recurrence", None))
            if amount is None:
                continue
        code = getattr(row, "currency", None)
        out[bucket][code] = out[bucket].get(code, ZERO) + amount
    return out


def workspace_currency(session: Session, workspace_id: str) -> str:
    """The default for new rows only - never an implicit conversion target (§2.5)."""
    return session.scalar(sa.select(Workspace.currency).where(Workspace.id == workspace_id)) or "USD"


# ---------------------------------------------------------------- MRR, burn, runway


def live_subscriptions(session: Session, workspace_id: str, *, today: dt.date) -> list[Subscription]:
    """Rows that still bill: active/trialing, started, and not cancelled yet."""
    rows = list(
        session.scalars(
            sa.select(Subscription)
            .where(
                Subscription.workspace_id == workspace_id,
                Subscription.status.in_(tuple(SubscriptionStatus.live())),
                Subscription.started_on <= today,
            )
            .order_by(Subscription.renews_on, Subscription.price, Subscription.id)
        )
    )
    return [row for row in rows if row.cancelled_on is None or row.cancelled_on > today]


def mrr(
    session: Session,
    workspace_id: str,
    *,
    today: dt.date,
    currency: str | None = None,
) -> tuple[str | None, Decimal | None]:
    """Monthly recurring revenue: the live subscriptions, normalised monthly (§4).

    The subscriptions screen is what you are *billed* (``plan_id`` points at your own
    catalogue and ``income_transactions.subscription_id`` records the payments), so these
    rows are the recurring revenue base. The figure is a tally per currency first, so a
    mixed book reports ``None`` until a target currency is named.
    """
    tally: dict[str, Decimal] = {}
    for row in live_subscriptions(session, workspace_id, today=today):
        monthly = monthly_normalise(row.price, row.interval)
        if monthly is None:
            continue
        code = row.currency
        tally[code] = tally.get(code, ZERO) + monthly
    target = resolve_currency(tally, currency)
    return target, sum_tally(session, workspace_id, tally, target, as_of=today, today=today)


def recurring_rules(session: Session, workspace_id: str) -> list[Expense]:
    """The live recurring commitments - one row each, at its newest logged rate.

    A ``recurring`` expense is a rule *and* its payment history: monthly rent logged every
    month for a year is twelve rows describing one commitment. §3 counts a recurring
    expense's *normalised* figure, so burn must not multiply it by twelve: rows are grouped
    by the columns that identify a rule (label, vendor, currency, cadence) and the newest
    ``paid_on`` in each group is the current figure. A rule keeps counting until its
    ``recurring`` flag is cleared or the row goes - §13 gives an expense no end date, so
    "still billed" is not something a row can say for itself, and the alternative (a
    trailing window) silently drops every rule paid on a cadence slower than a month.
    """
    rows = session.scalars(
        sa.select(Expense)
        .where(
            Expense.workspace_id == workspace_id,
            sa.or_(
                Expense.recurring.is_(True),
                Expense.recurrence.is_not(None) & (Expense.recurrence != ExpenseRecurrence.NONE.value),
            ),
        )
        .order_by(Expense.paid_on, Expense.label, Expense.id)
    )
    latest: dict[tuple[str, str, str, str], Expense] = {}
    for row in rows:
        key = (row.label, row.vendor or "", row.currency, row.recurrence or ExpenseRecurrence.NONE.value)
        latest[key] = row
    return sorted(latest.values(), key=lambda row: (row.label, row.currency, row.id))


def monthly_burn(
    session: Session,
    workspace_id: str,
    *,
    today: dt.date,
    month_start: dt.date | None = None,
    currency: str | None = None,
) -> tuple[str | None, Decimal | None]:
    """Recurring normalised cost + this month's one-off spend, without double counting (§3).

    A recurring rule contributes its *normalised* monthly figure whatever cadence it is on
    and whenever it was last paid (:func:`recurring_rules`); a one-off contributes its
    amount on its own date inside this month. ``one_time`` figures have no monthly value
    outside a scenario horizon, so they are excluded from the recurring part and show up in
    the dated sum of their own month instead.
    """
    first = month_start or month_floor(today)
    last = month_last(first)
    tally: dict[str, Decimal] = {}
    for row in recurring_rules(session, workspace_id):
        monthly = monthly_normalise(row.amount, row.recurrence)
        code = row.currency
        if monthly is None:  # not a cadence: a one-off, dated below
            if first <= row.paid_on <= last:
                tally[code] = tally.get(code, ZERO) + Decimal(str(row.amount))
            continue
        tally[code] = tally.get(code, ZERO) + monthly
    for row in _expense_rows(session, workspace_id, start=first, end=last):
        if row.recurring or (row.recurrence or ExpenseRecurrence.NONE.value) != ExpenseRecurrence.NONE.value:
            continue  # counted above as a rate, never again as a payment (§3)
        tally[row.currency] = tally.get(row.currency, ZERO) + Decimal(str(row.amount))
    target = resolve_currency(tally, currency)
    return target, sum_tally(session, workspace_id, tally, target, as_of=today, today=today)


def runway_months(
    cash_in: Decimal | None, burn: Decimal | None
) -> float | None:
    """``cash_in / monthly_burn``, ``None`` when the burn is zero (§3).

    Zero burn means infinite runway, and infinity is not a JSON number - the UI shows
    "no measured burn" instead of a fake 9999.
    """
    if burn is None or cash_in is None or burn <= 0:
        return None
    return float(quantize(cash_in / burn, "USD"))


def cash_in_window(
    session: Session,
    workspace_id: str,
    *,
    today: dt.date,
    currency: str | None = None,
) -> tuple[str | None, Decimal | None]:
    """Income received minus expenses paid over the last :data:`CASH_WINDOW_DAYS` days, floored at 0."""
    start = today - dt.timedelta(days=CASH_WINDOW_DAYS)
    tally: dict[str, Decimal] = {}
    for row in _income_rows(session, workspace_id, start=start, end=today, statuses=(IncomeStatus.PAID.value,)):
        tally[row.currency] = tally.get(row.currency, ZERO) + Decimal(str(row.amount))
    for row in _expense_rows(session, workspace_id, start=start, end=today):
        tally[row.currency] = tally.get(row.currency, ZERO) - Decimal(str(row.amount))
    target = resolve_currency(tally, currency)
    total = sum_tally(session, workspace_id, tally, target, as_of=today, today=today)
    if total is None:
        return target, None
    return target, money(total, target) if total > ZERO else ZERO


def receivables(
    session: Session,
    workspace_id: str,
    *,
    today: dt.date,
    currency: str | None = None,
) -> tuple[str | None, Decimal | None, list[IncomeTransaction]]:
    """Money owed but not lost: ``invoiced`` + ``overdue`` rows, plus the overdue rows."""
    rows = list(
        session.scalars(
            sa.select(IncomeTransaction)
            .where(
                IncomeTransaction.workspace_id == workspace_id,
                IncomeTransaction.status.in_(tuple(IncomeStatus.receivable())),
            )
            .order_by(IncomeTransaction.received_on, IncomeTransaction.label, IncomeTransaction.id)
        )
    )
    tally = tally_by_currency(rows)
    target = resolve_currency(tally, currency)
    overdue = [row for row in rows if row.status == IncomeStatus.OVERDUE.value]
    return target, sum_tally(session, workspace_id, tally, target, as_of=today, today=today), overdue


# ---------------------------------------------------------------------- summaries


def finance_summary(
    session: Session,
    workspace_id: str,
    *,
    today: dt.date,
    currency: str | None = None,
) -> dict[str, Any]:
    """``GET /finance/summary`` - every figure here is derived, none of it is stored (§4)."""
    first = month_floor(today)
    months = months_range(today, SUMMARY_MONTHS)
    window_start, window_end = months[0], month_last(first)

    expenses = _expense_rows(session, workspace_id, start=window_start, end=window_end)
    income = _income_rows(
        session,
        workspace_id,
        start=window_start,
        end=window_end,
        statuses=(IncomeStatus.PAID.value,),
    )

    codes = {row.currency for row in expenses} | {row.currency for row in income}
    for row in live_subscriptions(session, workspace_id, today=today):
        codes.add(row.currency)
    target = resolve_currency(codes, currency)

    expense_months = monthly_tally(expenses, months=months, date_of="paid_on")
    income_months = monthly_tally(income, months=months, date_of="received_on")

    income_by_month: list[dict[str, Any]] = []
    for month in months:
        spend = sum_tally(session, workspace_id, expense_months[month], target, as_of=today, today=today)
        earned = sum_tally(session, workspace_id, income_months[month], target, as_of=today, today=today)
        income_by_month.append(
            {
                "month": month_label(month),
                "income": earned,
                "expense": spend,
                "net": None if earned is None or spend is None else money(earned - spend, target or "USD"),
            }
        )

    this_month_expense = tally_by_currency(
        [row for row in expenses if first <= row.paid_on <= month_last(first)]
    )
    this_month_income = tally_by_currency([row for row in income if first <= row.received_on <= month_last(first)])
    expense_total = sum_tally(session, workspace_id, this_month_expense, target, as_of=today, today=today)
    income_total = sum_tally(session, workspace_id, this_month_income, target, as_of=today, today=today)
    net = (
        None
        if income_total is None or expense_total is None
        else money(income_total - expense_total, target or "USD")
    )

    three = months[-3:]
    averages = [
        sum_tally(session, workspace_id, income_months[month], target, as_of=today, today=today)
        for month in three
    ]
    avg_3m = (
        None
        if target is None or any(value is None for value in averages)
        else money(sum(averages, ZERO) / Decimal(len(three)), target)
    )

    def named(pair: tuple[str | None, Decimal | None]) -> Decimal | None:
        """§2.3/§2.5: a total this response cannot name a currency for is not a total.

        Each helper resolves its own currency when the caller did not name one, so a
        single-currency sub-book would otherwise leak an unlabelled number next to a
        ``currency: null`` headline. The per-currency blocks are where those figures live.
        """
        return None if target is None else pair[1]

    burn = named(monthly_burn(session, workspace_id, today=today, currency=target))
    cash = named(cash_in_window(session, workspace_id, today=today, currency=target))
    subscription_mrr = named(mrr(session, workspace_id, today=today, currency=target))
    _, receivable_total, overdue_rows = receivables(session, workspace_id, today=today, currency=target)
    receivable_total = None if target is None else receivable_total
    overdue_tally = tally_by_currency(overdue_rows)
    # category and vendor aggregates: this month only, in the resolved currency
    month_expenses = [row for row in expenses if first <= row.paid_on <= month_last(first)]
    categories = {
        row.id: row
        for row in session.scalars(
            sa.select(ExpenseCategory).where(ExpenseCategory.workspace_id == workspace_id)
        )
    }
    by_category: dict[str | None, dict[str, Decimal]] = {}
    for row in month_expenses:
        bucket = by_category.setdefault(row.category_id, {})
        bucket[row.currency] = bucket.get(row.currency, ZERO) + Decimal(str(row.amount))
    expense_by_category: list[dict[str, Any]] = []
    for category_id, tally in by_category.items():
        category = categories.get(category_id) if category_id else None
        amount = sum_tally(session, workspace_id, tally, target, as_of=today, today=today)
        expense_by_category.append(
            {
                "category_id": category_id,
                "name": category.name if category else "Uncategorised",
                "color": category.color if category else None,
                "amount": amount,
                "share": None
                if amount is None or not expense_total
                else float(quantize(amount / expense_total * HUNDRED, "USD")),
            }
        )
    expense_by_category.sort(
        key=lambda item: (-(item["amount"] or 0) if item["amount"] is not None else 0, item["name"])
    )

    vendors: dict[str, dict[str, Any]] = {}
    for row in month_expenses:
        vendor = (row.vendor or "").strip() or "Unspecified"
        entry = vendors.setdefault(vendor, {"tally": {}, "count": 0})
        entry["tally"][row.currency] = entry["tally"].get(row.currency, ZERO) + Decimal(str(row.amount))
        entry["count"] += 1
    top_vendors = [
        {
            "vendor": vendor,
            "amount": sum_tally(session, workspace_id, entry["tally"], target, as_of=today, today=today),
            "count": entry["count"],
        }
        for vendor, entry in vendors.items()
    ]
    top_vendors.sort(
        key=lambda item: (-(item["amount"] or 0) if item["amount"] is not None else 0, item["vendor"])
    )

    renewing: list[dict[str, Any]] = []
    for row in live_subscriptions(session, workspace_id, today=today):
        if row.renews_on is None or not (first <= row.renews_on <= month_last(first)):
            continue
        renewing.append(
            {
                "id": row.id,
                "label": subscription_label(row),
                "amount": money(row.price, row.currency),
                "currency": row.currency,
                "renews_on": row.renews_on,
                "days_until": (row.renews_on - today).days,
            }
        )
    renewing.sort(key=lambda item: (item["renews_on"], item["label"]))

    exposure: list[dict[str, Any]] = []
    for code in sorted({row.currency for row in expenses} | {row.currency for row in income}):
        earned = sum(
            (Decimal(str(row.amount)) for row in income if row.currency == code), ZERO
        )
        spend = sum((Decimal(str(row.amount)) for row in expenses if row.currency == code), ZERO)
        exposure.append({"currency": code, "income": money(earned, code), "expense": money(spend, code)})

    overdue_total = sum_tally(
        session, workspace_id, overdue_tally, target, as_of=today, today=today
    )
    counts = {
        "expenses": _count(session, Expense, workspace_id),
        "income": _count(session, IncomeTransaction, workspace_id),
        "subscriptions": _count(session, Subscription, workspace_id),
        "services": _count(session, Service, workspace_id),
        "scenarios": _count(session, CostScenario, workspace_id),
    }
    return {
        "currency": target,
        "month": month_label(first),
        "income": income_total,
        "expense": expense_total,
        "net": net,
        "monthly_income_avg_3m": avg_3m,
        "monthly_burn": burn,
        "runway_months": runway_months(cash, burn),
        "mrr": subscription_mrr,
        "arr": None if subscription_mrr is None else money(subscription_mrr * Decimal(12), target or "USD"),
        "receivables": receivable_total,
        "overdue_income": overdue_total,
        "income_by_month": income_by_month,
        "expense_by_category": expense_by_category,
        "top_vendors": top_vendors[:5],
        "renewing_this_month": renewing,
        "by_currency": exposure,
        "stale_rates": rates.stale_pairs(session, workspace_id, today=today),
        "counts": counts,
        "cash_in_90d": cash,
    }


def _count(session: Session, model: type, workspace_id: str) -> int:
    return int(
        session.scalar(sa.select(sa.func.count()).select_from(model).where(model.workspace_id == workspace_id))
        or 0
    )


def subscription_label(row: Subscription) -> str:
    """How a subscription is named in lists, renewals and notifications.

    There is no ``name`` column: the plan it bills from is the label, else its invoice
    number, else the money itself ("``1200.00 INR/yearly``"), because a renewal reminder
    that says "subscription 3f9a…" is useless on a phone.
    """
    if row.plan is not None:
        return row.plan.name
    if row.invoice_number:
        return row.invoice_number
    interval = f"/{row.interval}" if row.interval else ""
    return f"{money(row.price, row.currency)} {row.currency}{interval}"


def expense_summary(
    session: Session,
    workspace_id: str,
    *,
    month: Any,
    currency: str | None = None,
    today: dt.date,
) -> dict[str, Any]:
    """``GET /expenses/summary`` - one month's spend, a 12-month series, and the splits.

    The response names one currency (§2.3): the code the month's own rows are in, or the
    ``?currency=`` the caller asked for, or ``null`` when the month mixes codes - and when it
    names one, *every* figure in it is in that code, converted at the rate in force on
    ``today``, which is the same basis ``GET /finance/summary`` uses so the two screens can
    be read side by side. ``recurring_monthly`` is the one figure that is not the month's
    history but its run rate: the live recurring rules, normalised (§3).
    """
    first = month_floor(month)
    last = month_last(first)
    series_months = months_range(first, EXPENSE_SERIES_MONTHS)
    rows = _expense_rows(session, workspace_id, start=series_months[0], end=last)
    in_month = [row for row in rows if first <= row.paid_on <= last]

    target = resolve_currency({row.currency for row in in_month}, currency)
    month_tally = tally_by_currency(in_month)
    total = sum_tally(session, workspace_id, month_tally, target, as_of=today, today=today)

    # §3: the recurring figure is the *rate* of the live rules, not the accident of which
    # of them happened to be paid inside this month, so it reads from the same set of rows
    # :func:`monthly_burn` does and the two screens can never disagree.
    recurring_tally: dict[str, Decimal] = {}
    for row in recurring_rules(session, workspace_id):
        monthly = monthly_normalise(row.amount, row.recurrence)
        if monthly is None:
            continue
        recurring_tally[row.currency] = recurring_tally.get(row.currency, ZERO) + monthly
    recurring = None if target is None else sum_tally(
        session, workspace_id, recurring_tally, target, as_of=today, today=today
    )

    categories = {
        row.id: row
        for row in session.scalars(sa.select(ExpenseCategory).where(ExpenseCategory.workspace_id == workspace_id))
    }
    by_category: dict[str | None, dict[str, Decimal]] = {}
    by_vendor: dict[str, dict[str, Decimal]] = {}
    for row in in_month:
        for key, bucket in ((row.category_id, by_category), (row.vendor or "Unspecified", by_vendor)):
            bucket[key] = bucket.get(key, {})
            bucket[key][row.currency] = bucket[key].get(row.currency, ZERO) + Decimal(str(row.amount))

    per_month = monthly_tally(rows, months=series_months, date_of="paid_on")
    series = [
        {
            "month": month_label(day),
            "total": sum_tally(session, workspace_id, per_month[day], target, as_of=today, today=today),
        }
        for day in series_months
    ]
    top = sorted(in_month, key=lambda row: (-Decimal(str(row.amount)), row.label, row.id))[:5]
    return {
        "month": month_label(first),
        "currency": target,
        "total": total,
        "count": len(in_month),
        "recurring_monthly": recurring,
        "by_category": [
            {
                "category_id": category_id,
                "name": categories[category_id].name if category_id in categories else "Uncategorised",
                "color": categories[category_id].color if category_id in categories else None,
                "amount": sum_tally(session, workspace_id, tally, target, as_of=today, today=today),
                "count": sum(1 for row in in_month if row.category_id == category_id),
            }
            for category_id, tally in sorted(by_category.items(), key=lambda item: str(item[0] or ""))
        ],
        "by_vendor": [
            {
                "vendor": vendor,
                "amount": sum_tally(session, workspace_id, tally, target, as_of=today, today=today),
                "count": sum(1 for row in in_month if (row.vendor or "Unspecified") == vendor),
            }
            for vendor, tally in sorted(by_vendor.items())
        ],
        "by_currency": by_currency(month_tally),
        "series": series,
        "top_expenses": [
            {
                "id": row.id,
                "label": row.label,
                "vendor": row.vendor,
                "amount": money(row.amount, row.currency),
                "currency": row.currency,
                "paid_on": row.paid_on,
            }
            for row in top
        ],
    }


def income_summary(
    session: Session,
    workspace_id: str,
    *,
    month: Any,
    currency: str | None = None,
    today: dt.date,
) -> dict[str, Any]:
    """``GET /income/summary`` - invoiced vs received, receivables, and the 6-month series.

    One named currency for the whole response, same rule as :func:`expense_summary`: the
    month's own code, or the caller's, or ``null`` when the month mixes codes - and
    conversions (including the wider ``receivables`` window, which is not limited to the
    month) are taken at the rate in force on ``today``.
    """
    first = month_floor(month)
    last = month_last(first)
    series_months = months_range(first, SUMMARY_MONTHS)
    rows = list(
        session.scalars(
            sa.select(IncomeTransaction)
            .where(
                IncomeTransaction.workspace_id == workspace_id,
                IncomeTransaction.received_on >= series_months[0],
                IncomeTransaction.received_on <= last,
            )
            .order_by(IncomeTransaction.received_on, IncomeTransaction.label, IncomeTransaction.id)
        )
    )
    in_month = [row for row in rows if first <= row.received_on <= last]
    target = resolve_currency({row.currency for row in in_month}, currency)

    def _sum(subset: Iterable[IncomeTransaction]) -> Decimal | None:
        return sum_tally(session, workspace_id, tally_by_currency(subset), target, as_of=today, today=today)

    # "invoiced" is what has been billed but not collected; paid and written-off are their
    # own columns, so neither belongs in it (§4: invoiced vs received are different sums)
    unbilled = (IncomeStatus.PAID.value, IncomeStatus.WRITTEN_OFF.value)
    invoiced_rows = [row for row in in_month if row.status not in unbilled]
    received_rows = [row for row in in_month if row.status == IncomeStatus.PAID.value]
    overdue_rows = [row for row in in_month if row.status == IncomeStatus.OVERDUE.value]
    receivable_rows = [row for row in rows if row.status in IncomeStatus.receivable()]

    status_tallies: dict[str, dict[str, Decimal]] = {}
    for row in in_month:
        bucket = status_tallies.setdefault(row.status, {})
        bucket[row.currency] = bucket.get(row.currency, ZERO) + Decimal(str(row.amount))

    services = {
        row.id: row.name
        for row in session.scalars(sa.select(Service).where(Service.workspace_id == workspace_id))
    }
    per_service: dict[str | None, dict[str, Decimal]] = {}
    for row in in_month:
        key = row.service_id
        per_service.setdefault(key, {})
        per_service[key][row.currency] = per_service[key].get(row.currency, ZERO) + Decimal(str(row.amount))

    per_month_received = monthly_tally(received_rows, months=series_months, date_of="received_on")
    per_month_invoiced = monthly_tally(invoiced_rows, months=series_months, date_of="received_on")
    series = [
        {
            "month": month_label(day),
            "invoiced": sum_tally(session, workspace_id, per_month_invoiced[day], target, as_of=today, today=today),
            "received": sum_tally(session, workspace_id, per_month_received[day], target, as_of=today, today=today),
        }
        for day in series_months
    ]
    return {
        "month": month_label(first),
        "currency": target,
        "invoiced": _sum(invoiced_rows),
        "received": _sum(received_rows),
        "receivables": _sum(receivable_rows),
        "overdue": [income_row_payload(row, today) for row in overdue_rows],
        "by_status": {
            status: sum_tally(session, workspace_id, tally, target, as_of=today, today=today)
            for status, tally in sorted(status_tallies.items())
        },
        "by_service": [
            {
                "service_id": service_id,
                "name": services.get(service_id) if service_id else "Unlinked",
                "amount": sum_tally(session, workspace_id, tally, target, as_of=today, today=today),
                "count": sum(1 for row in in_month if row.service_id == service_id),
            }
            for service_id, tally in sorted(per_service.items(), key=lambda item: str(item[0] or ""))
        ],
        "series": series,
        "by_currency": by_currency(tally_by_currency(in_month)),
        "count": len(in_month),
    }


def income_row_payload(row: IncomeTransaction, today: dt.date | None = None) -> dict[str, Any]:
    """The API shape of one income row plus the two derived flags the ledger needs.

    ``service`` is a placeholder here and filled by :func:`app.services.income.transaction_payload`,
    which owns the join: the ledger prints where a row came from, so the key is always
    present even when the origin is genuinely nothing.
    """
    day = today or today_utc()
    return {
        "id": row.id,
        "label": row.label,
        "amount": money(row.amount, row.currency),
        "currency": row.currency,
        "received_on": row.received_on,
        "status": row.status,
        "method": row.method,
        "invoice_number": row.invoice_number,
        "service_id": row.service_id,
        "service": None,
        "subscription_id": row.subscription_id,
        "source": row.source,
        "converted_amount": None if row.converted_amount is None else money(row.converted_amount, row.converted_currency or row.currency),
        "converted_currency": row.converted_currency,
        "converted_at": row.converted_at,
        "notes": row.notes,
        "is_overdue": row.status == IncomeStatus.OVERDUE.value,
        "days_overdue": max(0, (day - row.received_on).days)
        if row.status == IncomeStatus.OVERDUE.value
        else 0,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def expense_row_payload(
    row: Expense,
    *,
    today: dt.date | None = None,
    category: ExpenseCategory | None = None,
) -> dict[str, Any]:
    """The API shape of one expense: its own figures plus the monthly normalisation."""
    day = today or today_utc()
    monthly = monthly_normalise(row.amount, row.recurrence)
    next_due = (
        next_occurrence(row.paid_on, row.recurrence, today=day)
        if row.recurring or (row.recurrence or ExpenseRecurrence.NONE.value) != ExpenseRecurrence.NONE.value
        else None
    )
    return {
        "id": row.id,
        "label": row.label,
        "amount": money(row.amount, row.currency),
        "currency": row.currency,
        "paid_on": row.paid_on,
        "recurring": row.recurring,
        "recurrence": row.recurrence,
        "vendor": row.vendor,
        "invoice_number": row.invoice_number,
        "receipt_path": row.receipt_path,
        "category_id": row.category_id,
        "category": (
            {"id": category.id, "name": category.name, "color": category.color}
            if category is not None
            else None
        ),
        "notes": row.notes,
        "monthly_amount": None if monthly is None else money(monthly, row.currency),
        "next_due_on": next_due,
        "days_until_due": None if next_due is None else (next_due - day).days,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def scenario_monthly(
    amount: Any, direction: str, recurrence: str | None, horizon_months: int
) -> Decimal | None:
    """A scenario item's monthly figure, signed by direction (§3, used by ``scenarios``)."""
    monthly = monthly_normalise(amount, recurrence, horizon_months=horizon_months)
    if monthly is None:
        return None
    return -monthly if direction == ScenarioDirection.COST.value else monthly


__all__ = [
    "CASH_WINDOW_DAYS",
    "EXPENSE_SERIES_MONTHS",
    "SCENARIO_RECURRENCES",
    "SUMMARY_MONTHS",
    "TAX_REGIMES",
    "annual_normalise",
    "by_currency",
    "cash_in_window",
    "expense_row_payload",
    "expense_summary",
    "finance_summary",
    "income_row_payload",
    "income_summary",
    "live_subscriptions",
    "money",
    "month_floor",
    "month_label",
    "month_last",
    "months_inclusive",
    "months_range",
    "monthly_burn",
    "monthly_normalise",
    "monthly_tally",
    "next_occurrence",
    "profile_derived",
    "recurring_rules",
    "require_currency",
    "resolve_currency",
    "runway_months",
    "scenario_monthly",
    "shift_month",
    "sum_tally",
    "tally_by_currency",
    "subscription_label",
    "take_home",
    "workspace_currency",
]
