"""``/exchange-rates`` and ``/convert``: rates are looked up, never invented (§2.4).

The rule this file exists to pin is the one that decides whether a converted figure means
anything: ``MAX(as_of) <= requested_date``, the newest row that is *not after* the day being
priced, an inverse derived only as ``1/rate`` and labelled, and a 422 naming the pair and the
date when nothing qualifies.  Staleness is reported, never repaired.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.errors import ApiError
from app.models import ExchangeRate
from app.services import rates

from tests.test_money import DAY, add_rate  # the same fixtures, one definition

V1 = "/api/v1"


# ------------------------------------------------------------------- lookups (§2.4)


def test_a_lookup_takes_the_newest_row_on_or_before_the_date(
    session: Session, workspace_id: str
) -> None:
    add_rate(session, workspace_id, "USD", "INR", "80.000000", as_of=DAY - dt.timedelta(days=90))
    add_rate(session, workspace_id, "USD", "INR", "83.500000", as_of=DAY - dt.timedelta(days=10))
    # pricing a day between the two rows must use the older one, not the newer one
    before = rates.quote_for(session, workspace_id, "USD", "INR", as_of=DAY - dt.timedelta(days=45))
    assert before.rate == Decimal("80.000000")
    assert before.as_of == DAY - dt.timedelta(days=90)
    after = rates.quote_for(session, workspace_id, "USD", "INR", as_of=DAY)
    assert after.rate == Decimal("83.500000")
    assert (after.derived, after.stale) == (False, False)


def test_a_future_date_degrades_to_the_last_known_rate(session: Session, workspace_id: str) -> None:
    """§2.4: the newest row wins even when it is old - and says how old it is."""
    add_rate(session, workspace_id, "USD", "INR", "83.500000", as_of=DAY - dt.timedelta(days=64))
    quote = rates.quote_for(
        session, workspace_id, "USD", "INR", as_of=DAY + dt.timedelta(days=30), today=DAY
    )
    assert quote.rate == Decimal("83.500000")
    assert quote.age_days == 64 and quote.stale is True


def test_the_inverse_is_derived_and_labelled(session: Session, workspace_id: str) -> None:
    """A pair is stored one way; ``quote→base`` is ``1/rate`` and never a second row."""
    add_rate(session, workspace_id, "EUR", "USD", "1.100000", as_of=DAY)
    quote = rates.quote_for(session, workspace_id, "USD", "EUR", as_of=DAY, today=DAY)
    assert quote.derived is True
    assert quote.rate == Decimal(1) / Decimal("1.100000")
    assert quote.as_of == DAY


def test_an_unknown_pair_is_a_422_naming_the_pair_and_the_date(
    session: Session, workspace_id: str
) -> None:
    with pytest.raises(ApiError) as caught:
        rates.quote_for(session, workspace_id, "GBP", "INR", as_of=DAY, today=DAY)
    assert caught.value.status_code == 422
    assert "GBP" in caught.value.message and "INR" in caught.value.message
    assert DAY.isoformat() in caught.value.message
    assert caught.value.details[0]["field"] == "query.quote"


def test_an_identity_conversion_needs_no_row(session: Session, workspace_id: str) -> None:
    quote = rates.quote_for(session, workspace_id, "INR", "INR", as_of=DAY, today=DAY)
    assert (quote.rate, quote.as_of, quote.derived, quote.age_days) == (Decimal(1), None, False, 0)


def test_a_rate_never_crosses_into_another_workspace(
    session: Session, workspace_id: str
) -> None:
    from tests.helpers import other_workspace

    add_rate(session, other_workspace(session), "USD", "INR", "83.500000", as_of=DAY)
    with pytest.raises(ApiError):
        rates.quote_for(session, workspace_id, "USD", "INR", as_of=DAY, today=DAY)


# ---------------------------------------------------------------- staleness (§2.4/§6)


@pytest.mark.parametrize(("age", "stale"), [(29, False), (30, False), (31, True)])
def test_a_row_becomes_stale_the_day_after_the_window(
    session: Session, workspace_id: str, age: int, stale: bool
) -> None:
    row = add_rate(session, workspace_id, "USD", "INR", "83.5", as_of=DAY - dt.timedelta(days=age))
    body = rates.rate_payload(row, DAY)
    assert body["age_days"] == age
    assert body["stale"] is stale


def test_stale_pairs_lists_one_entry_per_pair_as_stored(session: Session, workspace_id: str) -> None:
    add_rate(session, workspace_id, "GBP", "USD", "1.27", as_of=DAY - dt.timedelta(days=64))
    add_rate(session, workspace_id, "GBP", "USD", "1.30", as_of=DAY - dt.timedelta(days=40))
    add_rate(session, workspace_id, "USD", "INR", "83.5", as_of=DAY - dt.timedelta(days=2))
    stale = rates.stale_pairs(session, workspace_id, today=DAY)
    assert stale == [{"base": "GBP", "quote": "USD", "as_of": DAY - dt.timedelta(days=40), "age_days": 40}]


# ----------------------------------------------------------------------- the writes


def test_pair_codes_are_uppercased_and_must_differ(session: Session, workspace_id: str) -> None:
    body = rates.create_rate(
        session,
        workspace_id,
        {"base": "usd", "quote": "inr", "rate": "83.5", "as_of": DAY},
        today=DAY,
    )
    assert (body["base"], body["quote"]) == ("USD", "INR")
    with pytest.raises(ApiError) as caught:
        rates.create_rate(
            session, workspace_id, {"base": "usd", "quote": "USD", "rate": "1", "as_of": DAY}, today=DAY
        )
    assert caught.value.status_code == 422


def test_a_duplicate_pair_and_date_is_a_409(session: Session, workspace_id: str) -> None:
    rates.create_rate(
        session, workspace_id, {"base": "USD", "quote": "INR", "rate": "83.5", "as_of": DAY}, today=DAY
    )
    with pytest.raises(ApiError) as caught:
        rates.create_rate(
            session, workspace_id, {"base": "USD", "quote": "INR", "rate": "84", "as_of": DAY}, today=DAY
        )
    assert caught.value.status_code == 409


@pytest.mark.parametrize("rate", ["0", "-1.5", "abc"])
def test_a_rate_must_be_a_positive_number(session: Session, workspace_id: str, rate: str) -> None:
    with pytest.raises(ApiError) as caught:
        rates.create_rate(
            session,
            workspace_id,
            {"base": "USD", "quote": "INR", "rate": rate, "as_of": DAY},
            today=DAY,
        )
    assert caught.value.status_code == 422


@pytest.mark.parametrize("code", ["USDT", "INR ", "", "xyz"])
def test_an_unknown_currency_code_is_refused(session: Session, workspace_id: str, code: str) -> None:
    with pytest.raises(ApiError):
        rates.create_rate(
            session, workspace_id, {"base": code, "quote": "INR", "rate": "1", "as_of": DAY}, today=DAY
        )


def test_update_and_delete_a_rate(session: Session, workspace_id: str) -> None:
    body = rates.create_rate(
        session, workspace_id, {"base": "USD", "quote": "INR", "rate": "83.5", "as_of": DAY}, today=DAY
    )
    moved = rates.update_rate(session, workspace_id, body["id"], {"rate": "84.2"}, today=DAY)
    assert moved["rate"] == Decimal("84.200000")
    rates.delete_rate(session, workspace_id, body["id"])
    session.expire_all()
    assert session.get(ExchangeRate, body["id"]) is None


# -------------------------------------------------------------------- /convert (§4)


def test_convert_reports_the_whole_provenance_block(session: Session, workspace_id: str) -> None:
    add_rate(session, workspace_id, "USD", "INR", "83.500000", as_of=DAY - dt.timedelta(days=3))
    got = rates.convert(session, workspace_id, "2800", "USD", "INR", as_of=DAY, today=DAY)
    assert set(got) == {
        "amount",
        "base",
        "quote",
        "converted",
        "rate",
        "as_of",
        "derived",
        "stale",
        "age_days",
    }
    assert got["converted"] == Decimal("233800.00")
    assert got["as_of"] == DAY - dt.timedelta(days=3) and got["derived"] is False


def test_a_zero_decimal_currency_rounds_to_whole_units(session: Session, workspace_id: str) -> None:
    """JPY has no minor unit (§2.2), so a conversion quantises to the yen, not to 2 dp."""
    add_rate(session, workspace_id, "USD", "JPY", "148.270000", as_of=DAY)
    got = rates.convert(session, workspace_id, "12.50", "USD", "JPY", as_of=DAY, today=DAY)
    assert got["converted"] == Decimal("1853")


# --------------------------------------------------------------------- the surface


def test_the_rate_list_is_newest_first_and_dir_flips_only_the_key(
    session: Session, workspace_id: str
) -> None:
    for back in (90, 60, 30, 1):
        add_rate(session, workspace_id, "USD", "INR", "83.5", as_of=DAY - dt.timedelta(days=back))
    newest_first, total = rates.list_rates(session, workspace_id, today=DAY)
    assert total == 4
    assert [row["as_of"] for row in newest_first] == sorted(
        (row["as_of"] for row in newest_first), reverse=True
    )
    oldest, _ = rates.list_rates(session, workspace_id, sort="as_of", direction="asc", today=DAY)
    assert [row["as_of"] for row in oldest] == list(reversed([row["as_of"] for row in newest_first]))


def test_sort_pair_groups_by_code_then_date(session: Session, workspace_id: str) -> None:
    add_rate(session, workspace_id, "USD", "INR", "83.5", as_of=DAY - dt.timedelta(days=5))
    add_rate(session, workspace_id, "EUR", "INR", "89.0", as_of=DAY)
    rows, _ = rates.list_rates(session, workspace_id, sort="pair", today=DAY)
    assert [(row["base"], row["quote"]) for row in rows] == [("EUR", "INR"), ("USD", "INR")]


# ----------------------------------------------------------------------- the API


def test_convert_endpoint_answers_with_the_provenance_block(client: TestClient, today: dt.date) -> None:
    created = client.post(
        f"{V1}/exchange-rates",
        json={"base": "USD", "quote": "INR", "rate": "83.5", "as_of": today.isoformat()},
    )
    assert created.status_code == 201, created.text
    got = client.get(
        f"{V1}/convert",
        # the read that returns ``age_days``/``stale`` takes the same override as the write,
        # so this stays true on a frozen clock rather than on the day the suite happens to run
        params={"amount": "100", "base": "USD", "quote": "INR", "today": today.isoformat()},
    )
    assert got.status_code == 200
    body = got.json()
    assert body["converted"] == pytest.approx(8350.0)
    assert body["derived"] is False and body["stale"] is False


def test_convert_endpoint_passes_the_422_through(client: TestClient) -> None:
    got = client.get(f"{V1}/convert", params={"amount": "1", "base": "GBP", "quote": "INR"})
    assert got.status_code == 422
    error = got.json()["error"]
    assert error["code"] == "validation_error"
    assert "GBP" in error["message"] and "INR" in error["message"]
    assert error["details"][0]["loc"] == ["query", "quote"]


@pytest.mark.parametrize("code", ["usd", "USD"])
def test_the_rate_post_uppercases_and_validates_the_pair(
    client: TestClient, code: str, today: dt.date
) -> None:
    body: dict[str, Any] = {
        "base": code,
        "quote": "INR",
        "rate": "83.5",
        "as_of": today.isoformat(),
    }
    created = client.post(f"{V1}/exchange-rates", json=body)
    assert created.status_code == 201, created.text
    assert created.json()["base"] == "USD"


def test_sync_without_an_upstream_is_a_503_not_a_crash(client: TestClient) -> None:
    got = client.post(f"{V1}/exchange-rates/sync")
    assert got.status_code == 503
    assert got.json()["error"]["code"] == "not_configured"


def test_the_rate_list_honours_the_page_envelope(client: TestClient, today: dt.date) -> None:
    for back in range(4):
        client.post(
            f"{V1}/exchange-rates",
            json={
                "base": "USD",
                "quote": "INR",
                "rate": f"8{back}.5",
                "as_of": (today - dt.timedelta(days=10 * back)).isoformat(),
            },
        )
    first = client.get(f"{V1}/exchange-rates", params={"limit": 2, "offset": 0, "dir": "asc"}).json()
    second = client.get(f"{V1}/exchange-rates", params={"limit": 2, "offset": 2, "dir": "asc"}).json()
    assert first["total"] == second["total"] == 4
    assert {"items", "total", "limit", "offset"} == set(first)
    # the addendum's rule: the same rows in the opposite order, stable across two pages
    ascending = first["items"] + second["items"]
    descending = client.get(f"{V1}/exchange-rates", params={"dir": "desc"}).json()["items"]
    assert [row["id"] for row in ascending] == [row["id"] for row in reversed(descending)]
    assert [row["as_of"] for row in ascending] == sorted(row["as_of"] for row in ascending)


def test_an_invalid_dir_is_a_422_on_the_query_parameter(client: TestClient) -> None:
    got = client.get(f"{V1}/exchange-rates", params={"dir": "sideways"})
    assert got.status_code == 422
    assert got.json()["error"]["details"][0]["loc"] == ["query", "dir"]
