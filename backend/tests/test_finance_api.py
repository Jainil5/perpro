"""The Phase 3 HTTP surface (PHASE3_FINANCE.md §4): what the browser is allowed to assume.

:mod:`tests.test_money` and :mod:`tests.test_scenarios` pin the maths at the function level.
This file pins the *contract the screens read*: the route list, the list envelopes, the
``?dir=`` addendum, both ``month=`` shapes, the two CSV exports, the derived blocks, the
bulk and lifecycle actions, the §6 notification rules and the §7 deep links.  Everything
here asks the API a question the way ``components/os/finance.tsx`` does, and every derived
read passes ``?today=`` so the answer does not depend on the day the suite runs.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
from typing import Any

import pytest
from fastapi.testclient import TestClient

V1 = "/api/v1"
TODAY = dt.date(2026, 11, 21)
T = TODAY.isoformat()


def post(client: TestClient, path: str, body: dict[str, Any], **params: Any) -> dict[str, Any]:
    """POST with the injected day on every call: derived fields need it, plain ones ignore it."""
    query = {"today": T, **params}
    response = client.post(f"{V1}{path}", json=body, params=query)
    assert response.status_code in (200, 201), f"{path} -> {response.status_code} {response.text}"
    return response.json()


@pytest.fixture
def book(client: TestClient) -> dict[str, Any]:
    """A small mixed-currency book: a service with a plan, a subscription, expenses, income.

    Built through the API, because "nothing is a mockup" applies to the tests too.
    """
    service = post(client, "/services", {"name": "Consulting", "unit": "hour", "default_price": 4000,
                                        "currency": "INR"})
    plan = post(client, "/service-plans", {"service_id": service["id"], "name": "Retainer",
                                           "interval": "quarterly", "price": 300000,
                                           "currency": "INR", "included_units": 300})
    subscription = post(client, "/subscriptions", {"price": 45, "currency": "USD", "interval": "monthly",
                                                   "status": "active", "started_on": "2026-01-15",
                                                   "renews_on": "2026-12-15"})
    category = post(client, "/expense-categories", {"name": "Software", "kind": "variable"})
    rent = post(client, "/expenses", {"label": "Adobe", "amount": 99, "currency": "USD",
                                      "paid_on": T, "vendor": "Adobe", "category_id": category["id"],
                                      "recurring": True, "recurrence": "monthly"})
    utilities = post(client, "/expenses", {"label": "Power bill", "amount": 4200, "currency": "INR",
                                           "paid_on": "2026-11-05", "vendor": "BESCOM"})
    invoice = post(client, "/income", {"label": "Invoice 7", "amount": 120000, "currency": "INR",
                                       "received_on": T, "status": "invoiced", "method": "bank",
                                       "service_id": service["id"], "invoice_number": "INV-7"})
    fee = post(client, "/income", {"label": "Retainer paid", "amount": 2500, "currency": "USD",
                                   "received_on": "2026-11-10", "status": "paid", "method": "wire"
                                   if False else "card"})
    post(client, "/exchange-rates", {"base": "USD", "quote": "INR", "rate": 83.5, "as_of": "2026-11-01"})
    return {
        "service": service,
        "plan": plan,
        "subscription": subscription,
        "category": category,
        "rent": rent,
        "utilities": utilities,
        "invoice": invoice,
        "fee": fee,
    }


# ------------------------------------------------------------- the surface itself (§4)


FINANCE_ROUTES: list[tuple[str, str]] = [
    ("GET", "/finance/summary"),
    ("GET", "/income-profiles"),
    ("POST", "/income-profiles"),
    ("GET", "/income-profiles/{profile_id}"),
    ("PATCH", "/income-profiles/{profile_id}"),
    ("DELETE", "/income-profiles/{profile_id}"),
    ("POST", "/income-profiles/preview"),
    ("GET", "/currencies"),
    ("GET", "/exchange-rates"),
    ("POST", "/exchange-rates"),
    ("PATCH", "/exchange-rates/{rate_id}"),
    ("DELETE", "/exchange-rates/{rate_id}"),
    ("POST", "/exchange-rates/sync"),
    ("GET", "/convert"),
    ("GET", "/services"),
    ("POST", "/services"),
    ("GET", "/services/{service_id}"),
    ("PATCH", "/services/{service_id}"),
    ("DELETE", "/services/{service_id}"),
    ("GET", "/service-plans"),
    ("POST", "/service-plans"),
    ("GET", "/service-plans/{plan_id}"),
    ("PATCH", "/service-plans/{plan_id}"),
    ("DELETE", "/service-plans/{plan_id}"),
    ("GET", "/subscriptions"),
    ("POST", "/subscriptions"),
    ("GET", "/subscriptions/{subscription_id}"),
    ("PATCH", "/subscriptions/{subscription_id}"),
    ("DELETE", "/subscriptions/{subscription_id}"),
    ("POST", "/subscriptions/{subscription_id}/pause"),
    ("POST", "/subscriptions/{subscription_id}/resume"),
    ("POST", "/subscriptions/{subscription_id}/cancel"),
    ("GET", "/expense-categories"),
    ("POST", "/expense-categories"),
    ("PATCH", "/expense-categories/{category_id}"),
    ("DELETE", "/expense-categories/{category_id}"),
    ("GET", "/expenses"),
    ("POST", "/expenses"),
    ("GET", "/expenses/{expense_id}"),
    ("PATCH", "/expenses/{expense_id}"),
    ("DELETE", "/expenses/{expense_id}"),
    ("POST", "/expenses/bulk"),
    ("GET", "/expenses/export.csv"),
    ("GET", "/expenses/summary"),
    ("GET", "/income"),
    ("POST", "/income"),
    ("GET", "/income/{income_id}"),
    ("PATCH", "/income/{income_id}"),
    ("DELETE", "/income/{income_id}"),
    ("POST", "/income/{income_id}/mark-paid"),
    ("GET", "/income/export.csv"),
    ("GET", "/income/summary"),
    ("GET", "/cost-scenarios"),
    ("POST", "/cost-scenarios"),
    ("GET", "/cost-scenarios/compare"),
    ("GET", "/cost-scenarios/{scenario_id}"),
    ("PATCH", "/cost-scenarios/{scenario_id}"),
    ("DELETE", "/cost-scenarios/{scenario_id}"),
    ("POST", "/cost-scenarios/{scenario_id}/duplicate"),
    ("POST", "/cost-scenarios/{scenario_id}/activate"),
    ("GET", "/cost-scenarios/{scenario_id}/projection"),
    ("GET", "/cost-scenarios/{scenario_id}/items"),
    ("POST", "/cost-scenarios/{scenario_id}/items"),
    ("PATCH", "/cost-scenario-items/{item_id}"),
    ("DELETE", "/cost-scenario-items/{item_id}"),
]


def test_every_documented_finance_route_exists(client: TestClient) -> None:
    surface = {
        (method.upper(), path)
        for path, operations in client.get("/openapi.json").json()["paths"].items()
        for method in operations
    }
    missing = [
        (method, f"{V1}{path}") for method, path in FINANCE_ROUTES if (method, f"{V1}{path}") not in surface
    ]
    assert missing == []


@pytest.mark.parametrize(
    "path,keys",
    [
        ("/expenses", {"items", "total", "limit", "offset"}),
        ("/income", {"items", "total", "limit", "offset"}),
        ("/subscriptions", {"items", "total", "limit", "offset"}),
        ("/services", {"items", "total", "limit", "offset"}),
        ("/service-plans", {"items", "total", "limit", "offset"}),
        ("/exchange-rates", {"items", "total", "limit", "offset"}),
        ("/expense-categories", {"items", "total"}),
        ("/income-profiles", {"items", "total"}),
        ("/cost-scenarios", {"items", "total"}),
        ("/currencies", {"items", "total"}),
    ],
)
def test_a_list_endpoint_is_an_envelope(client: TestClient, book: dict, path: str, keys: set[str]) -> None:
    if path == "/income-profiles":
        post(client, "/income-profiles", {"name": "Founder", "currency": "INR"})
    elif path == "/cost-scenarios":
        post(client, "/cost-scenarios", {"name": "Plan", "start_month": "2026-12-01",
                                         "horizon_months": 6, "currency": "INR"})
    body = client.get(f"{V1}{path}", params={"today": T}).json()
    assert set(body) == keys
    assert body["total"] >= 1
    assert len(body["items"]) <= body["total"]


def test_the_paging_echo_survives_a_page(client: TestClient, book: dict) -> None:
    post(client, "/expenses", {"label": "Late fee", "amount": 50, "currency": "INR", "paid_on": "2026-11-02"})
    first = client.get(f"{V1}/expenses", params={"today": T, "limit": 2, "offset": 0}).json()
    second = client.get(f"{V1}/expenses", params={"today": T, "limit": 2, "offset": 2}).json()
    assert (first["limit"], first["offset"], second["offset"]) == (2, 0, 2)
    assert first["total"] == second["total"] == 3
    assert {row["id"] for row in first["items"]} | {row["id"] for row in second["items"]} != set()
    assert len(second["items"]) == 1


# ------------------------------------------------------------------- the dir= addendum


#: a second, distinguishable row per family: a flip of a one-row list proves nothing
SECOND_ROW: dict[str, dict[str, Any]] = {
    "/expenses": {"label": "Spare", "amount": 777, "currency": "INR", "paid_on": T},
    "/income": {"label": "Second fee", "amount": 333, "currency": "INR", "received_on": T, "status": "paid"},
    "/subscriptions": {"price": 900, "currency": "INR", "interval": "yearly", "status": "active",
                       "started_on": "2026-01-15"},
    "/services": {"name": "Workshops", "unit": "day", "default_price": 9000, "currency": "INR"},
    "/exchange-rates": {"base": "EUR", "quote": "INR", "rate": 90, "as_of": "2026-10-01"},
}


@pytest.mark.parametrize(
    "path,sort,field",
    [
        ("/expenses", "amount", "amount"),
        ("/income", "amount", "amount"),
        ("/subscriptions", "price", "price"),
        ("/exchange-rates", "as_of", "as_of"),
        # §4 names the services key `price` while the payload calls the column
        # `default_price`, so the two are pinned separately.
        ("/services", "price", "default_price"),
    ],
)
def test_dir_flips_only_the_sort_key(
    client: TestClient, book: dict, path: str, sort: str, field: str
) -> None:
    post(client, path, SECOND_ROW[path])
    down = client.get(f"{V1}{path}", params={"today": T, "sort": sort, "dir": "desc"}).json()["items"]
    up = client.get(f"{V1}{path}", params={"today": T, "sort": sort, "dir": "asc"}).json()["items"]
    assert len(down) == len(up) > 1
    assert [row[field] for row in down] == sorted({row[field] for row in down}, reverse=True)
    assert [row["id"] for row in down] == list(reversed([row["id"] for row in up]))
    assert client.get(f"{V1}{path}", params={"today": T, "sort": sort}).json()["items"] == down
    assert client.get(f"{V1}{path}", params={"today": T, "sort": sort, "dir": ""}).json()["items"] == down


@pytest.mark.parametrize(
    "path",
    [
        "/expenses", "/income", "/subscriptions", "/services", "/exchange-rates",
        "/service-plans", "/income-profiles", "/cost-scenarios",
    ],
)
def test_a_bad_direction_is_a_422_on_the_query(client: TestClient, book: dict, path: str) -> None:
    """Every family that takes ``sort=`` takes ``dir=`` the same way (§4 addendum)."""
    response = client.get(f"{V1}{path}", params={"today": T, "dir": "sideways"})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["details"][0]["loc"] == ["query", "dir"]
    assert error["message"] == "dir must be one of: asc, desc"
    assert error["details"][0]["msg"] == "'sideways' is not a valid dir"
    assert error["details"][0]["field"] == "query.dir"


def test_dir_does_not_move_the_secondary_order(client: TestClient) -> None:
    """``id`` stays the final tiebreaker *ascending*, so a flip cannot reshuffle equal keys."""
    ids = [
        post(client, "/expenses", {"label": label, "amount": 10, "currency": "INR", "paid_on": T})["id"]
        for label in ("Same", "Same ", "same")
    ]
    for direction in ("asc", "desc", ""):
        rows = client.get(
            f"{V1}/expenses", params={"today": T, "sort": "amount", "dir": direction}
        ).json()["items"]
        assert [row["id"] for row in rows] == sorted(ids)


# --------------------------------------------------------------------- the summaries


@pytest.mark.parametrize("path", ["/expenses/summary", "/income/summary"])
def test_a_month_is_accepted_whole_or_first_of(client: TestClient, book: dict, path: str) -> None:
    short = client.get(f"{V1}{path}", params={"month": "2026-11", "today": T}).json()
    long = client.get(f"{V1}{path}", params={"month": "2026-11-01", "today": T}).json()
    assert short == long  # both echo the YYYY-MM form, neither echoes the caller's string
    assert short["month"] == "2026-11"


def test_the_category_tree_takes_both_month_shapes(client: TestClient, book: dict) -> None:
    """The third month-bearing read rolls up a window too, and answers identically."""
    short = client.get(f"{V1}/expense-categories", params={"month": "2026-11", "today": T}).json()
    long = client.get(f"{V1}/expense-categories", params={"month": "2026-11-01", "today": T}).json()
    assert short == long
    # a tree is a list, so it carries no month label of its own; the roll-up window is
    # visible in the numbers, which is what FINDING 1's screen reads
    assert "month" not in short


@pytest.mark.parametrize("path", ["/expenses/summary", "/income/summary", "/expense-categories"])
def test_a_month_that_is_not_a_month_is_refused(client: TestClient, path: str) -> None:
    response = client.get(f"{V1}{path}", params={"month": "November 2026", "today": T})
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["loc"] == ["query", "month"]


def test_the_expense_summary_is_the_month_it_was_asked_for(client: TestClient, book: dict) -> None:
    """§2.3 over HTTP: ask for no target and the mixed month totals nothing; name one and it does.

    This is FINDING 1's rule - a null envelope must never travel with bare numbers, and a
    recurring USD row must not drop out of a converted total.
    """
    body = client.get(f"{V1}/expenses/summary", params={"month": "2026-11", "today": T}).json()
    assert set(body) == {
        "month",
        "currency",
        "total",
        "count",
        "recurring_monthly",
        "by_category",
        "by_vendor",
        "by_currency",
        "series",
        "top_expenses",
    }
    assert [row["month"] for row in body["series"]] == [
        "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05",
        "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11",
    ]
    assert body["count"] == 2
    assert body["by_currency"] == [{"currency": "INR", "amount": 4200.0}, {"currency": "USD", "amount": 99.0}]
    assert {row["name"] for row in body["by_category"]} == {"Software", "Uncategorised"}
    assert {row["vendor"] for row in body["by_vendor"]} == {"Adobe", "BESCOM"}
    assert [row["label"] for row in body["top_expenses"]] == ["Power bill", "Adobe"]  # by amount, per code
    unnamed = body
    assert (unnamed["currency"], unnamed["total"], unnamed["recurring_monthly"]) == (None, None, None)
    assert all(row["amount"] is None for row in unnamed["by_category"])
    assert all(row["amount"] is None for row in unnamed["by_vendor"])
    assert all(row["total"] is None for row in unnamed["series"])

    named = client.get(
        f"{V1}/expenses/summary", params={"month": "2026-11", "today": T, "currency": "INR"}
    ).json()
    assert named["currency"] == "INR"
    assert named["month"] == "2026-11"
    # 4200 paid this month + Adobe's 99 USD at 83.50, and the same rule for the run rate
    assert named["total"] == pytest.approx(4200.0 + 99 * 83.5)
    assert named["recurring_monthly"] == pytest.approx(99 * 83.5)
    software = next(row for row in named["by_category"] if row["name"] == "Software")
    assert software == {
        "category_id": book["category"]["id"],
        "name": "Software",
        "color": None,
        "amount": pytest.approx(99 * 83.5),
        "count": 1,
    }
    assert named["top_expenses"][0]["label"] == "Power bill"
    assert named["top_expenses"][0]["amount"] == pytest.approx(4200.0)
    assert named["top_expenses"][0]["currency"] == "INR"  # the row keeps its own code, converted or not


def test_the_expense_summary_of_an_empty_month(client: TestClient, book: dict) -> None:
    """No rows means no currency to name, so the totals are null - until the reader names one."""
    unnamed = client.get(f"{V1}/expenses/summary", params={"month": "2026-08", "today": T}).json()
    assert (unnamed["total"], unnamed["count"], unnamed["recurring_monthly"]) == (None, 0, None)
    assert unnamed["by_category"] == [] and unnamed["top_expenses"] == []
    assert unnamed["by_currency"] == []

    named = client.get(
        f"{V1}/expenses/summary", params={"month": "2026-08", "today": T, "currency": "INR"}
    ).json()
    assert (named["total"], named["count"]) == (0.0, 0)
    assert [row["total"] for row in named["series"]] == [0.0] * 12
    # the run rate is a rate, not a month's total: August spent nothing and still renews
    assert named["recurring_monthly"] == pytest.approx(99 * 83.5)


def test_the_income_summary_of_an_empty_month(client: TestClient, book: dict) -> None:
    named = client.get(
        f"{V1}/income/summary", params={"month": "2026-08", "today": T, "currency": "INR"}
    ).json()
    assert (named["invoiced"], named["received"], named["receivables"], named["count"]) == (0.0, 0.0, 0.0, 0)
    assert named["by_status"] == {} and named["by_service"] == [] and named["overdue"] == []


def test_the_income_summary_is_invoiced_received_and_receivable(client: TestClient, book: dict) -> None:
    body = client.get(f"{V1}/income/summary", params={"month": "2026-11", "today": T}).json()
    assert set(body) == {
        "month", "currency", "invoiced", "received", "receivables",
        "overdue", "by_status", "by_service", "series", "by_currency", "count",
    }
    assert body["count"] == 2
    assert body["by_currency"] == [{"currency": "INR", "amount": 120000.0}, {"currency": "USD", "amount": 2500.0}]
    assert body["by_status"] == {"invoiced": None, "paid": None}  # unnamed: nothing to add up (§2.3)
    assert (body["currency"], body["invoiced"], body["received"], body["receivables"]) == (None,) + (None,) * 3
    assert [row["month"] for row in body["series"]] == [
        "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"
    ]

    named = client.get(
        f"{V1}/income/summary", params={"month": "2026-11", "today": T, "currency": "INR"}
    ).json()
    assert named["currency"] == "INR"
    assert named["invoiced"] == pytest.approx(120000.0)
    assert named["received"] == pytest.approx(2500 * 83.5)
    assert named["receivables"] == pytest.approx(120000.0)
    assert named["by_status"] == {"invoiced": pytest.approx(120000.0), "paid": pytest.approx(2500 * 83.5)}
    assert named["by_service"] == [
        {"service_id": None, "name": "Unlinked", "amount": pytest.approx(2500 * 83.5), "count": 1},
        {"service_id": book["service"]["id"], "name": "Consulting", "amount": pytest.approx(120000.0), "count": 1},
    ]
    assert (named["series"][-1]["month"], named["series"][-1]["invoiced"]) == ("2026-11", pytest.approx(120000.0))
    assert named["series"][-1]["received"] == pytest.approx(2500 * 83.5)


def test_the_overview_names_no_currency_and_prints_no_bare_figures(client: TestClient, book: dict) -> None:
    """§2.3 rule 3, over HTTP: an unnamed response cannot carry a cross-currency total."""
    body = client.get(f"{V1}/finance/summary", params={"today": T}).json()
    assert set(body) == {
        "currency", "month", "income", "expense", "net", "monthly_income_avg_3m", "monthly_burn",
        "runway_months", "mrr", "arr", "receivables", "overdue_income", "cash_in_90d",
        "income_by_month", "expense_by_category", "top_vendors", "renewing_this_month",
        "by_currency", "stale_rates", "counts",
    }
    assert body["month"] == "2026-11"
    assert body["currency"] is None
    for field in ("income", "expense", "net", "monthly_income_avg_3m", "monthly_burn", "mrr", "arr",
                  "receivables", "overdue_income", "cash_in_90d", "runway_months"):
        assert body[field] is None, field
    assert all(row["net"] is None for row in body["income_by_month"])
    assert all(row["amount"] is None for row in body["expense_by_category"])
    assert all(row["share"] is None for row in body["expense_by_category"])
    assert all(row["amount"] is None for row in body["top_vendors"])
    # the per-code split is the one thing an unnamed envelope may still print
    assert body["by_currency"] == [
        {"currency": "INR", "income": 0.0, "expense": 4200.0},
        {"currency": "USD", "income": 2500.0, "expense": 99.0},
    ]
    assert body["counts"] == {"expenses": 2, "income": 2, "subscriptions": 1, "services": 1, "scenarios": 0}
    assert body["renewing_this_month"] == []  # the only renewal falls in December, not this month


def test_the_overview_converts_everything_when_the_reader_names_a_currency(client: TestClient, book: dict) -> None:
    """§2.6's lever: the same request plus ``currency=INR`` re-derives every headline figure."""
    body = client.get(f"{V1}/finance/summary", params={"today": T, "currency": "INR"}).json()
    assert body["currency"] == "INR"
    assert body["income"] == pytest.approx(2500 * 83.5)  # only the paid row counts as income
    assert body["expense"] == pytest.approx(4200.0 + 99 * 83.5)
    assert body["net"] == pytest.approx(body["income"] - body["expense"])
    assert body["mrr"] == pytest.approx(45 * 83.5)
    assert body["arr"] == pytest.approx(body["mrr"] * 12)
    assert body["receivables"] == pytest.approx(120000.0)
    assert body["overdue_income"] == 0.0
    # the run rate is the recurring rule plus this month's one-offs - FINDING 1: the USD rule
    # is converted in, never dropped
    assert body["monthly_burn"] == pytest.approx(99 * 83.5 + 4200.0)
    assert body["cash_in_90d"] == pytest.approx(body["income"] - body["expense"])
    assert body["runway_months"] == pytest.approx(body["cash_in_90d"] / body["monthly_burn"], abs=0.02)
    assert body["monthly_income_avg_3m"] == pytest.approx(2500 * 83.5 / 3)
    software = next(row for row in body["expense_by_category"] if row["name"] == "Software")
    assert software["amount"] == pytest.approx(99 * 83.5)
    assert {row["vendor"] for row in body["top_vendors"]} == {"Adobe", "BESCOM"}
    assert body["income_by_month"][-1] == {
        "month": "2026-11",
        "income": pytest.approx(2500 * 83.5),
        "expense": pytest.approx(4200.0 + 99 * 83.5),
        "net": pytest.approx(2500 * 83.5 - 4200.0 - 99 * 83.5),
    }


def test_renewing_this_month_is_the_calendar_month(client: TestClient, book: dict) -> None:
    """§4's ``renewing_this_month`` block, with the row's own code kept beside the amount."""
    november = post(client, "/subscriptions", {"price": 20, "currency": "INR", "interval": "monthly",
                                               "status": "active", "started_on": "2026-01-15",
                                               "renews_on": "2026-11-25"})
    body = client.get(f"{V1}/finance/summary", params={"today": T}).json()
    assert body["renewing_this_month"] == [
        {
            "id": november["id"],
            "label": "20.00 INR/monthly",  # §4: a subscription's label is derived, never stored
            "amount": 20.0,
            "currency": "INR",
            "renews_on": "2026-11-25",
            "days_until": 4,
        }
    ]
    # naming a target changes which rows qualify not at all - the window is a date rule
    named = client.get(f"{V1}/finance/summary", params={"today": T, "currency": "INR"}).json()
    assert [row["id"] for row in named["renewing_this_month"]] == [november["id"]]


def test_the_overview_runway_is_null_when_nothing_is_burning(client: TestClient) -> None:
    post(client, "/income", {"label": "Donation", "amount": 5000, "currency": "INR",
                             "received_on": T, "status": "paid", "method": "cash"})
    body = client.get(f"{V1}/finance/summary", params={"today": T}).json()
    assert body["monthly_burn"] == 0.0
    assert body["runway_months"] is None
    assert body["cash_in_90d"] == pytest.approx(5000.0)


def test_an_unsupported_currency_is_refused_wherever_it_is_asked_for(client: TestClient, book: dict) -> None:
    for path in ("/finance/summary", "/expenses/summary", "/income/summary"):
        response = client.get(f"{V1}{path}", params={"currency": "RUPEE", "today": T})
        assert response.status_code == 422, path
        assert response.json()["error"]["details"][0]["loc"] == ["query", "currency"], path


# -------------------------------------------------------------------------- expenses


def test_an_expense_carries_the_derived_recurrence_block(client: TestClient, book: dict) -> None:
    row = client.get(f"{V1}/expenses/{book['rent']['id']}", params={"today": T}).json()
    assert row["monthly_amount"] == pytest.approx(99.0)  # its own code, never blended (§2.3)
    assert row["recurrence"] == "monthly" and row["recurring"] is True
    # a monthly row paid today is due today; the next one is a month later
    assert (row["next_due_on"], row["days_until_due"]) == (T, 0)
    later = client.get(f"{V1}/expenses/{book['rent']['id']}", params={"today": "2026-11-22"}).json()
    assert (later["next_due_on"], later["days_until_due"]) == ("2026-12-21", 29)
    assert row["category"] == {"id": book["category"]["id"], "name": "Software", "color": None}
    assert row["currency"] == "USD" and row["amount"] == pytest.approx(99.0)


def test_the_monthly_amount_normalises_the_cadence_in_the_row_s_own_currency(
    client: TestClient, book: dict
) -> None:
    """§3 over HTTP: the run rate the screens read is this row's figure normalised to a month."""
    for amount, recurrence, monthly in (
        (700, "weekly", 3033.33),  # 700 x 52 / 12 = 3033.333..., one ROUND_HALF_UP step at the end
        (3000, "quarterly", 1000.0),
        (12000, "yearly", 1000.0),
        (5000, "monthly", 5000.0),
        (4200, "none", None),  # §3: a one-off has no monthly figure, and 0.00 would read as a rule
    ):
        row = post(client, "/expenses", {"label": f"Rule {recurrence}", "amount": amount,
                                         "currency": "INR", "paid_on": T,
                                         "recurring": recurrence != "none", "recurrence": recurrence})
        got = client.get(f"{V1}/expenses/{row['id']}", params={"today": T}).json()
        assert got["monthly_amount"] == monthly, recurrence
        assert (got["next_due_on"] is None) == (recurrence == "none"), recurrence


def test_a_recurring_flag_and_a_cadence_have_to_agree(client: TestClient) -> None:
    response = client.post(
        f"{V1}/expenses",
        params={"today": T},
        json={"label": "Dish", "amount": 800, "currency": "INR", "paid_on": T, "recurring": True},
    )
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "recurrence"
    response = client.post(
        f"{V1}/expenses",
        params={"today": T},
        json={"label": "Dish", "amount": 800, "currency": "INR", "paid_on": T, "recurrence": "yearly"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "recurring"


@pytest.mark.parametrize(
    "body,field",
    [
        ({"label": "x", "amount": -1, "currency": "INR", "paid_on": T}, "amount"),
        ({"label": "x", "amount": 1, "currency": "INR"}, "paid_on"),
        ({"label": "x", "amount": 1, "paid_on": T}, "currency"),
        ({"label": "x", "amount": 1, "currency": "ZZZ", "paid_on": T}, "currency"),
        ({"label": "x", "amount": 1, "currency": "INR", "paid_on": T, "category_id": "nope"}, "category_id"),
        ({"label": "x", "amount": 1, "currency": "INR", "paid_on": T, "recurrence": "fortnightly"}, "recurrence"),
    ],
)
def test_a_bad_expense_is_refused_naming_the_field(client: TestClient, body: dict, field: str) -> None:
    response = client.post(f"{V1}/expenses", params={"today": T}, json=body)
    assert response.status_code == 422, response.text
    assert response.json()["error"]["details"][0]["field"] == field


def test_the_expense_filters_are_the_ones_the_screen_sends(client: TestClient, book: dict) -> None:
    ids = lambda rows: {row["id"] for row in rows}  # noqa: E731 - one line, three uses
    rows = client.get(f"{V1}/expenses", params={"today": T, "category_id": book["category"]["id"]}).json()
    assert ids(rows["items"]) == {book["rent"]["id"]}
    assert ids(client.get(f"{V1}/expenses", params={"today": T, "vendor": "BESCOM"}).json()["items"]) == {
        book["utilities"]["id"]
    }
    assert ids(client.get(f"{V1}/expenses", params={"today": T, "currency": "USD"}).json()["items"]) == {
        book["rent"]["id"]
    }
    assert ids(client.get(f"{V1}/expenses", params={"today": T, "recurring": "true"}).json()["items"]) == {
        book["rent"]["id"]
    }
    assert ids(
        client.get(f"{V1}/expenses", params={"today": T, "from": "2026-11-06", "to": "2026-11-30"}).json()["items"]
    ) == {book["rent"]["id"]}
    assert ids(client.get(f"{V1}/expenses", params={"today": T, "q": "power"}).json()["items"]) == {
        book["utilities"]["id"]
    }
    assert ids(
        client.get(f"{V1}/expenses", params={"today": T, "recurrence": "monthly"}).json()["items"]
    ) == {book["rent"]["id"]}


def test_bulk_actions_report_per_id_failures(client: TestClient, book: dict) -> None:
    spare = post(client, "/expenses", {"label": "Spare", "amount": 10, "currency": "INR", "paid_on": T})
    moved = client.post(
        f"{V1}/expenses/bulk",
        json={"ids": [book["utilities"]["id"], spare["id"], "nope"], "action": "set_category",
              "value": book["category"]["id"]},
    ).json()
    assert moved["action"] == "set_category"
    assert moved["updated"] == 2
    assert moved["failed"] == [{"id": "nope", "error": "expense not found"}]
    row = client.get(f"{V1}/expenses/{book['utilities']['id']}").json()
    assert row["category_id"] == book["category"]["id"]

    flagged = client.post(
        f"{V1}/expenses/bulk",
        json={"ids": [spare["id"]], "action": "set_recurring", "value": {"recurring": True, "recurrence": "weekly"}},
    ).json()
    assert flagged["updated"] == 1
    assert client.get(f"{V1}/expenses/{spare['id']}").json()["recurrence"] == "weekly"

    deleted = client.post(
        f"{V1}/expenses/bulk", json={"ids": [spare["id"], "gone"], "action": "delete"}
    ).json()
    assert (deleted["updated"], deleted["failed"]) == (1, [{"id": "gone", "error": "expense not found"}])
    assert client.get(f"{V1}/expenses/{spare['id']}").status_code == 404


def test_an_unknown_bulk_action_is_a_422(client: TestClient, book: dict) -> None:
    response = client.post(f"{V1}/expenses/bulk", json={"ids": [book["rent"]["id"]], "action": "launch"})
    assert response.status_code == 422


# --------------------------------------------------------------------- category tree


def test_the_category_tree_rolls_children_up_into_the_parent(client: TestClient, book: dict) -> None:
    child = post(client, "/expense-categories", {"name": "Design tools", "parent_id": book["category"]["id"],
                                                 "kind": "variable"})
    post(client, "/expenses", {"label": "Figma seats", "amount": 4500, "currency": "INR",
                               "paid_on": "2026-11-09", "category_id": child["id"]})
    tree = client.get(f"{V1}/expense-categories", params={"today": T, "month": "2026-11"}).json()
    parent = next(row for row in tree["items"] if row["id"] == book["category"]["id"])
    assert tree["total"] == 2  # both nodes are counted, only the roots are listed
    assert [row["name"] for row in tree["items"]] == ["Software"]
    assert parent["depth"] == 0 and parent["expense_count"] == 2  # its own row plus the child's
    assert [row["name"] for row in parent["children"]] == ["Design tools"]
    assert parent["children"][0]["depth"] == 1
    assert parent["children"][0]["amount_this_month"] == pytest.approx(4500.0)
    assert parent["children"][0]["currency"] == "INR"
    assert parent["children"][0]["monthly_norm"] == 0.0  # a one-off child adds no run rate (§3)
    # the parent now spans USD (Adobe) and INR (Figma), so unnamed it rolls up to nothing (§2.3)
    assert (parent["amount_this_month"], parent["currency"], parent["monthly_norm"]) == (None, None, None)

    named = client.get(
        f"{V1}/expense-categories", params={"today": T, "month": "2026-11", "currency": "INR"}
    ).json()
    rolled = next(row for row in named["items"] if row["id"] == book["category"]["id"])
    assert rolled["amount_this_month"] == pytest.approx(4500.0 + 99 * 83.5)
    assert rolled["monthly_norm"] == pytest.approx(99 * 83.5)  # the run rate is only the recurring row
    assert rolled["currency"] == "INR"
    assert rolled["children"][0]["amount_this_month"] == pytest.approx(4500.0)


def test_the_category_tree_follows_the_month_it_is_asked_for(client: TestClient, book: dict) -> None:
    post(client, "/expenses", {"label": "Old tool", "amount": 800, "currency": "INR",
                               "paid_on": "2026-09-04", "category_id": book["category"]["id"]})
    august = next(
        row
        for row in client.get(f"{V1}/expense-categories", params={"today": T, "month": "2026-08"}).json()["items"]
        if row["id"] == book["category"]["id"]
    )
    assert (august["amount_this_month"], august["expense_count"]) == (None, 0)
    september = next(
        row
        for row in client.get(f"{V1}/expense-categories", params={"today": T, "month": "2026-09"}).json()["items"]
        if row["id"] == book["category"]["id"]
    )
    assert september["amount_this_month"] == pytest.approx(800.0)
    assert september["currency"] == "INR"  # one code in one month is nameable without a rate


def test_the_tree_refuses_a_cycle_and_a_duplicate_name(client: TestClient, book: dict) -> None:
    child = post(client, "/expense-categories", {"name": "Sub", "parent_id": book["category"]["id"]})
    response = client.patch(
        f"{V1}/expense-categories/{book['category']['id']}", json={"parent_id": child["id"]}
    )
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "parent_id"
    self_parent = client.patch(f"{V1}/expense-categories/{child['id']}", json={"parent_id": child["id"]})
    assert self_parent.status_code == 422
    assert self_parent.json()["error"]["details"][0]["field"] == "parent_id"
    duplicate = client.post(f"{V1}/expense-categories", json={"name": "Software"})
    assert duplicate.status_code == 409  # unique per (workspace, parent), answered before the flush
    # a missing parent is a *body* reference, so it answers 422 like every other one (§4)
    for bad in ("00000000-0000-0000-0000-000000000000", "nope"):
        missing = client.post(f"{V1}/expense-categories", json={"name": "Loop", "parent_id": bad})
        assert missing.status_code == 422, bad
        assert missing.json()["error"]["details"][0]["field"] == "parent_id", bad


def test_the_preset_categories_are_idempotent_by_system_key(
    client: TestClient, session, workspace_id: str
) -> None:
    """§4's seven presets: seeding twice never doubles them, and the screen can still read them."""
    from app.services import expenses

    presets = {key for key, _name, _kind, _color in expenses.PRESET_CATEGORIES}
    assert expenses.ensure_presets(session, workspace_id) == 7
    session.commit()
    assert expenses.ensure_presets(session, workspace_id) == 0
    rows = client.get(f"{V1}/expense-categories").json()["items"]
    assert len(rows) == 7
    assert {row["system_key"] for row in rows} == presets
    assert next(row for row in rows if row["system_key"] == "software")["name"] == "Software"
    # a POST that repeats a preset name is the 409 the unique index implies, not a second row
    clash = client.post(f"{V1}/expense-categories", json={"name": "Rent", "system_key": "rent"})
    assert clash.status_code == 409


# --------------------------------------------------------------------------- income


def test_the_overdue_flags_come_from_the_status_and_the_injected_day(client: TestClient, book: dict) -> None:
    """`overdue` is a state the user sets (§5); how *late* it is comes from the day it is read."""
    late = post(client, "/income", {"label": "Invoice 8", "amount": 40000, "currency": "INR",
                                    "received_on": "2026-10-01", "status": "overdue"})
    today = client.get(f"{V1}/income/{late['id']}", params={"today": T}).json()
    assert (today["is_overdue"], today["days_overdue"]) == (True, 51)
    later = client.get(f"{V1}/income/{late['id']}", params={"today": "2027-01-10"}).json()
    assert (later["is_overdue"], later["days_overdue"]) == (True, 101)
    assert later["status"] == "overdue"  # reading it never rewrites it

    invoiced = client.get(f"{V1}/income/{book['invoice']['id']}", params={"today": "2027-01-10"}).json()
    assert (invoiced["is_overdue"], invoiced["days_overdue"]) == (False, 0)
    paid = client.get(f"{V1}/income/{book['fee']['id']}", params={"today": "2027-01-10"}).json()
    assert (paid["is_overdue"], paid["days_overdue"]) == (False, 0)


def test_the_converted_triple_is_all_or_nothing(client: TestClient, book: dict) -> None:
    response = client.post(
        f"{V1}/income",
        params={"today": T},
        json={"label": "Half a conversion", "amount": 100, "currency": "USD", "received_on": T,
              "converted_amount": 8350},
    )
    assert response.status_code == 422
    error = response.json()["error"]
    assert {detail["field"] for detail in error["details"]} == {"converted_at", "converted_currency"}
    assert error["message"] == "the converted_* triple is all-or-none"
    full = post(client, "/income", {"label": "Converted", "amount": 100, "currency": "USD",
                                    "received_on": T, "converted_amount": 8350,
                                    "converted_currency": "INR", "converted_at": T})
    assert (full["converted_amount"], full["converted_currency"], full["converted_at"]) == (
        8350.0, "INR", T
    )
    bare = client.get(f"{V1}/income/{book['fee']['id']}", params={"today": T}).json()
    assert (bare["converted_amount"], bare["converted_currency"], bare["converted_at"]) == (None, None, None)


def test_an_overdue_invoice_cannot_be_dated_in_the_future(client: TestClient, book: dict) -> None:
    response = client.post(
        f"{V1}/income",
        params={"today": T},
        json={"label": "Time travel", "amount": 100, "currency": "INR", "received_on": "2027-01-01",
              "status": "overdue"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "status"


def test_mark_paid_moves_an_expected_row_to_todays_date(client: TestClient, book: dict) -> None:
    row = post(client, "/income", {"label": "Awaiting", "amount": 15000, "currency": "INR",
                                   "received_on": "2026-12-01", "status": "expected", "method": "upi"})
    paid = client.post(f"{V1}/income/{row['id']}/mark-paid", params={"today": T}).json()
    assert paid["status"] == "paid"
    assert paid["received_on"] == T
    again = client.post(f"{V1}/income/{paid['id']}/mark-paid", params={"today": "2026-11-25"}).json()
    assert again["received_on"] == T  # a paid row keeps the day it was actually received


def test_the_income_ledger_filters(client: TestClient, book: dict) -> None:
    ids = lambda rows: {row["id"] for row in rows}  # noqa: E731
    assert ids(client.get(f"{V1}/income", params={"today": T, "status": "paid"}).json()["items"]) == {
        book["fee"]["id"]
    }
    assert ids(client.get(f"{V1}/income", params={"today": T, "service_id": book["service"]["id"]}).json()["items"]) == {
        book["invoice"]["id"]
    }
    assert ids(client.get(f"{V1}/income", params={"today": T, "currency": "USD"}).json()["items"]) == {
        book["fee"]["id"]
    }
    assert ids(
        client.get(f"{V1}/income", params={"today": T, "from": "2026-11-01", "to": "2026-11-15"}).json()["items"]
    ) == {book["fee"]["id"]}


# ------------------------------------------------------------------ the CSV exports


def _csv(text: str) -> tuple[list[dict[str, str]], list[str]]:
    """Split a generated file into its data rows and its ``#`` comment lines."""
    lines = [line for line in text.splitlines() if line.strip()]
    comments = [line for line in lines if line.startswith("#")]
    body = [line for line in lines if not line.startswith("#")]
    return list(csv.DictReader(io.StringIO("\n".join(body)))), comments


def test_the_expense_export_is_generated_per_request(client: TestClient, book: dict) -> None:
    response = client.get(f"{V1}/expenses/export.csv", params={"today": T, "from": "2026-11-01", "to": "2026-11-30"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert response.headers["content-disposition"] == 'attachment; filename="expenses.csv"'
    rows, comments = _csv(response.text)
    assert [row["label"] for row in rows] == ["Power bill", "Adobe"]
    assert {"paid_on", "monthly_amount", "recurring", "recurrence", "category", "vendor"} <= set(rows[0])
    assert rows[1]["monthly_amount"] == "99.00" and rows[0]["monthly_amount"] == ""  # one-offs have no rate
    # one currency per comment line: the file never blends or converts (§2.3)
    assert comments == [
        "# expenses 2026-11-01..2026-11-30",
        "# rows,2",
        "# total,INR,4200.00",
        "# total,USD,99.00",
    ]
    filtered = client.get(f"{V1}/expenses/export.csv", params={"today": T, "vendor": "BESCOM"}).text
    assert [row["label"] for row in _csv(filtered)[0]] == ["Power bill"]
    assert "# rows,1" in filtered and "# total,USD" not in filtered
    # nothing lands on disk: the same request twice returns the same bytes, no file in between
    again = client.get(f"{V1}/expenses/export.csv", params={"today": T, "from": "2026-11-01", "to": "2026-11-30"})
    assert again.text == response.text


def test_the_income_export_carries_the_ledger_columns(client: TestClient, book: dict) -> None:
    response = client.get(f"{V1}/income/export.csv", params={"today": T, "status": "paid"})
    assert response.status_code == 200
    assert response.headers["content-disposition"] == 'attachment; filename="income.csv"'
    rows, comments = _csv(response.text)
    assert [row["label"] for row in rows] == ["Retainer paid"]
    assert {"received_on", "amount", "currency", "status", "method", "invoice_number", "service",
            "converted_amount", "converted_currency", "converted_at"} <= set(rows[0])
    assert rows[0]["currency"] == "USD" and rows[0]["amount"] == "2500.00"
    assert comments == ["# income 2026-11-21", "# rows,1", "# total,USD,2500.00", "# received,USD,2500.00"]
    invoiced = client.get(f"{V1}/income/export.csv", params={"today": T}).text
    assert [row["status"] for row in _csv(invoiced)[0]] == ["paid", "invoiced"]
    assert "# total,USD,2500.00" in invoiced and "# total,INR,120000.00" in invoiced
    # `received` stays behind: an invoiced row is money not yet in (§3's cash rule)
    assert "# received,USD,2500.00" in invoiced and "# received,INR" not in invoiced


# ------------------------------------------------------------------- catalogue rules


def test_project_template_is_never_echoed(client: TestClient, book: dict) -> None:
    """The plan a service carries is a server-side default, not a payload field (§4)."""
    body = {"name": "Build", "unit": "day", "project_template": [{"title": "Kickoff"}]}
    created = post(client, "/services", body)
    assert "project_template" not in created
    row = client.get(f"{V1}/services/{created['id']}", params={"today": T}).json()
    assert "project_template" not in row
    patched = client.patch(f"{V1}/services/{created['id']}", json=body).json()
    assert "project_template" not in patched
    assert all("project_template" not in item for item in client.get(f"{V1}/services").json()["items"])


def test_a_service_detail_is_the_plans_plus_an_honest_revenue_block(client: TestClient, book: dict) -> None:
    detail = client.get(f"{V1}/services/{book['service']['id']}", params={"today": T}).json()
    assert [plan["id"] for plan in detail["plans"]] == [book["plan"]["id"]]
    assert detail["revenue"] == {"total": 0.0, "currency": "INR", "paid_count": 0, "invoiced_amount": 120000.0}
    assert detail["utilisation_hours"] is None


def test_a_service_whose_income_spans_codes_reports_no_total(client: TestClient, book: dict) -> None:
    post(client, "/income", {"label": "USD invoice", "amount": 500, "currency": "USD",
                             "received_on": "2026-11-12", "status": "paid", "service_id": book["service"]["id"]})
    detail = client.get(f"{V1}/services/{book['service']['id']}", params={"today": T}).json()
    revenue = detail["revenue"]
    assert (revenue["total"], revenue["currency"], revenue["invoiced_amount"]) == (None, None, None)
    assert revenue["paid_count"] == 1  # a count is not a currency, so it survives (§2.3)


def test_a_plan_prices_itself_per_month(client: TestClient, book: dict) -> None:
    plan = book["plan"]
    assert plan["monthly_price"] == pytest.approx(100000.0)  # 300000 quarterly ÷ 3
    assert plan["effective_rate"] == pytest.approx(1000.0)  # interval price ÷ 300 units
    assert plan["subscriber_count"] == 0
    weekly = post(client, "/service-plans", {"service_id": book["service"]["id"], "name": "Sprint",
                                             "interval": "one_time", "price": 90000, "currency": "INR"})
    assert weekly["monthly_price"] is None and weekly["effective_rate"] is None
    assert client.get(f"{V1}/service-plans", params={"service_id": book["service"]["id"]}).json()["total"] == 2


def test_deleting_a_service_drops_the_plans_and_clears_the_link(client: TestClient, book: dict) -> None:
    """§4: plans cascade, §13: the ledger row survives with its ``service_id`` set to null."""
    removed = client.delete(f"{V1}/services/{book['service']['id']}")
    assert removed.status_code == 204
    assert client.get(f"{V1}/service-plans").json()["items"] == []
    row = client.get(f"{V1}/income/{book['invoice']['id']}").json()
    assert (row["service_id"], row["service"], row["amount"]) == (None, None, 120000.0)
    assert client.get(f"{V1}/services/{book['service']['id']}").status_code == 404


# ----------------------------------------------------------------- subscriptions


def test_the_subscription_derived_block_follows_the_injected_day(client: TestClient, book: dict) -> None:
    row = client.get(f"{V1}/subscriptions/{book['subscription']['id']}", params={"today": T}).json()
    assert (row["monthly_cost"], row["annual_cost"]) == (45.0, 540.0)
    assert row["renews_in_days"] == 24 and row["is_running"] is True
    assert row["warnings"] == []
    quarterly = post(client, "/subscriptions", {"price": 300000, "currency": "INR", "interval": "quarterly",
                                                "status": "active", "started_on": "2026-01-15"})
    assert quarterly["monthly_cost"] == pytest.approx(100000.0)
    assert quarterly["annual_cost"] == pytest.approx(1200000.0)


def test_a_late_logged_renewal_is_allowed_and_flagged(client: TestClient, book: dict) -> None:
    row = post(client, "/subscriptions", {"price": 10, "currency": "INR", "interval": "monthly",
                                          "status": "active", "started_on": "2026-01-15",
                                          "renews_on": "2026-06-15"})
    assert row["status"] == "active"
    assert row["warnings"]
    assert row["is_running"] is True


def test_a_cancel_before_a_start_is_refused(client: TestClient, book: dict) -> None:
    response = client.post(
        f"{V1}/subscriptions",
        params={"today": T},
        json={"price": 10, "currency": "INR", "started_on": "2026-06-15", "cancelled_on": "2026-05-15"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "cancelled_on"


def test_pause_resume_and_cancel_recompute_the_block(client: TestClient, book: dict) -> None:
    sub_id = book["subscription"]["id"]
    paused = client.post(f"{V1}/subscriptions/{sub_id}/pause", params={"today": T}).json()
    assert paused["status"] == "paused" and paused["is_running"] is False  # §5: paused is not running
    assert paused["monthly_cost"] == pytest.approx(45.0)  # the cost it was quoted at is unchanged
    resumed = client.post(f"{V1}/subscriptions/{sub_id}/resume", params={"today": T}).json()
    assert resumed["status"] == "active" and resumed["is_running"] is True
    cancelled = client.post(f"{V1}/subscriptions/{sub_id}/cancel", params={"today": "2026-11-30"}).json()
    assert cancelled["status"] == "cancelled"
    assert cancelled["cancelled_on"] == "2026-11-30"
    assert cancelled["is_running"] is False
    assert cancelled["monthly_cost"] == pytest.approx(45.0)
    # a cancelled row leaves the renewal list and the run rate with it (§3's burn is live rows only)
    assert client.get(f"{V1}/subscriptions", params={"today": "2026-12-01", "renews": "month"}).json()["items"] == []
    burn = client.get(f"{V1}/finance/summary", params={"today": T, "currency": "INR"}).json()
    assert burn["mrr"] == 0.0 and burn["arr"] == 0.0


def test_the_renews_window_is_a_query_not_a_computation(client: TestClient, book: dict) -> None:
    """§4's three windows: this calendar month, the next seven days, and what already slipped."""
    ids = lambda rows: {row["id"] for row in rows}  # noqa: E731
    sub = book["subscription"]["id"]
    assert ids(client.get(f"{V1}/subscriptions", params={"today": T, "renews": "month"}).json()["items"]) == set()
    assert ids(client.get(f"{V1}/subscriptions", params={"today": "2026-12-01", "renews": "month"}).json()["items"]) == {sub}
    assert ids(client.get(f"{V1}/subscriptions", params={"today": "2026-12-12", "renews": "week"}).json()["items"]) == {sub}
    assert ids(client.get(f"{V1}/subscriptions", params={"today": "2026-12-01", "renews": "week"}).json()["items"]) == set()
    assert client.get(f"{V1}/subscriptions", params={"today": T, "renews": "past"}).json()["items"] == []
    overdue = post(client, "/subscriptions", {"price": 10, "currency": "INR", "interval": "monthly",
                                              "status": "active", "started_on": "2026-01-15",
                                              "renews_on": "2026-06-15"})
    assert ids(client.get(f"{V1}/subscriptions", params={"today": T, "renews": "past"}).json()["items"]) == {
        overdue["id"]
    }
    assert ids(client.get(f"{V1}/subscriptions", params={"today": T, "status": "active"}).json()["items"]) == {
        sub, overdue["id"]
    }


def test_a_renewal_date_is_derived_when_the_row_has_none(client: TestClient, book: dict) -> None:
    """§4: a recurring row with no ``renews_on`` still renews, and the screen has to say when."""
    bare = post(client, "/subscriptions", {"price": 1200, "currency": "INR", "interval": "monthly",
                                           "status": "active", "started_on": "2026-09-26"})
    assert bare["renews_on"] == "2026-11-26"  # started_on stepped forward to the next period
    assert bare["renews_in_days"] == 5
    assert bare["monthly_cost"] == pytest.approx(1200.0)
    once = post(client, "/subscriptions", {"price": 4000, "currency": "INR", "interval": "one_time",
                                           "status": "active", "started_on": "2026-09-26"})
    assert once["renews_on"] is None and once["renews_in_days"] is None
    assert once["monthly_cost"] is None  # §3: a one-off has no monthly figure


# ---------------------------------------------------------------- income profiles


def test_a_profile_stores_inputs_and_echoes_derived_results(client: TestClient, book: dict) -> None:
    profile = post(client, "/income-profiles", {"name": "Founder", "currency": "INR", "kind": "salary",
                                                "gross_monthly": 250000, "tax_regime": "flat", "tax_rate": 20})
    assert set(profile) >= {"monthly_net", "effective_tax_rate", "annual_gross"}
    assert profile["monthly_net"] == pytest.approx(200000.0)
    assert profile["annual_gross"] == pytest.approx(3000000.0)
    assert profile["effective_tax_rate"] == pytest.approx(20.0)
    assert client.post(f"{V1}/income-profiles", json={"name": "Founder", "currency": "INR"}).status_code == 409


def test_a_tax_regime_has_to_be_payable(client: TestClient, book: dict) -> None:
    response = client.post(
        f"{V1}/income-profiles", json={"name": "Vague", "currency": "INR", "tax_regime": "slab"}
    )
    assert response.status_code == 422
    assert response.json()["error"]["details"][0]["field"] == "tax_rate"
    assert client.post(
        f"{V1}/income-profiles", json={"name": "None", "currency": "INR", "tax_regime": "none"}
    ).status_code == 201


def test_the_preview_is_the_calculator_and_saves_nothing(client: TestClient, book: dict) -> None:
    got = client.post(
        f"{V1}/income-profiles/preview",
        json={"gross_annual": 1200000, "period": "annual", "currency": "INR", "tax_regime": "flat",
              "tax_rate": 18, "deductions": [{"label": "NPS", "amount": 50000, "pre_tax": True}]},
    ).json()
    assert set(got) == {
        "currency", "period", "gross", "taxable", "tax", "net", "net_monthly", "net_annual",
        "effective_tax_rate", "slab_breakdown", "deductions_total", "warnings",
    }
    assert got["taxable"] == pytest.approx(1150000.0)
    assert got["tax"] == pytest.approx(207000.0)
    assert got["net_annual"] == pytest.approx(993000.0)
    assert got["net_monthly"] == pytest.approx(82750.0)
    assert got["slab_breakdown"] == []  # a flat regime has no slices to show
    assert client.get(f"{V1}/income-profiles").json()["items"] == []


# ------------------------------------------------------- §6 notifications, §7 links


def test_the_finance_rules_derive_their_notifications(client: TestClient, book: dict) -> None:
    """§6: four rules, four ``dedupe_key`` shapes, four §7 hrefs - and a refresh that repeats nothing."""
    due = post(client, "/subscriptions", {"price": 20, "currency": "INR", "interval": "monthly",
                                          "status": "active", "started_on": "2026-01-15",
                                          "renews_on": "2026-11-25"})  # inside the 7-day rule
    overdue = post(client, "/income", {"label": "Stale invoice", "amount": 1000, "currency": "INR",
                                       "received_on": "2026-10-01", "status": "overdue"})
    post(client, "/exchange-rates", {"base": "EUR", "quote": "INR", "rate": 90, "as_of": "2026-01-01"})
    refresh = client.post(f"{V1}/notifications/refresh", params={"today": T}).json()
    assert refresh["created"] >= 4
    again = client.post(f"{V1}/notifications/refresh", params={"today": T}).json()
    assert again["created"] == 0  # idempotent by dedupe_key (§6)

    rows = client.get(f"{V1}/notifications", params={"limit": 100}).json()["items"]
    by_kind = {row["kind"]: row for row in rows}
    assert set(by_kind) >= {"subscription_renewing", "expense_recurring_due", "income_overdue", "rate_stale"}
    assert by_kind["subscription_renewing"]["href"] == f"/finance/subscriptions?sub={due['id']}"
    assert by_kind["subscription_renewing"]["dedupe_key"] == f"subscription:{due['id']}:renews:2026-11-25"
    assert by_kind["subscription_renewing"]["severity"] == "info"
    assert by_kind["expense_recurring_due"]["href"] == f"/finance/expenses?expense={book['rent']['id']}"
    assert by_kind["expense_recurring_due"]["dedupe_key"] == f"expense:{book['rent']['id']}:due:2026-11"
    assert by_kind["income_overdue"]["href"] == f"/finance/income?income={overdue['id']}"
    assert by_kind["income_overdue"]["dedupe_key"] == f"income:{overdue['id']}:overdue"
    assert by_kind["income_overdue"]["severity"] == "warning"  # §6's only warning of the four
    assert by_kind["rate_stale"]["href"] == "/finance/currency?pair=EURINR"
    assert by_kind["rate_stale"]["dedupe_key"].startswith("rate:EUR-INR:")
    assert {row["entity_type"] for row in rows} >= {"subscription", "expense", "income"}


def test_a_renewal_notification_is_not_raised_for_a_row_that_no_longer_bills(
    client: TestClient, book: dict
) -> None:
    due = post(client, "/subscriptions", {"price": 20, "currency": "INR", "interval": "monthly",
                                          "status": "active", "started_on": "2026-01-15",
                                          "renews_on": "2026-11-25"})
    client.post(f"{V1}/subscriptions/{due['id']}/cancel", params={"today": T})
    client.post(f"{V1}/notifications/refresh", params={"today": T})
    rows = client.get(f"{V1}/notifications", params={"limit": 100}).json()["items"]
    assert [row for row in rows if row["kind"] == "subscription_renewing"] == []


def test_the_overview_lists_the_rates_it_is_falling_back_on(client: TestClient, book: dict) -> None:
    client.post(f"{V1}/exchange-rates", params={"today": T},
                json={"base": "EUR", "quote": "INR", "rate": 90, "as_of": "2026-01-01"})
    body = client.get(f"{V1}/finance/summary", params={"today": T}).json()
    assert body["stale_rates"] == [{"base": "EUR", "quote": "INR", "as_of": "2026-01-01", "age_days": 324}]


def test_writing_a_finance_row_leaves_a_deep_link_in_activity(client: TestClient, book: dict) -> None:
    """§7: every finance write trail is a link the browser can follow straight to the row."""
    rows = client.get(f"{V1}/activity", params={"limit": 50}).json()["items"]
    links = {row["entity_type"]: {item["href"] for item in rows if item["entity_type"] == row["entity_type"]}
             for row in rows}
    assert f"/finance/expenses?expense={book['utilities']['id']}" in links["expense"]
    assert f"/finance/expenses?expense={book['rent']['id']}" in links["expense"]
    assert links["income"] == {f"/finance/income?income={book['invoice']['id']}",
                              f"/finance/income?income={book['fee']['id']}"}
    assert links["subscription"] == {f"/finance/subscriptions?sub={book['subscription']['id']}"}
    assert links["service"] == {f"/finance/services?service={book['service']['id']}"}
    assert links["expense_category"] == {f"/finance/expenses?category={book['category']['id']}"}
    assert links["service_plan"] == {"/finance/services"}  # §7 names no plan row: the module root
    assert links["exchange_rate"] == {"/finance/currency"}


def test_search_finds_the_finance_groups(client: TestClient, book: dict) -> None:
    groups = {row["type"]: row for row in client.get(f"{V1}/search", params={"q": "Adobe"}).json()["groups"]}
    assert "expenses" in groups
    assert groups["expenses"]["href"] == "/finance/expenses?q=Adobe"
    assert groups["expenses"]["items"][0]["href"] == f"/finance/expenses?expense={book['rent']['id']}"
    services = client.get(f"{V1}/search", params={"q": "Consulting"}).json()["groups"]
    assert {row["type"] for row in services} >= {"services"}


def test_the_system_surfaces_count_the_finance_tables(client: TestClient, book: dict) -> None:
    counts = client.get(f"{V1}/meta").json()["counts"]
    assert counts["expenses"] == 2 and counts["income"] == 2
    assert counts["subscriptions"] == 1 and counts["services"] == 1 and counts["scenarios"] == 0
    tables = client.get(f"{V1}/export").json()["tables"]
    assert {
        "expenses",
        "expense_categories",
        "income_transactions",
        "income_profiles",
        "subscriptions",
        "services",
        "service_plans",
        "exchange_rates",
        "cost_scenarios",
        "cost_scenario_items",
    } <= set(tables)
    assert len(tables["expenses"]) == 2


def test_the_currency_registry_is_what_rounding_is_built_on(client: TestClient, book: dict) -> None:
    body = client.get(f"{V1}/currencies").json()
    assert set(body) == {"items", "total"} and body["total"] == len(body["items"])
    jpy = next(row for row in body["items"] if row["code"] == "JPY")
    assert (jpy["minor_units"], jpy["decimal"]) == (0, 0)
    assert {"code", "symbol", "name", "minor_units", "decimal", "group"} <= set(jpy)
    # and the API rounds with it: a yen figure never carries a decimal place
    row = post(client, "/expenses", {"label": "Tokyo hosting", "amount": 1234.5, "currency": "JPY",
                                     "paid_on": T})
    assert row["amount"] == 1235.0
