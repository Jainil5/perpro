"""The money maths PHASE3_FINANCE.md §2 and §3 promise, pinned at the function level.

Nothing in this file goes through HTTP: these are the arithmetic rules the whole finance
surface is built out of, and they have to be readable next to the paragraph they implement.
Two conventions hold throughout:

* every derived read is given ``today=`` explicitly, so a green run means the same thing on
  any date (a maths test that reads the machine clock is a maths test that fails in March);
* money is compared as ``Decimal``, because the contract's first rule is that a float is
  never summed - if a test compared floats it would be re-testing the thing it pins.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import Expense, ExchangeRate, IncomeTransaction, Subscription
from app.models.enums import IncomeStatus, PlanInterval, SubscriptionStatus
from app.services import money

DAY = dt.date(2026, 11, 21)


# --------------------------------------------------------------------- the fixtures


def add_rate(
    session: Session, workspace_id: str, base: str, quote: str, rate: str, *, as_of: dt.date
) -> ExchangeRate:
    row = ExchangeRate(
        workspace_id=workspace_id,
        base=base,
        quote=quote,
        rate=Decimal(rate),
        as_of=as_of,
        provider="test",
    )
    session.add(row)
    session.flush()
    return row


def add_expense(
    session: Session,
    workspace_id: str,
    label: str,
    amount: str,
    currency: str = "INR",
    *,
    paid_on: dt.date | None = None,
    recurring: bool = False,
    recurrence: str | None = None,
) -> Expense:
    row = Expense(
        workspace_id=workspace_id,
        label=label,
        amount=Decimal(amount),
        currency=currency,
        paid_on=paid_on or DAY,
        recurring=recurring,
        recurrence=recurrence or "none",
        vendor=f"{label} vendor",
        source="user",
    )
    session.add(row)
    session.flush()
    return row


def add_income(
    session: Session,
    workspace_id: str,
    label: str,
    amount: str,
    currency: str = "INR",
    *,
    received_on: dt.date | None = None,
    status: str = IncomeStatus.PAID.value,
) -> IncomeTransaction:
    row = IncomeTransaction(
        workspace_id=workspace_id,
        label=label,
        amount=Decimal(amount),
        currency=currency,
        received_on=received_on or DAY,
        status=status,
        method="bank",
        source="user",
    )
    session.add(row)
    session.flush()
    return row


def add_subscription(
    session: Session,
    workspace_id: str,
    price: str,
    currency: str = "INR",
    *,
    interval: str = PlanInterval.MONTHLY.value,
    status: str = SubscriptionStatus.ACTIVE.value,
    started_on: dt.date | None = None,
    cancelled_on: dt.date | None = None,
) -> Subscription:
    row = Subscription(
        workspace_id=workspace_id,
        price=Decimal(price),
        currency=currency,
        interval=interval,
        status=status,
        started_on=started_on or DAY - dt.timedelta(days=60),
        cancelled_on=cancelled_on,
        notes=f"{interval} {currency}",
        source="user",
    )
    session.add(row)
    session.flush()
    return row


@pytest.fixture
def rates(session: Session, workspace_id: str) -> Session:
    """One USD→INR row, so a target of INR can name a conversion instead of inventing one."""
    add_rate(session, workspace_id, "USD", "INR", "83.500000", as_of=DAY - dt.timedelta(days=5))
    return session


# ------------------------------------------------------------------ §2.1 and §2.2


@pytest.mark.parametrize(
    ("amount", "code", "expected"),
    [
        ("0.005", "USD", "0.01"),  # half-up at the cent, not banker's rounding
        ("0.014", "USD", "0.01"),
        ("1234.5", "JPY", "1235"),  # 0-dp currency: the yen has no minor unit to round to
        ("1234.4", "JPY", "1234"),
        ("99.995", "INR", "100.00"),
        ("0", "USD", "0.00"),
    ],
)
def test_quantise_rounds_half_up_to_the_currencys_minor_units(
    amount: str, code: str, expected: str
) -> None:
    assert money.quantize(Decimal(amount), code) == Decimal(expected)


def test_a_float_never_reaches_the_sum() -> None:
    """§2.1: ``Decimal(0.1)`` is a binary artefact, so the helper must take the string."""
    assert money.quantize(0.1 + 0.2, "USD") == Decimal("0.30")
    assert sum([Decimal(str(0.1))] * 3) == Decimal("0.3")


def test_money_and_the_tally_share_one_rounding_step(session: Session, workspace_id: str) -> None:
    rows = [
        add_expense(session, workspace_id, f"Coffee {index}", "0.005") for index in range(3)
    ]
    tally = money.tally_by_currency(rows)
    assert tally["INR"] == Decimal("0.015")
    assert money.money(tally["INR"], "INR") == Decimal("0.02")


# --------------------------------------------------------- §2.3 the currency of a total


@pytest.mark.parametrize(
    ("codes", "target", "fallback", "expected"),
    [
        ({"INR"}, None, None, "INR"),  # one code in the book: that is the answer
        ({"INR", "USD"}, None, None, None),  # mixed and unnamed: no total, no guess
        ({"INR", "USD"}, "USD", None, "USD"),  # the caller named it, so use it
        (set(), None, "INR", "INR"),  # nothing to look at: the fallback (never a row's code)
        (set(), None, None, None),
    ],
)
def test_resolve_currency_names_a_code_only_when_it_may(
    codes: set[str], target: str | None, fallback: str | None, expected: str | None
) -> None:
    assert money.resolve_currency(codes, target, fallback=fallback) == expected


def test_a_workspace_default_currency_is_never_a_silent_target(
    session: Session, workspace_id: str
) -> None:
    """§2.5: ``workspaces.currency`` (INR here) does not make a mixed book single-currency."""
    codes = money.resolve_currency({"INR", "USD"}, None, fallback=money.workspace_currency(
        session, workspace_id
    ))
    assert codes is None


def test_sum_tally_converts_every_bucket_into_the_named_code(rates: Session, workspace_id: str) -> None:
    tally = {"INR": Decimal("100.00"), "USD": Decimal("10.00")}
    total = money.sum_tally(rates, workspace_id, tally, "INR", as_of=DAY, today=DAY)
    assert total == Decimal("935.00")  # 100 + 10 x 83.50, quantised once at the end


def test_sum_tally_reports_nothing_when_no_currency_is_named(
    rates: Session, workspace_id: str
) -> None:
    assert (
        money.sum_tally(rates, workspace_id, {"INR": Decimal("100"), "USD": Decimal("10")}, None, as_of=DAY)
        is None
    )


def test_sum_tally_refuses_a_pair_that_was_never_stored(
    session: Session, workspace_id: str
) -> None:
    """§2.4: no rate, no total - and the error names the pair and the date."""
    with pytest.raises(ApiError) as caught:
        money.sum_tally(session, workspace_id, {"EUR": Decimal("1")}, "INR", as_of=DAY, today=DAY)
    assert caught.value.status_code == 422
    assert "EUR" in caught.value.message and "INR" in caught.value.message
    assert DAY.isoformat() in caught.value.message


def test_by_currency_is_the_answer_a_mixed_book_always_gets(session: Session, workspace_id: str) -> None:
    add_expense(session, workspace_id, "Rent", "60000")
    add_expense(session, workspace_id, " licences", "1200", "USD")
    tally = money.tally_by_currency(list(session.query(Expense)))
    assert money.by_currency(tally) == [
        {"currency": "INR", "amount": Decimal("60000.00")},
        {"currency": "USD", "amount": Decimal("1200.00")},
    ]


# ------------------------------------------------------------- §3 normalisation table


@pytest.mark.parametrize(
    ("interval", "amount", "expected"),
    [
        ("monthly", "1000", "1000"),
        ("weekly", "100", Decimal("433.3333333333333333333333333")),  # x 52/12, not x 4
        ("quarterly", "3000", "1000"),
        ("yearly", "12000", "1000"),
        ("none", "1000", None),
        ("one_time", "1000", None),  # outside a scenario horizon it has no monthly figure
    ],
)
def test_every_interval_normalises_to_a_monthly_figure(
    interval: str, amount: str, expected: str | None
) -> None:
    got = money.monthly_normalise(Decimal(amount), interval)
    assert got == (None if expected is None else Decimal(expected))


def test_a_one_time_figure_only_has_a_monthly_value_inside_a_horizon() -> None:
    assert money.monthly_normalise(Decimal("1200"), "one_time", horizon_months=12) == Decimal("100")
    assert money.monthly_normalise(Decimal("1200"), "one_time", horizon_months=0) is None


def test_the_yearly_figure_is_the_monthly_one_times_twelve() -> None:
    """The two axes are derived from each other, so a screen can never show 1199 vs 1200."""
    for amount, interval in (
        (Decimal("3000"), "quarterly"),
        (Decimal("100"), "weekly"),
        (Decimal("12000"), "yearly"),
        (Decimal("1000"), "monthly"),
    ):
        monthly = money.monthly_normalise(amount, interval)
        assert money.annual_normalise(amount, interval) == monthly * Decimal(12)


def test_an_unknown_interval_is_a_422_not_a_silent_zero() -> None:
    with pytest.raises(ApiError) as caught:
        money.monthly_normalise(Decimal("100"), "fortnightly")
    assert caught.value.status_code == 422


def test_month_labels_are_yyyy_dash_mm_and_both_month_shapes_parse() -> None:
    """§3 plus the contract addendum: ``YYYY-MM`` and ``YYYY-MM-01`` mean the same month."""
    assert money.month_label(DAY) == "2026-11"
    assert money.month_floor("2026-11") == money.month_floor("2026-11-01") == dt.date(2026, 11, 1)
    assert money.month_last(dt.date(2032, 2, 1)) == dt.date(2032, 2, 29)
    assert money.month_last(dt.date(2026, 2, 1)) == dt.date(2026, 2, 28)
    with pytest.raises(ApiError):
        money.month_floor("November 2026")


# ------------------------------------------------------------------------- MRR (§4)


def test_mrr_sums_the_live_subscriptions_monthly(session: Session, workspace_id: str) -> None:
    add_subscription(session, workspace_id, "1000")  # monthly
    add_subscription(session, workspace_id, "3000", interval=PlanInterval.QUARTERLY.value)
    add_subscription(session, workspace_id, "12000", interval=PlanInterval.YEARLY.value)
    add_subscription(session, workspace_id, "500", status=SubscriptionStatus.TRIALING.value)
    target, total = money.mrr(session, workspace_id, today=DAY)
    assert target == "INR"
    assert total == Decimal("3500.00")  # 1000 + 1000 + 1000 + 500


def test_mrr_drops_paused_cancelled_and_future_subscriptions(session: Session, workspace_id: str) -> None:
    add_subscription(session, workspace_id, "1000")
    add_subscription(session, workspace_id, "900", status=SubscriptionStatus.PAUSED.value)
    add_subscription(session, workspace_id, "800", status=SubscriptionStatus.CANCELLED.value)
    add_subscription(session, workspace_id, "700", started_on=DAY + dt.timedelta(days=3))
    _, total = money.mrr(session, workspace_id, today=DAY)
    assert total == Decimal("1000.00")


def test_a_scheduled_cancellation_still_bills_until_the_day_it_lands(
    session: Session, workspace_id: str
) -> None:
    """`status` says what the row is; `cancelled_on` says when it stops (§4)."""
    later = add_subscription(session, workspace_id, "1000", cancelled_on=DAY + dt.timedelta(days=10))
    gone = add_subscription(session, workspace_id, "900", cancelled_on=DAY - dt.timedelta(days=2))
    _, total = money.mrr(session, workspace_id, today=DAY)
    assert total == Decimal("1000.00")
    assert [row.id for row in money.live_subscriptions(session, workspace_id, today=DAY)] == [later.id]
    assert gone.cancelled_on < DAY


def test_a_one_time_plan_contributes_no_monthly_revenue(session: Session, workspace_id: str) -> None:
    add_subscription(session, workspace_id, "50000", interval=PlanInterval.ONE_TIME.value)
    add_subscription(session, workspace_id, "1000")
    _, total = money.mrr(session, workspace_id, today=DAY)
    assert total == Decimal("1000.00")


def test_a_mixed_book_reports_mrr_as_none_until_a_target_is_named(rates: Session, workspace_id: str) -> None:
    add_subscription(rates, workspace_id, "1000")
    add_subscription(rates, workspace_id, "20", "USD")
    target, total = money.mrr(rates, workspace_id, today=DAY)
    assert (target, total) == (None, None)
    named = money.mrr(rates, workspace_id, today=DAY, currency="INR")
    assert named == ("INR", Decimal("2670.00"))


# --------------------------------------------------------------- burn and runway (§3)


def test_burn_adds_recurring_rates_and_this_months_one_offs(session: Session, workspace_id: str) -> None:
    add_expense(session, workspace_id, "Rent", "42000", recurring=True, recurrence="monthly")
    add_expense(session, workspace_id, "Domains", "12000", recurring=True, recurrence="yearly")
    add_expense(session, workspace_id, "Lunch", "900")  # one-off, this month
    add_expense(
        session, workspace_id, "Old laptop", "80000", paid_on=DAY - dt.timedelta(days=90)
    )  # one-off, not this month
    target, total = money.monthly_burn(session, workspace_id, today=DAY)
    assert (target, total) == ("INR", Decimal("43900.00"))  # 42000 + 1000 + 900


def test_a_recurring_rule_paid_every_month_still_costs_once_a_month(
    session: Session, workspace_id: str
) -> None:
    """§3 counts a recurring expense's *normalised* figure: twelve payments, one commitment."""
    for back in range(12):
        add_expense(
            session,
            workspace_id,
            "Studio rent",
            "18000",
            recurring=True,
            recurrence="monthly",
            paid_on=money.shift_month(DAY, -back),
        )
    _, total = money.monthly_burn(session, workspace_id, today=DAY)
    assert total == Decimal("18000.00")


def test_the_newest_instance_of_a_rule_sets_the_rate(session: Session, workspace_id: str) -> None:
    add_expense(
        session,
        workspace_id,
        "Studio rent",
        "18000",
        recurring=True,
        recurrence="monthly",
        paid_on=DAY - dt.timedelta(days=200),
    )
    add_expense(
        session,
        workspace_id,
        "Studio rent",
        "20000",
        recurring=True,
        recurrence="monthly",
        paid_on=DAY - dt.timedelta(days=10),
    )
    _, total = money.monthly_burn(session, workspace_id, today=DAY)
    assert total == Decimal("20000.00")
    assert [row.label for row in money.recurring_rules(session, workspace_id)] == ["Studio rent"]


def test_a_slower_than_monthly_cadence_is_never_dropped_from_burn(
    session: Session, workspace_id: str
) -> None:
    """A quarterly premium paid four months ago is still a monthly cost of a third of it."""
    add_expense(
        session,
        workspace_id,
        "Insurance",
        "9000",
        recurring=True,
        recurrence="quarterly",
        paid_on=DAY - dt.timedelta(days=120),
    )
    _, total = money.monthly_burn(session, workspace_id, today=DAY)
    assert total == Decimal("3000.00")


def test_clearing_the_recurring_flag_stops_the_rule_counting(session: Session, workspace_id: str) -> None:
    add_expense(
        session,
        workspace_id,
        "Retained contractor",
        "2800",
        "USD",
        recurring=True,
        recurrence="monthly",
        paid_on=DAY - dt.timedelta(days=70),
    )
    before = money.monthly_burn(session, workspace_id, today=DAY, currency="USD")
    row = session.query(Expense).one()
    row.recurring = False
    row.recurrence = "none"
    session.flush()
    after = money.monthly_burn(session, workspace_id, today=DAY, currency="USD")
    assert before == ("USD", Decimal("2800.00"))
    # no live rules and nothing paid this month is a real zero, not a missing answer
    assert after == ("USD", Decimal("0.00"))
    assert money.runway_months(Decimal("100000"), after[1]) is None


def test_mixed_recurring_spend_names_no_currency_and_therefore_no_burn(
    rates: Session, workspace_id: str
) -> None:
    """FINDING 1, helper level: a mixed tally is not a total until a code is named."""
    add_expense(rates, workspace_id, "Rent", "42000", recurring=True, recurrence="monthly")
    add_expense(
        rates,
        workspace_id,
        "Contract developer",
        "2800",
        "USD",
        recurring=True,
        recurrence="monthly",
        paid_on=DAY - dt.timedelta(days=40),
    )
    assert money.monthly_burn(rates, workspace_id, today=DAY) == (None, None)
    inr = money.monthly_burn(rates, workspace_id, today=DAY, currency="INR")
    assert inr == ("INR", Decimal("275800.00"))  # 42000 + 2800 x 83.50 - the USD row is in it


@pytest.mark.parametrize(
    ("cash", "burn", "expected"),
    [(Decimal("100000"), Decimal("50000"), 2.0), (Decimal("100000"), Decimal("0"), None),
     (None, Decimal("50000"), None), (Decimal("100000"), None, None),
     (Decimal("0"), Decimal("50000"), 0.0)],
)
def test_zero_burn_is_infinite_runway_and_infinity_is_not_a_number(
    cash: Decimal | None, burn: Decimal | None, expected: float | None
) -> None:
    assert money.runway_months(cash, burn) == expected


def test_cash_in_window_is_the_90_day_net_floored_at_zero(rates: Session, workspace_id: str) -> None:
    """§3: cash may be zero, but it is never negative - a debt is not negative runway."""
    add_income(rates, workspace_id, "Retainer", "10000", received_on=DAY - dt.timedelta(days=10))
    quiet = money.cash_in_window(rates, workspace_id, today=DAY, currency="INR")
    assert quiet == ("INR", Decimal("10000.00"))
    add_expense(rates, workspace_id, "Equipment", "40000", paid_on=DAY - dt.timedelta(days=5))
    spent = money.cash_in_window(rates, workspace_id, today=DAY, currency="INR")
    assert spent == ("INR", Decimal("0.00"))
    # the window itself is 90 days: older spend does not count against it
    earlier = money.cash_in_window(
        rates, workspace_id, today=DAY - dt.timedelta(days=200), currency="INR"
    )
    assert earlier[1] == Decimal("0.00")


def test_receivables_are_the_unpaid_rows_and_the_overday_ones_are_listed(
    session: Session, workspace_id: str
) -> None:
    owed = add_income(session, workspace_id, "Kite audit", "6000", "EUR", status="invoiced")
    late = add_income(
        session,
        workspace_id,
        "Northwind invoice",
        "180000",
        status=IncomeStatus.OVERDUE.value,
        received_on=DAY - dt.timedelta(days=9),
    )
    add_income(session, workspace_id, "Paid already", "5000", status=IncomeStatus.PAID.value)
    add_income(session, workspace_id, "Lost", "400", status=IncomeStatus.WRITTEN_OFF.value)
    target, total, overdue = money.receivables(session, workspace_id, today=DAY)
    assert (target, total) == (None, None)  # EUR and INR: no named code, no total
    assert [row.id for row in overdue] == [late.id]
    assert owed.status == "invoiced"
    # naming a target is not enough: §2.4 wants a rate, and says which pair is missing
    with pytest.raises(ApiError) as caught:
        money.receivables(session, workspace_id, today=DAY, currency="INR")
    assert "EUR" in caught.value.message and "INR" in caught.value.message


# ------------------------------------------------------------ the calculator (§4)


def preview(data: dict) -> dict:
    return money.take_home(data)


def test_a_regime_of_none_pays_nothing_and_warns_about_the_slabs_it_ignored() -> None:
    got = preview(
        {
            "gross_monthly": "100000",
            "currency": "INR",
            "tax_regime": "none",
            "slabs": [{"up_to": None, "rate": 30}],
        }
    )
    assert got["tax"] == Decimal(0)
    assert got["net_monthly"] == Decimal("100000")
    assert got["warnings"] and "not applied" in got["warnings"][0]


def test_flat_tax_applies_to_taxable_not_gross() -> None:
    got = preview(
        {
            "gross_monthly": "100000",
            "currency": "INR",
            "tax_regime": "flat",
            "tax_rate": 20,
            "deductions": [{"label": "EPF", "amount": "120000", "pre_tax": True}],
        }
    )
    # 120000 a year off the 1200000 gross, 20% of the 1080000 left
    assert got["taxable"] == Decimal("90000")  # the monthly axis of 1080000
    assert got["tax"] == Decimal("18000")
    assert got["net_monthly"] == Decimal("82000")  # 1200000 - 216000 tax, over 12
    assert got["effective_tax_rate"] == Decimal("18")


def test_presumptive_taxes_the_gross_so_deductions_do_not_help() -> None:
    got = preview(
        {
            "gross_annual": "2400000",
            "period": "annual",
            "currency": "INR",
            "tax_regime": "presumptive",
            "tax_rate": 8,
            "deductions": [{"label": "EPF", "amount": "200000", "pre_tax": True}],
        }
    )
    assert got["tax"] == Decimal("192000")
    assert any("charged on gross" in warning for warning in got["warnings"])


def test_slabs_are_cumulative_and_the_breakdown_shows_each_bracket() -> None:
    got = preview(
        {
            "gross_annual": "1000000",
            "period": "annual",
            "currency": "INR",
            "tax_regime": "slab",
            "slabs": [
                {"up_to": 400000, "rate": 5},
                {"up_to": 800000, "rate": 15},
                {"up_to": None, "rate": 30},
            ],
        }
    )
    assert got["tax"] == Decimal("20000") + Decimal("60000") + Decimal("60000")
    assert [(item["from"], item["to"], item["rate"]) for item in got["slab_breakdown"]] == [
        (Decimal("0.00"), Decimal("400000.00"), Decimal("5.000000")),
        (Decimal("400000.00"), Decimal("800000.00"), Decimal("15.000000")),
        (Decimal("800000.00"), Decimal("1000000.00"), Decimal("30.000000")),
    ]


def test_slabs_that_end_at_a_number_leave_the_top_income_untaxed_and_say_so() -> None:
    got = preview(
        {
            "gross_annual": "1500000",
            "period": "annual",
            "currency": "INR",
            "tax_regime": "slab",
            "slabs": [{"up_to": 1000000, "rate": 10}],
        }
    )
    assert got["tax"] == Decimal("100000")
    assert any("left untaxed" in warning for warning in got["warnings"])


def test_post_tax_deductions_come_after_the_tax_and_other_income_is_monthly() -> None:
    got = preview(
        {
            "gross_monthly": "100000",
            "currency": "INR",
            "tax_regime": "flat",
            "tax_rate": 10,
            "deductions": [{"label": "Loan EMI", "amount": "60000", "pre_tax": False}],
            "other_income": "5000",
        }
    )
    # 1200000 gross - 120000 tax - 60000 EMI + 60000 other income
    assert got["net_annual"] == Decimal("1080000")
    assert got["net_monthly"] == Decimal("90000")


def test_a_pre_tax_deduction_bigger_than_the_gross_is_floored_not_negative() -> None:
    got = preview(
        {
            "gross_monthly": "10000",
            "currency": "INR",
            "tax_regime": "flat",
            "tax_rate": 30,
            "deductions": [{"label": "EPF", "amount": "400000", "pre_tax": True}],
        }
    )
    assert got["taxable"] == Decimal(0)
    assert got["tax"] == Decimal(0)
    assert any("floored at zero" in warning for warning in got["warnings"])


@pytest.mark.parametrize(
    ("data", "field"),
    [
        ({"currency": "INR", "gross_monthly": "-5"}, "gross_monthly"),
        ({"currency": "INR", "gross_annual": "-5"}, "gross_annual"),
        ({"currency": "INR", "gross_monthly": "1000", "tax_rate": "150"}, "tax_rate"),
        ({"currency": "INR", "gross_monthly": "1000", "other_income": "-2"}, "other_income"),
        ({"currency": "INR", "gross_monthly": "1000", "period": "fortnight"}, "period"),
        ({"currency": "INR", "gross_annual": "1000000", "slabs": [{"up_to": "0", "rate": 5}]}, "up_to"),
        ({"currency": "INR", "gross_monthly": "1000", "tax_regime": "graded"}, "tax_regime"),
    ],
)
def test_the_calculator_refuses_figures_it_cannot_use(data: dict, field: str) -> None:
    """Each rejection names the field, because the UI paints the 422 details per input."""
    with pytest.raises(ApiError) as caught:
        money.take_home({"tax_regime": "flat", **data})
    assert caught.value.status_code == 422
    assert caught.value.details[0]["field"].endswith(field)


def test_the_calculator_needs_a_gross_figure_of_some_kind() -> None:
    with pytest.raises(ApiError) as caught:
        money.take_home({"currency": "INR", "tax_regime": "flat", "tax_rate": 5})
    assert caught.value.details[0]["field"] == "gross_monthly"


def test_two_axes_of_the_same_profile_agree() -> None:
    monthly = money.take_home({"gross_monthly": "100000", "currency": "INR", "tax_regime": "none"})
    annual = money.take_home(
        {"gross_annual": "1200000", "period": "annual", "currency": "INR", "tax_regime": "none"}
    )
    assert monthly["net_annual"] == annual["net"] == Decimal("1200000")
    assert monthly["net_monthly"] == Decimal("100000")


# ------------------------------------------------------- the overview envelope (§4)


@pytest.fixture
def mixed_book(rates: Session, workspace_id: str) -> str:
    """The coordinator's live book in miniature: INR rows, one recurring USD rule, USD/INR rate."""
    add_expense(rates, workspace_id, "Rent", "60000", paid_on=DAY - dt.timedelta(days=5))
    add_expense(rates, workspace_id, "Groceries", "12000", paid_on=DAY - dt.timedelta(days=3))
    add_expense(
        rates,
        workspace_id,
        "Contract developer",
        "2800",
        "USD",
        recurring=True,
        recurrence="monthly",
        paid_on=DAY - dt.timedelta(days=40),
    )
    add_income(rates, workspace_id, "Retainer", "180000", received_on=DAY - dt.timedelta(days=6))
    add_subscription(rates, workspace_id, "2500")
    add_subscription(rates, workspace_id, "12", "USD")
    return workspace_id


def test_an_unnamed_overview_nulls_every_figure_that_would_need_a_rate(
    rates: Session, mixed_book: str
) -> None:
    """§2.3 rule 3, endpoint level: a null currency never travels with a bare number."""
    body = money.finance_summary(rates, mixed_book, today=DAY)
    assert body["currency"] is None
    for key in (
        "income",
        "expense",
        "net",
        "monthly_income_avg_3m",
        "monthly_burn",
        "runway_months",
        "mrr",
        "arr",
        "receivables",
        "overdue_income",
        "cash_in_90d",
    ):
        assert body[key] is None, key
    # the answers a mixed book always gets: the per-currency blocks, in their own codes
    assert {row["currency"] for row in body["by_currency"]} == {"INR", "USD"}
    assert all(row["month"].count("-") == 1 for row in body["income_by_month"])
    assert body["income_by_month"][-1]["income"] is None  # still unnamed, still no number


def test_naming_the_currency_fills_the_same_keys(rates: Session, mixed_book: str) -> None:
    body = money.finance_summary(rates, mixed_book, today=DAY, currency="INR")
    assert body["currency"] == "INR"
    # 60000 + 12000 paid this month, plus the USD rule at 2800 x 83.50
    assert body["monthly_burn"] == Decimal("305800.00")
    assert body["runway_months"] is not None
    assert body["arr"] == body["mrr"] * Decimal(12)


def test_the_two_summaries_agree_on_the_recurring_figure(
    rates: Session, mixed_book: str
) -> None:
    """/expenses/summary.recurring_monthly and /finance/summary.monthly_burn are one rule set."""
    overview = money.finance_summary(rates, mixed_book, today=DAY, currency="USD")
    ledger = money.expense_summary(rates, mixed_book, month=DAY, today=DAY, currency="USD")
    assert ledger["recurring_monthly"] == Decimal("2800.00")  # the USD rule, in USD
    # and burn is that same rule plus this month's INR one-offs, 72000 / 83.50
    assert overview["monthly_burn"] == Decimal("2800.00") + Decimal("862.28")


def test_an_expense_summary_of_a_single_currency_month_still_names_one(
    rates: Session, workspace_id: str
) -> None:
    add_expense(rates, workspace_id, "Rent", "60000", paid_on=DAY)
    add_expense(
        rates,
        workspace_id,
        "Server",
        "9000",
        "USD",
        recurring=True,
        recurrence="monthly",
        paid_on=DAY - dt.timedelta(days=100),
    )
    body = money.expense_summary(rates, workspace_id, month=DAY, today=DAY)
    assert body["currency"] == "INR"  # the month itself is one-currency, so the total is honest
    assert body["total"] == Decimal("60000.00")
    assert {row["currency"] for row in body["by_currency"]} == {"INR"}
    # the run rate is not the month's history: it is every live rule, converted into the
    # code this response names - the alternative is a monthly figure that quietly omits it
    assert body["recurring_monthly"] == Decimal("751500.00")
    unnamed = money.expense_summary(rates, workspace_id, month=DAY - dt.timedelta(days=100), today=DAY)
    assert (unnamed["currency"], unnamed["total"]) == ("USD", Decimal("9000.00"))
    assert unnamed["recurring_monthly"] == Decimal("9000.00")


def test_the_income_summary_nulls_what_it_cannot_name(rates: Session, mixed_book: str) -> None:
    add_income(rates, mixed_book, "Berlin workshop", "4000", "USD", status="invoiced")
    unnamed = money.income_summary(rates, mixed_book, month=DAY, today=DAY)
    named = money.income_summary(rates, mixed_book, month=DAY, today=DAY, currency="INR")
    assert unnamed["currency"] is None
    assert unnamed["received"] is None and unnamed["invoiced"] is None
    assert unnamed["receivables"] is None
    assert all(row["received"] is None and row["invoiced"] is None for row in unnamed["series"])
    assert named["currency"] == "INR" and named["received"] == Decimal("180000.00")
    assert named["invoiced"] == Decimal("334000.00")  # 4000 USD at 83.50
    assert {row["currency"] for row in named["by_currency"]} == {"INR", "USD"}


def test_a_month_argument_may_be_a_label_or_a_date(rates: Session, mixed_book: str) -> None:
    as_label = money.expense_summary(rates, mixed_book, month="2026-11", today=DAY)
    as_first = money.expense_summary(rates, mixed_book, month="2026-11-01", today=DAY)
    assert as_label == as_first
    income_label = money.income_summary(rates, mixed_book, month="2026-11", today=DAY)
    assert income_label["month"] == "2026-11"
