"""Exchange rates: the ledger the user owns, the lookup, and the optional network refresh.

Two rules from PHASE3_FINANCE.md §2 shape this whole module. A lookup never invents a
rate: it takes ``MAX(as_of) <= requested_date`` for the pair, and when there is no such
row the caller gets a 422 naming the pair *and* the date it looked up. And a pair is
stored one way round only - ``quote -> base`` is served as ``1 / rate`` and is always
labelled ``derived: true`` so the UI can say so.

The reciprocal is kept at full ``Decimal`` precision and only the *amount* is quantised
afterwards, because rounding an inverse rate to 6 dp before multiplying drifts by cents
on large conversions.

``POST /exchange-rates/sync`` is the only Finance endpoint allowed to reach the network,
and only when ``MYOS_RATES_URL`` is configured; otherwise it answers 503
``not_configured`` and the UI tells the user to add rates by hand.
"""

from __future__ import annotations

import datetime as dt
import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.currencies import CODES, quantize
from app.core.config import get_settings
from app.core.errors import ApiError, conflict, field_error, validation
from app.core.utils import today_utc
from app.models import ExchangeRate
from app.services import activity, crud

#: a rate older than this is flagged, not rejected (§2.4) - it is still the user's number
RATE_STALE_DAYS = 30
#: how long ``/sync`` waits for the upstream before giving up
SYNC_TIMEOUT_SECONDS = 10

#: sort key -> (the key column, its default direction); tiebreakers are always id
_SORTS: dict[str, tuple[Any, str]] = {
    "as_of": (ExchangeRate.as_of, "desc"),
    "pair": (ExchangeRate.base, "asc"),
    "created": (ExchangeRate.created_at, "desc"),
}


@dataclass(frozen=True)
class Quote:
    """A resolved rate plus the provenance §2.3 insists on."""

    rate: Decimal
    as_of: dt.date | None
    derived: bool = False
    age_days: int | None = None

    @property
    def stale(self) -> bool:
        return self.age_days is not None and self.age_days > RATE_STALE_DAYS

    def as_dict(self) -> dict[str, Any]:
        """The derived block: ``rate``/``as_of``/``stale_days`` always travel together."""
        return {
            "rate": float(self.rate),
            "as_of": self.as_of,
            "derived": self.derived,
            "stale": self.stale,
            "age_days": self.age_days,
            "stale_days": self.age_days,
        }


def code_or_422(code: str | None, field_name: str, *, in_query: bool = False) -> str:
    """Upper-case a currency code and demand that the registry knows it.

    ``in_query`` puts the 422 detail on ``["query", …]`` instead of ``["body", …]`` -
    the same distinction API.md draws for every filter parameter.
    """
    text = (code or "").strip().upper()
    if text not in CODES:
        raise validation(
            f"{field_name} is not a supported currency",
            [
                field_error(
                    ["query" if in_query else "body", field_name],
                    f"'{code}' is not in the currency registry",
                )
            ],
        )
    return text


def check_pair(base: str | None, quote: str | None) -> tuple[str, str]:
    """Upper-case and validate both codes; ``base == quote`` is a 422 (§4)."""
    left = code_or_422(base, "base")
    right = code_or_422(quote, "quote")
    if left == right:
        raise validation(
            "base and quote must differ",
            [field_error(["body", "quote"], f"'{right}' is the same currency as base")],
        )
    return left, right


def latest_row(
    session: Session, workspace_id: str, base: str, quote: str, *, on_or_before: dt.date
) -> ExchangeRate | None:
    """The newest stored row for the pair on or before ``on_or_before``."""
    return session.scalar(
        sa.select(ExchangeRate)
        .where(
            ExchangeRate.workspace_id == workspace_id,
            ExchangeRate.base == base,
            ExchangeRate.quote == quote,
            ExchangeRate.as_of <= on_or_before,
        )
        .order_by(ExchangeRate.as_of.desc(), ExchangeRate.id.desc())
        .limit(1)
    )


def _exact(session: Session, workspace_id: str, base: str, quote: str, as_of: dt.date) -> Any:
    """The row a ``(pair, date)`` write would collide with (the UNIQUE in §13)."""
    return session.scalar(
        sa.select(ExchangeRate.id).where(
            ExchangeRate.workspace_id == workspace_id,
            ExchangeRate.base == base,
            ExchangeRate.quote == quote,
            ExchangeRate.as_of == as_of,
        )
    )


def quote_for(
    session: Session,
    workspace_id: str,
    base: str,
    quote: str,
    *,
    as_of: dt.date,
    today: dt.date | None = None,
) -> Quote:
    """Direct row, else the derived inverse, else a 422 naming the pair and the date.

    ``base == quote`` is answered locally: an identity conversion needs no rate row, and
    inventing one would put a meaningless ``as_of`` in the response.
    """
    if base == quote:
        return Quote(rate=Decimal(1), as_of=None, derived=False, age_days=0)
    day = today or as_of
    row = latest_row(session, workspace_id, base, quote, on_or_before=as_of)
    if row is not None:
        return Quote(
            rate=Decimal(row.rate), as_of=row.as_of, derived=False, age_days=max(0, (day - row.as_of).days)
        )
    inverse = latest_row(session, workspace_id, quote, base, on_or_before=as_of)
    if inverse is not None:
        return Quote(
            rate=Decimal(1) / Decimal(inverse.rate),
            as_of=inverse.as_of,
            derived=True,
            age_days=max(0, (day - inverse.as_of).days),
        )
    raise validation(
        f"no {base}/{quote} rate on or before {as_of.isoformat()}",
        [
            field_error(
                ["query", "quote"],
                f"no stored rate for {base}→{quote} up to {as_of.isoformat()} - add one or ask for an earlier date",
            )
        ],
    )


def convert(
    session: Session,
    workspace_id: str,
    amount: Decimal | float | str,
    base: str,
    quote: str,
    *,
    as_of: dt.date,
    today: dt.date | None = None,
) -> dict[str, Any]:
    """``GET /convert`` - the converted amount plus the full provenance block (§4)."""
    left, right = check_pair(base, quote)
    value = quantize(amount, left)
    rate = quote_for(session, workspace_id, left, right, as_of=as_of, today=today)
    return {
        "amount": value,
        "base": left,
        "quote": right,
        "converted": quantize(value * rate.rate, right),
        "rate": rate.rate,
        "as_of": rate.as_of,
        "derived": rate.derived,
        "stale": rate.stale,
        "age_days": rate.age_days,
    }


# --------------------------------------------------------------------- the ledger


def _order(sort: str, direction: str | None) -> tuple[Any, ...]:
    """Flip the requested key only; ``id`` stays the final tiebreaker so paging is stable.

    ``?dir=`` absent keeps the per-key default above, which is what today's screens sort by.
    """
    column, default = _SORTS[sort]
    wants = (direction or default).lower()
    key = column.asc() if wants == "asc" else column.desc()
    extra: list[Any] = []
    if sort == "pair":
        extra = [ExchangeRate.quote.asc(), ExchangeRate.as_of.desc()]
    return (key, *extra, ExchangeRate.id.asc())


def list_rates(
    session: Session,
    workspace_id: str,
    *,
    base: str | None = None,
    quote: str | None = None,
    query: str | None = None,
    sort: str = "as_of",
    direction: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    today: dt.date | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """Newest first by default; ``age_days`` is relative to ``today`` (§4)."""
    day = today or today_utc()
    conditions = [ExchangeRate.workspace_id == workspace_id]
    if base:
        conditions.append(ExchangeRate.base == code_or_422(base, "base"))
    if quote:
        conditions.append(ExchangeRate.quote == code_or_422(quote, "quote"))
    if query:
        conditions.append(
            sa.or_(
                crud.text_match(ExchangeRate.base, query),
                crud.text_match(ExchangeRate.quote, query),
                crud.text_match(ExchangeRate.provider, query),
            )
        )
    total = int(
        session.scalar(sa.select(sa.func.count()).select_from(ExchangeRate).where(*conditions)) or 0
    )
    statement = sa.select(ExchangeRate).where(*conditions).order_by(*_order(sort, direction))
    if limit is not None:
        statement = statement.limit(limit).offset(max(0, offset))
    rows = list(session.scalars(statement))
    return [rate_payload(row, day) for row in rows], total


def rate_payload(row: ExchangeRate, today: dt.date | None = None) -> dict[str, Any]:
    day = today or today_utc()
    age = max(0, (day - row.as_of).days)
    return {
        "id": row.id,
        "base": row.base,
        "quote": row.quote,
        "rate": row.rate,
        "as_of": row.as_of,
        "provider": row.provider,
        "age_days": age,
        "stale": age > RATE_STALE_DAYS,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _positive_rate(value: Any) -> Decimal:
    try:
        rate = Decimal(str(value))
    except InvalidOperation:
        raise validation(
            "rate must be a number",
            [field_error(["body", "rate"], f"{value!r} is not a number")],
        ) from None
    if not rate.is_finite() or rate <= 0:
        raise validation(
            "rate must be greater than zero",
            [field_error(["body", "rate"], "a rate of 0 or less would invert the ledger")],
        )
    return rate


def create_rate(
    session: Session,
    workspace_id: str,
    data: dict[str, Any],
    *,
    today: dt.date | None = None,
    provider: str = "manual",
) -> dict[str, Any]:
    day = today or today_utc()
    base, quote = check_pair(data.get("base"), data.get("quote"))
    rate = _positive_rate(data["rate"])
    as_of = data.get("as_of") or day
    if _exact(session, workspace_id, base, quote, as_of) is not None:
        raise conflict(
            f"a {base}/{quote} rate for {as_of.isoformat()} already exists",
            [field_error(["body", "as_of"], f"{base}→{quote} on {as_of.isoformat()} is stored already")],
        )
    row = ExchangeRate(
        workspace_id=workspace_id,
        base=base,
        quote=quote,
        rate=rate,
        as_of=as_of,
        provider=(data.get("provider") or provider)[:24],
    )
    session.add(row)
    session.flush()
    activity.created(
        session,
        workspace_id=workspace_id,
        entity_type="exchange_rate",
        entity_id=row.id,
        entity_title=f"{base}→{quote} {rate}",
        summary=f"Created rate “{base}→{quote}” for {as_of}",
    )
    return rate_payload(row, day)


def update_rate(
    session: Session,
    workspace_id: str,
    rate_id: str,
    data: dict[str, Any],
    *,
    today: dt.date | None = None,
) -> dict[str, Any]:
    day = today or today_utc()
    row = crud.require(
        session, ExchangeRate, rate_id, workspace_id=workspace_id, label="exchange rate"
    )
    base = code_or_422(data["base"], "base") if data.get("base") else row.base
    quote = code_or_422(data["quote"], "quote") if data.get("quote") else row.quote
    if base == quote:
        raise validation(
            "base and quote must differ",
            [field_error(["body", "quote"], f"'{quote}' is the same currency as base")],
        )
    rate = _positive_rate(data["rate"]) if data.get("rate") is not None else Decimal(row.rate)
    as_of = data.get("as_of") or row.as_of
    clash = _exact(session, workspace_id, base, quote, as_of)
    if clash is not None and clash != row.id:
        raise conflict(
            f"a {base}/{quote} rate for {as_of.isoformat()} already exists",
            [field_error(["body", "as_of"], "that pair already has a rate on that date")],
        )
    row.base, row.quote, row.rate, row.as_of = base, quote, rate, as_of
    if "provider" in data:
        row.provider = (data["provider"] or "")[:24] or None
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="exchange_rate",
        entity_id=row.id,
        entity_title=f"{base}→{quote} {rate}",
        summary=f"Updated rate “{base}→{quote}” for {as_of}",
    )
    return rate_payload(row, day)


def delete_rate(session: Session, workspace_id: str, rate_id: str) -> dict[str, Any]:
    row = crud.require(
        session, ExchangeRate, rate_id, workspace_id=workspace_id, label="exchange rate"
    )
    snapshot = {"id": row.id, "base": row.base, "quote": row.quote, "as_of": row.as_of}
    session.delete(row)
    session.flush()
    activity.deleted(
        session,
        workspace_id=workspace_id,
        entity_type="exchange_rate",
        entity_id=snapshot["id"],
        entity_title=f"{snapshot['base']}→{snapshot['quote']}",
        summary=f"Deleted rate “{snapshot['base']}→{snapshot['quote']}” for {snapshot['as_of']}",
    )
    return snapshot


# ------------------------------------------------------------------------ staleness


def newest_by_pair(
    session: Session, workspace_id: str
) -> list[tuple[str, str, dt.date]]:
    """``(base, quote, newest as_of)`` for every stored pair, in pair order."""
    rows = session.execute(
        sa.select(ExchangeRate.base, ExchangeRate.quote, sa.func.max(ExchangeRate.as_of))
        .where(ExchangeRate.workspace_id == workspace_id)
        .group_by(ExchangeRate.base, ExchangeRate.quote)
    ).all()
    return sorted(((base, quote, as_of) for base, quote, as_of in rows), key=lambda item: item[:2])


def stale_pairs(
    session: Session, workspace_id: str, *, today: dt.date | None = None
) -> list[dict[str, Any]]:
    """Every pair whose newest row is older than :data:`RATE_STALE_DAYS`.

    The age is computed in Python: the inverse direction is derived on read, so a stale
    ``USD→INR`` row is also the answer for ``INR→USD`` and must be listed as stored.
    """
    day = today or today_utc()
    return [
        {
            "base": base,
            "quote": quote,
            "as_of": as_of,
            "age_days": age,
        }
        for base, quote, as_of in newest_by_pair(session, workspace_id)
        if (age := max(0, (day - as_of).days)) > RATE_STALE_DAYS
    ]


# ---------------------------------------------------------------------- the refresh


def sync(session: Session, workspace_id: str, *, today: dt.date | None = None) -> dict[str, Any]:
    """``POST /exchange-rates/sync``: the only Finance endpoint that may use the network.

    Unconfigured is an answer, not a bug: 503 ``not_configured``. When ``MYOS_RATES_URL``
    is set the upstream is expected to return a JSON array of ``{base, quote, rate,
    as_of?}`` objects (the usual ``{"rates": [...]}`` wrapper is unwrapped) and each entry
    is upserted with ``provider = 'sync'`` - an existing ``(pair, as_of)`` row is updated,
    never duplicated. A failure to reach the upstream is also 503: the operator's own
    configuration is what is unavailable, not the user's data.
    """
    url = (get_settings().rates_url or "").strip()
    if not url:
        raise ApiError(
            "not_configured",
            "rate sync is disabled: set MYOS_RATES_URL to a JSON endpoint",
            [field_error(["body"], "MYOS_RATES_URL is not configured - add rates by hand instead")],
        )
    day = today or today_utc()
    try:
        # nosec B310 - the URL is operator configuration, never user input
        with urllib.request.urlopen(url, timeout=SYNC_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        raise ApiError(
            "not_configured", f"rate sync could not reach the configured endpoint ({exc.__class__.__name__})"
        ) from exc

    created = 0
    updated = 0
    for entry in _as_entries(payload):
        base, quote = check_pair(entry.get("base"), entry.get("quote"))
        rate = Decimal(str(entry["rate"]))
        if rate <= 0:
            continue
        as_of = entry.get("as_of") or day
        existing = _exact(session, workspace_id, base, quote, as_of)
        if existing is not None:
            row = session.get(ExchangeRate, existing)
            assert row is not None
            row.rate = rate
            row.provider = "sync"
            updated += 1
            continue
        session.add(
            ExchangeRate(
                workspace_id=workspace_id, base=base, quote=quote, rate=rate, as_of=as_of, provider="sync"
            )
        )
        created += 1
    session.flush()
    if created or updated:
        activity.updated(
            session,
            workspace_id=workspace_id,
            entity_type="exchange_rate",
            entity_id=None,
            entity_title="exchange rates",
            summary=f"Synced exchange rates ({created} new, {updated} updated)",
        )
    return {"created": created, "updated": updated, "source": url, "as_of": day}


def _as_entries(payload: Any) -> list[dict[str, Any]]:
    """Accept a bare array or the common ``rates``/``result``/``items``/``data`` wrapper."""
    if isinstance(payload, dict):
        for key in ("rates", "result", "items", "data"):
            if isinstance(payload.get(key), list):
                payload = payload[key]
                break
    if not isinstance(payload, list):
        raise ApiError("not_configured", "rate sync response was not a list of rates")
    return [entry for entry in payload if isinstance(entry, dict) and entry.get("rate")]
