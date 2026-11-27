"""Finance overview, the currency registry, the rate ledger and income profiles.

Every handler is three lines (ARCHITECTURE.md §3): resolve the request context, call the
service, return its payload. The rules - which currency a total may be reported in, when a
rate is "stale", what a slab regime taxes - live in :mod:`app.services.money` and
:mod:`app.services.rates`, never here.

Paths are deliberately flat (``/convert`` sits beside ``/currencies``) because
PHASE3_FINANCE.md §4 specifies them that way, so this router is mounted without a prefix.
"""

from __future__ import annotations

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.v1.deps import (
    CurrencyQuery,
    DirQuery,
    DbSession,
    Today,
    WorkspaceScope,
    enum_param,
    sort_param,
)
from app.core.currencies import CURRENCIES
from app.schemas.finance import (
    ConvertOut,
    CurrencyListOut,
    ExchangeRateListOut,
    ExchangeRateOut,
    FinanceSummaryOut,
    IncomeProfileCreate,
    IncomeProfileListOut,
    IncomeProfileOut,
    IncomeProfileUpdate,
    PreviewIn,
    PreviewOut,
    RateCreate,
    RateSyncOut,
    RateUpdate,
)
from app.services import income, money, rates, serializers

router = APIRouter(tags=["finance"])

RateSortQuery = Annotated[str, sort_param("as_of", "pair", "created", default="as_of")]
ProfileKindQuery = Annotated[str | None, enum_param("income.kind", "kind")]
ProfileSortQuery = Annotated[str, sort_param("name", "gross", "created", default="name")]
LimitQuery = Annotated[int, Query(ge=1, le=1000)]
OffsetQuery = Annotated[int, Query(ge=0)]


# ------------------------------------------------------------------- the overview
@router.get(
    "/finance/summary",
    response_model=FinanceSummaryOut,
    summary="Where the money came from and went this month",
)
def finance_summary(
    session: DbSession, scope: WorkspaceScope, today: Today, currency: CurrencyQuery
) -> dict:
    return money.finance_summary(session, scope, today=today, currency=currency)


# ---------------------------------------------------------------------- currencies
@router.get(
    "/currencies",
    response_model=CurrencyListOut,
    summary="The curated ISO-4217 registry that drives rounding",
)
def list_currencies() -> dict:
    items = [entry.as_dict() for entry in CURRENCIES]
    return {"items": items, "total": len(items)}


# ------------------------------------------------------------------ rate ledger
@router.get(
    "/exchange-rates",
    response_model=ExchangeRateListOut,
    summary="Rate rows, newest first, with age_days relative to today",
)
def list_rates(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    sort: RateSortQuery,
    direction: DirQuery,
    base: Annotated[str | None, Query()] = None,
    quote: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query(description="base/quote/provider substring")] = None,
    limit: LimitQuery = 200,
    offset: OffsetQuery = 0,
) -> dict:
    items, total = rates.list_rates(
        session,
        scope,
        base=base,
        quote=quote,
        query=q,
        sort=sort,
        direction=direction,
        limit=limit,
        offset=offset,
        today=today,
    )
    return serializers.page_payload(items, total, limit=limit, offset=offset)


@router.post(
    "/exchange-rates",
    response_model=ExchangeRateOut,
    status_code=status.HTTP_201_CREATED,
    summary="Store a rate the user measured",
)
def create_rate(
    session: DbSession, scope: WorkspaceScope, payload: RateCreate, today: Today
) -> dict:
    return rates.create_rate(session, scope, payload.model_dump(), today=today)


@router.post(
    "/exchange-rates/sync",
    response_model=RateSyncOut,
    summary="Optional network refresh; 503 not_configured without MYOS_RATES_URL",
)
def sync_rates(session: DbSession, scope: WorkspaceScope, today: Today) -> dict:
    return rates.sync(session, scope, today=today)


@router.patch(
    "/exchange-rates/{rate_id}", response_model=ExchangeRateOut, summary="Correct a rate row"
)
def update_rate(
    session: DbSession,
    scope: WorkspaceScope,
    rate_id: str,
    payload: RateUpdate,
    today: Today,
) -> dict:
    return rates.update_rate(
        session, scope, rate_id, payload.model_dump(exclude_unset=True), today=today
    )


@router.delete(
    "/exchange-rates/{rate_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a rate row",
)
def delete_rate(session: DbSession, scope: WorkspaceScope, rate_id: str) -> Response:
    rates.delete_rate(session, scope, rate_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/convert",
    response_model=ConvertOut,
    summary="Convert at the newest known rate, with the provenance block",
)
def convert(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    amount: Annotated[float, Query(description="the figure, in base")],
    base: Annotated[str, Query()],
    quote: Annotated[str, Query()],
    as_of: Annotated[dt.date | None, Query()] = None,
) -> dict:
    return rates.convert(
        session, scope, amount, base, quote, as_of=as_of or today, today=today
    )


# --------------------------------------------------------------- income profiles
@router.get(
    "/income-profiles",
    response_model=IncomeProfileListOut,
    summary="Income calculator profiles with their derived figures",
)
def list_profiles(
    session: DbSession,
    scope: WorkspaceScope,
    kind: ProfileKindQuery,
    sort: ProfileSortQuery,
    direction: DirQuery,
    q: Annotated[str | None, Query()] = None,
) -> dict:
    items, total = income.list_profiles(
        session, scope, kind=kind, query=q, sort=sort, direction=direction
    )
    return {"items": items, "total": total}


@router.post(
    "/income-profiles",
    response_model=IncomeProfileOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a profile (inputs only - results are never stored)",
)
def create_profile(session: DbSession, scope: WorkspaceScope, payload: IncomeProfileCreate) -> dict:
    return income.create_profile(session, scope, payload.model_dump())


@router.post(
    "/income-profiles/preview",
    response_model=PreviewOut,
    summary="The calculator: gross -> tax -> take-home, nothing saved",
)
def preview_profile(payload: PreviewIn) -> dict:
    return income.preview(payload.model_dump())


@router.get(
    "/income-profiles/{profile_id}", response_model=IncomeProfileOut, summary="One profile"
)
def get_profile(session: DbSession, scope: WorkspaceScope, profile_id: str) -> dict:
    return income.get_profile(session, scope, profile_id)


@router.patch(
    "/income-profiles/{profile_id}", response_model=IncomeProfileOut, summary="Update a profile"
)
def update_profile(
    session: DbSession, scope: WorkspaceScope, profile_id: str, payload: IncomeProfileUpdate
) -> dict:
    return income.update_profile(
        session, scope, profile_id, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/income-profiles/{profile_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a profile",
)
def delete_profile(session: DbSession, scope: WorkspaceScope, profile_id: str) -> Response:
    income.delete_profile(session, scope, profile_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
