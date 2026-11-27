"""``/cost-scenarios`` and the curve it derives (§3, §4): recomputed, never stored.

Two rules make this file. The projection is built from the item rows on every read - so
editing an item moves the curve, and a scenario has no total column to be wrong about - and
a mixed-currency curve reports ``null`` rather than blending codes (§2.3), unless the caller
names one.  Money is compared as ``Decimal`` and every derived read is given ``today=``, as
in :mod:`tests.test_money`.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import CostScenario, CostScenarioItem, Expense, ExchangeRate
from app.services import expenses, money, scenarios

DAY = dt.date(2026, 11, 21)
#: the curve's first month: December, so ``today`` sits one month before the plan starts
START = dt.date(2026, 12, 1)

V1 = "/api/v1"


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


def plan(
    session: Session, workspace_id: str, name: str = "Plan", **fields: Any
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "name": name,
        "start_month": START,
        "horizon_months": 12,
        "currency": "INR",
        **fields,
    }
    return scenarios.create_scenario(session, workspace_id, body)


def line(
    session: Session,
    workspace_id: str,
    scenario_id: str,
    label: str,
    amount: str,
    **fields: Any,
) -> dict[str, Any]:
    body: dict[str, Any] = {"label": label, "amount": amount, "currency": "INR", **fields}
    return scenarios.create_item(session, workspace_id, scenario_id, body)


def curve(session: Session, workspace_id: str, scenario_id: str, **kw: Any) -> dict[str, Any]:
    """The one way this file reads a projection: always with the injected day."""
    return scenarios.projection(session, workspace_id, scenario_id, today=DAY, **kw)


# ------------------------------------------------------------------ the curve's shape


def test_the_axis_is_one_label_per_month_of_the_horizon(session: Session, workspace_id: str) -> None:
    row = plan(session, workspace_id, horizon_months=3)
    line(session, workspace_id, row["id"], "Rent", "20000", recurrence="monthly")
    built = curve(session, workspace_id, row["id"])
    assert [month["month"] for month in built["months"]] == ["2026-12", "2027-01", "2027-02"]
    assert set(built["months"][0]) == {"month", "income", "cost", "net", "cumulative"}
    assert (built["horizon_months"], built["currency"]) == (3, "INR")
    assert built["scenario"]["id"] == row["id"]


def test_the_totals_are_the_sum_of_the_months(session: Session, workspace_id: str) -> None:
    """§10.2: a curve whose headline does not equal its own months is a broken chart."""
    row = plan(session, workspace_id, horizon_months=4)
    line(session, workspace_id, row["id"], "Rent", "20000", recurrence="monthly")
    line(session, workspace_id, row["id"], "Contract", "9000", direction="income", recurrence="monthly")
    built = curve(session, workspace_id, row["id"])
    months = built["months"]
    for field in ("income", "cost", "net"):
        assert built["totals"][field] == sum((month[field] for month in months), Decimal(0))
    assert built["totals"] == {
        "income": Decimal("36000.00"),
        "cost": Decimal("80000.00"),
        "net": Decimal("-44000.00"),
    }
    assert months[-1]["cumulative"] == Decimal("-44000.00")


def test_direction_is_the_sign_and_nothing_else(session: Session, workspace_id: str) -> None:
    row = plan(session, workspace_id, horizon_months=2)
    cost = line(session, workspace_id, row["id"], "Tooling", "500", recurrence="monthly")
    earned = line(
        session, workspace_id, row["id"], "Retainer", "500", direction="income", recurrence="monthly"
    )
    assert (cost["monthly_amount"], earned["monthly_amount"]) == (
        Decimal("-500.00"),
        Decimal("500.00"),
    )
    month = curve(session, workspace_id, row["id"])["months"][0]
    assert (month["income"], month["cost"], month["net"]) == (
        Decimal("500.00"),
        Decimal("500.00"),
        Decimal("0.00"),
    )


# --------------------------------------------------------------------- normalisation


@pytest.mark.parametrize(
    "recurrence,amount,monthly",
    [
        ("weekly", "100", "433.33"),  # x 52/12, not x 4
        ("monthly", "100", "100.00"),
        ("quarterly", "3000", "1000.00"),
        ("yearly", "12000", "1000.00"),
        ("one_time", "12000", "1000.00"),  # ÷ the scenario horizon, not ÷ 12 by luck
    ],
)
def test_every_interval_becomes_one_months_figure(
    session: Session, workspace_id: str, recurrence: str, amount: str, monthly: str
) -> None:
    row = plan(session, workspace_id, horizon_months=12)
    item = line(session, workspace_id, row["id"], "Line", amount, recurrence=recurrence)
    # the stored figure is unsigned, the payload figure is signed by direction, the curve
    # re-signs it back into a positive cost column (§3)
    assert item["amount"] == Decimal(amount)
    assert item["monthly_amount"] == -Decimal(monthly)
    assert curve(session, workspace_id, row["id"])["months"][0]["cost"] == Decimal(monthly)


def test_a_one_time_line_follows_the_horizon_it_is_asked_for(
    session: Session, workspace_id: str
) -> None:
    row = plan(session, workspace_id, horizon_months=12)
    item = line(session, workspace_id, row["id"], "Laptop", "60000", recurrence="one_time")
    assert item["monthly_amount"] == Decimal("-5000.00")
    # ?horizon_months= re-scales the divisor as well as the axis (§4)
    six = curve(session, workspace_id, row["id"], horizon_months=6)
    assert six["horizon_months"] == 6
    assert [month["month"] for month in six["months"]] == [
        "2026-12",
        "2027-01",
        "2027-02",
        "2027-03",
        "2027-04",
        "2027-05",
    ]
    assert six["months"][0]["cost"] == Decimal("10000.00")


def test_a_line_with_no_cadence_is_not_in_the_curve(session: Session, workspace_id: str) -> None:
    """§9: the view calls this out as absent, so the API has to keep it absent (§3)."""
    row = plan(session, workspace_id, horizon_months=3)
    silent = line(session, workspace_id, row["id"], "Talking about it", "5000")
    assert silent["recurrence"] is None and silent["monthly_amount"] is None
    loud = line(session, workspace_id, row["id"], "Rent", "20000", recurrence="monthly")
    months = curve(session, workspace_id, row["id"])["months"]
    assert all(month["cost"] == Decimal("20000.00") for month in months)
    assert [item["label"] for item in scenarios.get_scenario(session, workspace_id, row["id"])["items"]] == [
        "Rent",
        "Talking about it",
    ]
    assert loud["monthly_amount"] == Decimal("-20000.00")


def test_the_scenarios_own_currency_is_the_fallback(session: Session, workspace_id: str) -> None:
    """A line with no code is priced in the plan's code, not in a guessed one (§2.5)."""
    row = plan(session, workspace_id, horizon_months=2, currency="INR")
    line(session, workspace_id, row["id"], "Uncoded", "700", recurrence="monthly", currency=None)
    built = curve(session, workspace_id, row["id"])
    assert built["currency"] == "INR"
    assert built["months"][0]["cost"] == Decimal("700.00")


# ------------------------------------------------------------------ the date windows


def test_starts_on_ramps_a_line_in(session: Session, workspace_id: str) -> None:
    row = plan(session, workspace_id, horizon_months=3)
    line(
        session, workspace_id, row["id"], "Hire", "30000",
        recurrence="monthly", starts_on=dt.date(2027, 2, 1),
    )
    months = curve(session, workspace_id, row["id"])["months"]
    assert [month["cost"] for month in months] == [
        Decimal("0.00"),
        Decimal("0.00"),
        Decimal("30000.00"),
    ]


def test_ends_on_stops_a_line_and_an_open_end_does_not(session: Session, workspace_id: str) -> None:
    row = plan(session, workspace_id, horizon_months=3)
    line(
        session,
        workspace_id,
        row["id"],
        "Contractor",
        "40000",
        recurrence="monthly",
        ends_on=dt.date(2027, 1, 31),
    )
    line(session, workspace_id, row["id"], "Hosting", "500", recurrence="monthly")
    months = curve(session, workspace_id, row["id"])["months"]
    assert [month["cost"] for month in months] == [
        Decimal("40500.00"),
        Decimal("40500.00"),
        Decimal("500.00"),
    ]


def test_break_even_is_the_first_month_the_curve_is_back_above_zero(
    session: Session, workspace_id: str
) -> None:
    row = plan(session, workspace_id, horizon_months=4)
    line(session, workspace_id, row["id"], "Build", "30000", recurrence="monthly")
    line(
        session, workspace_id, row["id"], "Launch revenue", "50000", direction="income", recurrence="monthly"
    )
    # December and January are carried by the launch alone, so the curve never goes under
    built = curve(session, workspace_id, row["id"])
    assert built["break_even_month"] == "2026-12"
    assert built["months"][0]["cumulative"] == Decimal("20000.00")


def test_runway_is_the_months_the_plan_last_for(session: Session, workspace_id: str) -> None:
    row = plan(session, workspace_id, horizon_months=6)
    line(
        session,
        workspace_id,
        row["id"],
        "Seed money",
        "50000",
        direction="income",
        recurrence="monthly",
        starts_on=START,
        ends_on=START,
    )
    line(session, workspace_id, row["id"], "Salaries", "30000", recurrence="monthly")
    built = curve(session, workspace_id, row["id"])
    assert [month["cumulative"] for month in built["months"][:3]] == [
        Decimal("20000.00"),
        Decimal("-10000.00"),
        Decimal("-40000.00"),
    ]
    assert built["runway_months"] == 1.0
    assert built["break_even_month"] == "2026-12"


def test_a_plan_that_never_goes_under_has_no_runway_number(
    session: Session, workspace_id: str
) -> None:
    row = plan(session, workspace_id, horizon_months=3)
    line(session, workspace_id, row["id"], "Profit", "1000", direction="income", recurrence="monthly")
    built = curve(session, workspace_id, row["id"])
    assert built["runway_months"] is None
    assert built["break_even_month"] == "2026-12"


# -------------------------------------------------------------------- mixed currencies


def test_a_mixed_curve_reports_no_total_until_somebody_names_one(
    session: Session, workspace_id: str
) -> None:
    row = plan(session, workspace_id, horizon_months=2, currency=None)
    line(session, workspace_id, row["id"], "Server", "2000", currency="INR", recurrence="monthly")
    line(session, workspace_id, row["id"], "License", "100", currency="USD", recurrence="monthly")
    add_rate(session, workspace_id, "USD", "INR", "83.50", as_of=dt.date(2026, 1, 1))

    unnamed = curve(session, workspace_id, row["id"])
    assert unnamed["currency"] is None
    assert all(month["cost"] is None and month["net"] is None for month in unnamed["months"])
    assert unnamed["totals"] == {"income": None, "cost": None, "net": None}
    assert unnamed["break_even_month"] is None and unnamed["runway_months"] is None

    inr = curve(session, workspace_id, row["id"], currency="INR")
    assert inr["currency"] == "INR"
    assert inr["months"][0]["cost"] == Decimal("10350.00")  # 2000 + 100 x 83.50
    assert inr["totals"]["cost"] == Decimal("20700.00")


def test_a_curve_prices_each_month_at_the_newest_rate_so_far(
    session: Session, workspace_id: str
) -> None:
    """§2.4 inside a projection: no rate for the month yet, so the last known one is used."""
    row = plan(session, workspace_id, horizon_months=3, currency="INR")
    line(session, workspace_id, row["id"], "License", "100", currency="USD", recurrence="monthly")
    add_rate(session, workspace_id, "USD", "INR", "80.00", as_of=dt.date(2026, 11, 1))
    add_rate(session, workspace_id, "USD", "INR", "90.00", as_of=dt.date(2027, 2, 1))
    # two codes in one plan (the plan's own INR and the line's USD), so the reader has to
    # name the answer even though the scenario has a currency - the fallback is for a plan
    # whose lines carry no code at all, not for a mixed one
    months = curve(session, workspace_id, row["id"], currency="INR")["months"]
    assert [month["cost"] for month in months] == [
        Decimal("8000.00"),
        Decimal("8000.00"),
        Decimal("9000.00"),
    ]
    assert [month["month"] for month in months] == ["2026-12", "2027-01", "2027-02"]


def test_a_curve_refuses_a_pair_it_has_never_seen(session: Session, workspace_id: str) -> None:
    row = plan(session, workspace_id, horizon_months=2, currency="INR")
    line(session, workspace_id, row["id"], "License", "100", currency="EUR", recurrence="monthly")
    with pytest.raises(ApiError) as caught:
        curve(session, workspace_id, row["id"], currency="INR")
    assert caught.value.status_code == 422
    assert "EUR" in caught.value.message and "INR" in caught.value.message


# -------------------------------------------------------------------------- compare


def test_compare_puts_both_curves_on_the_union_of_their_axes(
    session: Session, workspace_id: str
) -> None:
    short = plan(session, workspace_id, "Short", horizon_months=2)
    long = plan(session, workspace_id, "Long", horizon_months=4)
    line(session, workspace_id, short["id"], "Rent", "20000", recurrence="monthly")
    line(session, workspace_id, long["id"], "Rent", "26000", recurrence="monthly")
    built = scenarios.compare(session, workspace_id, a_id=short["id"], b_id=long["id"], today=DAY)
    assert [month["month"] for month in built["months"]] == [
        "2026-12",
        "2027-01",
        "2027-02",
        "2027-03",
    ]
    assert built["a"]["id"] == short["id"] and built["b"]["id"] == long["id"]
    assert built["currency"] == "INR"
    first, beyond = built["months"][0], built["months"][2]
    assert first["delta"] == Decimal("6000.00")  # -20000 minus -26000
    assert first["a"]["in_horizon"] is True and first["b"]["in_horizon"] is True
    assert beyond["a"] == {
        "income": None,
        "cost": None,
        "net": None,
        "cumulative": None,
        "in_horizon": False,
    }
    assert beyond["delta"] is None
    assert built["totals"] == {
        "a": {"income": Decimal("0.00"), "cost": Decimal("40000.00"), "net": Decimal("-40000.00")},
        "b": {"income": Decimal("0.00"), "cost": Decimal("104000.00"), "net": Decimal("-104000.00")},
    }


def test_compare_names_which_plan_gets_to_zero_first(session: Session, workspace_id: str) -> None:
    a = plan(session, workspace_id, "A", horizon_months=3)
    b = plan(session, workspace_id, "B", horizon_months=3)
    line(session, workspace_id, a["id"], "Cost", "1000", recurrence="monthly")
    line(session, workspace_id, a["id"], "Cash", "2500", direction="income", recurrence="monthly")
    line(session, workspace_id, b["id"], "Cost", "2500", recurrence="monthly")
    line(
        session, workspace_id, b["id"], "Late cash", "9000", direction="income", recurrence="monthly",
        starts_on=dt.date(2027, 2, 1),
    )
    built = scenarios.compare(session, workspace_id, a_id=a["id"], b_id=b["id"], currency="INR", today=DAY)
    assert built["break_even"] == {"a": "2026-12", "b": "2027-02", "first": "a"}
    assert built["months"][2]["delta"] == Decimal("-5000.00")  # a nets 1500 in February, b nets 6500


def test_compare_stays_null_when_the_two_plans_do_not_share_a_code(
    session: Session, workspace_id: str
) -> None:
    a = plan(session, workspace_id, "A", currency="INR")
    b = plan(session, workspace_id, "B", currency="USD")
    line(session, workspace_id, a["id"], "Cost", "1000", recurrence="monthly", currency="INR")
    line(session, workspace_id, b["id"], "Cost", "100", recurrence="monthly", currency="USD")
    built = scenarios.compare(session, workspace_id, a_id=a["id"], b_id=b["id"], today=DAY)
    assert built["currency"] is None
    assert built["months"][0]["delta"] is None
    assert built["months"][0]["a"]["cost"] == Decimal("1000.00")
    assert built["months"][0]["b"]["cost"] == Decimal("100.00")


# ---------------------------------------------------------------------- stored shape


def test_the_stored_row_holds_no_derived_figure(session: Session, workspace_id: str) -> None:
    row = plan(session, workspace_id, assumptions={"inflation": 0.06}, notes="a plan")
    line(session, workspace_id, row["id"], "Rent", "20000", recurrence="monthly")
    listed, total = scenarios.list_scenarios(session, workspace_id)
    assert total == 1
    body = listed[0]
    assert set(body) == {
        "id",
        "name",
        "kind",
        "horizon_months",
        "start_month",
        "currency",
        "base_income_profile_id",
        "assumptions",
        "status",
        "notes",
        "source",
        "item_count",
        "created_at",
        "updated_at",
    }
    assert body["item_count"] == 1 and body["assumptions"] == {"inflation": 0.06}
    assert body["start_month"] == START
    assert not {"total", "curve", "break_even", "months"} & set(body)


def test_get_nests_the_items_and_deleting_the_plan_takes_them(
    session: Session, workspace_id: str
) -> None:
    row = plan(session, workspace_id)
    line(session, workspace_id, row["id"], "Beta", "100", recurrence="monthly", starts_on=dt.date(2027, 1, 1))
    line(session, workspace_id, row["id"], "Alpha", "100", recurrence="monthly", starts_on=START)
    nested = scenarios.get_scenario(session, workspace_id, row["id"])
    assert [item["label"] for item in nested["items"]] == ["Alpha", "Beta"]
    scenarios.delete_scenario(session, workspace_id, row["id"])
    assert session.scalar(select(func.count()).select_from(CostScenarioItem)) == 0
    assert session.scalar(select(func.count()).select_from(CostScenario)) == 0


def test_activating_a_plan_archives_the_previous_one_by_name(
    session: Session, workspace_id: str
) -> None:
    first = plan(session, workspace_id, "First", status="active")
    second = plan(session, workspace_id, "Second")
    built = scenarios.activate(session, workspace_id, second["id"])
    assert built["archived"] == {"id": first["id"], "name": "First"}
    assert built["scenario"]["status"] == "active"
    assert scenarios.get_scenario(session, workspace_id, first["id"])["status"] == "archived"
    assert [row.status for row in session.scalars(select(CostScenario))] == ["archived", "active"]

    # a plan is allowed to be activated twice; it does not archive itself
    again = scenarios.activate(session, workspace_id, second["id"])
    assert again["archived"] is None


def test_setting_status_to_active_over_the_api_keeps_the_invariant(
    client: TestClient, workspace_id: str
) -> None:
    first = client.post(
        f"{V1}/cost-scenarios",
        json={"name": "First", "start_month": "2026-12-01", "horizon_months": 3, "status": "active"},
    ).json()
    second = client.post(
        f"{V1}/cost-scenarios",
        json={"name": "Second", "start_month": "2026-12-01", "horizon_months": 3},
    ).json()
    patched = client.patch(f"{V1}/cost-scenarios/{second['id']}", json={"status": "active"}).json()
    assert patched["status"] == "active"
    assert client.get(f"{V1}/cost-scenarios/{first['id']}").json()["status"] == "archived"


def test_duplicate_copies_the_lines_and_starts_as_a_draft(session: Session, workspace_id: str) -> None:
    row = plan(session, workspace_id, "Hiring plan", status="active", assumptions={"hires": 3})
    item = line(session, workspace_id, row["id"], "Recruiter fee", "50000", recurrence="one_time")
    built = scenarios.duplicate(session, workspace_id, row["id"])
    clone = built["scenario"]
    assert built["copied_items"] == 1
    assert (clone["name"], clone["status"]) == ("Hiring plan (copy)", "draft")
    assert clone["assumptions"] == {"hires": 3} and clone["horizon_months"] == row["horizon_months"]
    assert [entry["label"] for entry in clone["items"]] == ["Recruiter fee"]
    assert clone["items"][0]["id"] != item["id"]
    assert clone["items"][0]["monthly_amount"] == Decimal("-4166.67")  # 50000 ÷ 12, in the clone too

    scenarios.duplicate(session, workspace_id, clone["id"])
    third = scenarios.duplicate(session, workspace_id, row["id"])
    assert third["scenario"]["name"] == "Hiring plan (copy 2)"


# --------------------------------------------------------------------- item plumbing


def test_an_item_cannot_be_written_onto_another_plan(session: Session, workspace_id: str) -> None:
    row = plan(session, workspace_id, "Real")
    other = plan(session, workspace_id, "Other")
    with pytest.raises(ApiError) as caught:
        scenarios.create_item(
            session,
            workspace_id,
            row["id"],
            {"label": "Crossed", "amount": "1", "scenario_id": other["id"]},
        )
    assert caught.value.status_code == 409
    assert caught.value.details[0]["field"] == "scenario_id"


@pytest.mark.parametrize(
    "fields,message",
    [
        ({"label": "  ", "amount": "1"}, "label"),
        ({"label": "No figure"}, "amount"),
        ({"label": "Negative", "amount": "-1"}, "amount"),
        ({"label": "Bad", "amount": "1", "direction": "expense"}, "direction"),
        ({"label": "Bad", "amount": "1", "recurrence": "daily"}, "recurrence"),
        ({"label": "Bad", "amount": "1", "currency": "Cling"}, "currency"),
        (
            {"label": "Bad", "amount": "1", "ends_on": "2026-12-01", "starts_on": "2026-12-31"},
            "ends_on",
        ),
        ({"label": "Bad", "amount": "1", "category_id": "nope"}, "category_id"),
    ],
)
def test_a_bad_line_is_refused_naming_the_field(
    session: Session, workspace_id: str, fields: dict[str, Any], message: str
) -> None:
    row = plan(session, workspace_id)
    with pytest.raises(ApiError) as caught:
        scenarios.create_item(session, workspace_id, row["id"], fields)
    assert caught.value.status_code == 422
    assert caught.value.details[0]["field"] == message


def test_an_item_can_be_moved_and_its_cadence_cleared(session: Session, workspace_id: str) -> None:
    first = plan(session, workspace_id, "First")
    second = plan(session, workspace_id, "Second")
    item = line(session, workspace_id, first["id"], "Shared", "3000", recurrence="monthly")
    moved = scenarios.update_item(
        session, workspace_id, item["id"], {"scenario_id": second["id"], "recurrence": None}
    )
    assert moved["scenario_id"] == second["id"]
    assert moved["recurrence"] is None and moved["monthly_amount"] is None
    assert scenarios.list_items(session, workspace_id, first["id"]) == ([], 0)
    assert curve(session, workspace_id, first["id"])["totals"]["cost"] == Decimal("0.00")
    assert curve(session, workspace_id, second["id"])["totals"]["cost"] == Decimal("0.00")


def test_a_known_category_links_a_line(session: Session, workspace_id: str) -> None:
    row = plan(session, workspace_id)
    category = expenses.create_category(session, workspace_id, {"name": "Software"})
    item = line(session, workspace_id, row["id"], "CI minutes", "900", recurrence="monthly")
    patched = scenarios.update_item(
        session, workspace_id, item["id"], {"category_id": category["id"]}
    )
    assert patched["category_id"] == category["id"]
    with pytest.raises(ApiError):
        scenarios.update_item(session, workspace_id, item["id"], {"category_id": "nope"})


def test_a_line_is_ordered_with_its_plan_and_carries_no_stored_total(
    session: Session, workspace_id: str
) -> None:
    row = plan(session, workspace_id)
    item = line(session, workspace_id, row["id"], "Rent", "20000", recurrence="monthly")
    assert set(item) == {
        "id",
        "scenario_id",
        "label",
        "direction",
        "amount",
        "currency",
        "recurrence",
        "monthly_amount",
        "starts_on",
        "ends_on",
        "category_id",
        "notes",
        "created_at",
        "updated_at",
    }


# ------------------------------------------------------------------------ via HTTP


def test_a_plan_without_a_horizon_is_refused(client: TestClient) -> None:
    """§4 requires ``horizon_months``: a curve with no length is not a plan (1..120)."""
    refused = client.post(f"{V1}/cost-scenarios", json={"name": "Vague", "start_month": "2026-12-01"})
    assert refused.status_code == 422
    error = refused.json()["error"]
    assert error["message"] == "horizon_months is required"
    assert error["details"][0]["field"] == "horizon_months"
    assert client.post(
        f"{V1}/cost-scenarios", json={"name": "Long", "start_month": "2026-12-01", "horizon_months": 121}
    ).status_code == 422


def test_the_projection_route_answers_the_contract(client: TestClient, today: dt.date) -> None:
    created = client.post(
        f"{V1}/cost-scenarios",
        json={"name": "Launch", "start_month": "2026-12-01", "horizon_months": 2, "currency": "INR"},
    )
    assert created.status_code == 201
    scenario_id = created.json()["id"]
    added = client.post(
        f"{V1}/cost-scenarios/{scenario_id}/items",
        json={"label": "Rent", "amount": 20000, "currency": "INR", "recurrence": "monthly"},
    )
    assert added.status_code == 201, added.text
    built = client.get(
        f"{V1}/cost-scenarios/{scenario_id}/projection", params={"today": today.isoformat()}
    ).json()
    assert set(built) == {
        "scenario",
        "currency",
        "horizon_months",
        "months",
        "totals",
        "break_even_month",
        "runway_months",
        "assumptions",
    }
    assert built["months"][0]["month"] == "2026-12"
    assert built["months"][0]["cost"] == 20000.0
    assert built["totals"]["cost"] == 40000.0
    assert client.get(f"{V1}/cost-scenarios/{scenario_id}/items").json() == {
        "items": [added.json()],
        "total": 1,
    }


def test_the_projection_route_checks_its_query(client: TestClient) -> None:
    missing = client.get(f"{V1}/cost-scenarios/none-here/projection")
    assert missing.status_code == 404
    created = client.post(
        f"{V1}/cost-scenarios", json={"name": "P", "start_month": "2026-12-01", "horizon_months": 2}
    ).json()
    assert client.get(
        f"{V1}/cost-scenarios/{created['id']}/projection", params={"currency": "RUPEE"}
    ).status_code == 422
    assert client.get(
        f"{V1}/cost-scenarios/{created['id']}/projection", params={"horizon_months": 0}
    ).status_code == 422


def test_compare_over_http_is_the_same_two_curves(client: TestClient, today: dt.date) -> None:
    def build(name: str, rent: str) -> str:
        row = client.post(
            f"{V1}/cost-scenarios",
            json={"name": name, "start_month": "2026-12-01", "horizon_months": 2, "currency": "INR"},
        ).json()
        client.post(
            f"{V1}/cost-scenarios/{row['id']}/items",
            json={"label": "Rent", "amount": float(rent), "currency": "INR", "recurrence": "monthly"},
        )
        return row["id"]

    a, b = build("Lean", "10000"), build("Wide", "30000")
    built = client.get(
        f"{V1}/cost-scenarios/compare", params={"a": a, "b": b, "today": today.isoformat()}
    ).json()
    assert [month["delta"] for month in built["months"]] == [20000.0, 20000.0]
    assert built["currency"] == "INR"
    assert client.get(f"{V1}/cost-scenarios/compare", params={"a": a}).status_code == 422


def test_activating_and_duplicating_over_http(client: TestClient) -> None:
    first = client.post(
        f"{V1}/cost-scenarios",
        json={"name": "First", "start_month": "2026-12-01", "horizon_months": 3, "status": "active"},
    ).json()
    second = client.post(
        f"{V1}/cost-scenarios",
        json={"name": "Second", "start_month": "2026-12-01", "horizon_months": 3},
    ).json()
    activated = client.post(f"{V1}/cost-scenarios/{second['id']}/activate").json()
    assert activated["archived"] == {"id": first["id"], "name": "First"}
    copied = client.post(f"{V1}/cost-scenarios/{second['id']}/duplicate").json()
    assert copied["copied_items"] == 0 and copied["scenario"]["status"] == "draft"


def test_a_scenario_is_scoped_to_its_workspace(session: Session, workspace_id: str) -> None:
    from tests.helpers import other_workspace

    elsewhere = other_workspace(session)
    row = plan(session, workspace_id, "Mine")
    line(session, workspace_id, row["id"], "Rent", "100", recurrence="monthly")
    session.flush()
    assert scenarios.list_scenarios(session, elsewhere)[1] == 0
    other = plan(session, elsewhere, "Theirs")
    with pytest.raises(ApiError) as caught:
        scenarios.activate(session, elsewhere, row["id"])
    assert caught.value.status_code == 409  # it exists, and it is not yours (§4)
    assert scenarios.get_scenario(session, elsewhere, other["id"])["item_count"] == 0


def test_the_curve_does_not_double_count_a_plan_and_a_payment(
    session: Session, workspace_id: str
) -> None:
    """§3: the curve is a plan of lines; the ledger is what was paid. Neither reads the other."""
    row = plan(session, workspace_id, horizon_months=2)
    line(session, workspace_id, row["id"], "Rent", "20000", recurrence="monthly")
    session.add(
        Expense(
            workspace_id=workspace_id,
            label="Rent paid",
            amount=Decimal("20000"),
            currency="INR",
            paid_on=DAY,
            recurring=False,
            recurrence="none",
        )
    )
    session.flush()
    assert curve(session, workspace_id, row["id"])["months"][0]["cost"] == Decimal("20000.00")
    assert money.monthly_burn(session, workspace_id, today=DAY) == ("INR", Decimal("20000.00"))
