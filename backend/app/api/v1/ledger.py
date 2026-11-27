"""The ledgers: ``/expense-categories``, ``/expenses`` and ``/income``.

Two rules shape this router. Every list keeps the ``{items, total}`` envelope plus
``limit``/``offset`` (API.md), and every mutating call is recorded by the service in the
same transaction (PHASE3_FINANCE.md §4). The money itself is summed in
:mod:`app.services.money`, per currency, so a mixed-currency month reports a total of
``null`` rather than a number that adds two different units.
"""

from __future__ import annotations

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.api.v1.deps import (
    CurrencyQuery,
    DirQuery,
    DbSession,
    MonthQuery,
    Today,
    WorkspaceScope,
    enum_param,
    sort_param,
)
from app.schemas.finance import (
    BulkIn,
    BulkOut,
    CategoryCreate,
    CategoryUpdate,
    ExpenseCategoryListOut,
    ExpenseCategoryOut,
    ExpenseCreate,
    ExpenseListOut,
    ExpenseOut,
    ExpenseSummaryOut,
    ExpenseUpdate,
    IncomeCreate,
    IncomeListOut,
    IncomeOut,
    IncomeSummaryOut,
    IncomeUpdate,
)
from app.services import expenses, income, money, serializers

router = APIRouter(tags=["ledger"])

CSV_MEDIA_TYPE = "text/csv; charset=utf-8"

ExpenseSortQuery = Annotated[str, sort_param("paid_on", "amount", "created", default="paid_on")]
IncomeSortQuery = Annotated[
    str, sort_param("received_on", "amount", "created", default="received_on")
]
ExpenseRecurrenceQuery = Annotated[
    str | None, enum_param("expense.recurrence", "recurrence")
]
CategoryKindQuery = Annotated[str | None, enum_param("expense.category.kind", "kind")]
IncomeStatusQuery = Annotated[str | None, enum_param("income.status", "status")]
LimitQuery = Annotated[int, Query(ge=1, le=1000)]
OffsetQuery = Annotated[int, Query(ge=0)]
StartQuery = Annotated[dt.date | None, Query(alias="from", description="YYYY-MM-DD, inclusive")]
EndQuery = Annotated[dt.date | None, Query(alias="to", description="YYYY-MM-DD, inclusive")]


# --------------------------------------------------------------- expense categories
@router.get(
    "/expense-categories",
    response_model=ExpenseCategoryListOut,
    summary="The category tree, rolled up to one month",
)
def list_categories(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    kind: CategoryKindQuery,
    archived: Annotated[bool | None, Query()] = None,
    month: MonthQuery = None,
    currency: CurrencyQuery = None,
) -> dict:
    items, total = expenses.list_categories(
        session,
        scope,
        kind=kind,
        archived=archived,
        month=month or today,
        currency=currency,
        today=today,
    )
    return {"items": items, "total": total}


@router.post(
    "/expense-categories",
    response_model=ExpenseCategoryOut,
    status_code=status.HTTP_201_CREATED,
    summary="Add a category (name is unique per parent)",
)
def create_category(session: DbSession, scope: WorkspaceScope, payload: CategoryCreate) -> dict:
    return expenses.create_category(session, scope, payload.model_dump(exclude_unset=True))


@router.patch(
    "/expense-categories/{category_id}",
    response_model=ExpenseCategoryOut,
    summary="Rename, re-parent or archive a category",
)
def update_category(
    session: DbSession,
    scope: WorkspaceScope,
    category_id: str,
    payload: CategoryUpdate,
) -> dict:
    return expenses.update_category(
        session, scope, category_id, payload.model_dump(exclude_unset=True)
    )


@router.delete(
    "/expense-categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a category (expenses keep the rows, lose the link)",
)
def delete_category(session: DbSession, scope: WorkspaceScope, category_id: str) -> Response:
    expenses.delete_category(session, scope, category_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# -------------------------------------------------------------------------- expenses
@router.get(
    "/expenses/summary",
    response_model=ExpenseSummaryOut,
    summary="One month of spend, its 12-month series and the splits",
)
def expense_summary(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    month: MonthQuery = None,
    currency: CurrencyQuery = None,
) -> dict:
    return money.expense_summary(
        session, scope, month=month or today.isoformat(), currency=currency, today=today
    )


@router.get(
    "/expenses/export.csv",
    response_class=Response,
    summary="The filtered ledger as CSV, generated per request",
)
def export_expenses(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    category_id: Annotated[str | None, Query()] = None,
    vendor: Annotated[str | None, Query()] = None,
    currency: CurrencyQuery = None,
    start: StartQuery = None,
    end: EndQuery = None,
    q: Annotated[str | None, Query()] = None,
) -> Response:
    body = expenses.export_csv(
        session,
        scope,
        category_id=category_id,
        vendor=vendor,
        currency=currency,
        start=start,
        end=end,
        query=q,
        today=today,
    )
    return Response(
        content=body,
        media_type=CSV_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="expenses.csv"'},
    )


@router.get("/expenses", response_model=ExpenseListOut, summary="The expense ledger")
def list_expenses(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    sort: ExpenseSortQuery,
    direction: DirQuery,
    currency: CurrencyQuery,
    recurrence: ExpenseRecurrenceQuery,
    category_id: Annotated[str | None, Query()] = None,
    vendor: Annotated[str | None, Query()] = None,
    recurring: Annotated[bool | None, Query()] = None,
    start: StartQuery = None,
    end: EndQuery = None,
    q: Annotated[str | None, Query()] = None,
    limit: LimitQuery = 200,
    offset: OffsetQuery = 0,
) -> dict:
    items, total = expenses.list_expenses(
        session,
        scope,
        category_id=category_id,
        vendor=vendor,
        currency=currency,
        recurring=recurring,
        recurrence=recurrence,
        start=start,
        end=end,
        query=q,
        sort=sort,
        direction=direction,
        limit=limit,
        offset=offset,
        today=today,
    )
    return serializers.page_payload(items, total, limit=limit, offset=offset)


@router.post(
    "/expenses",
    response_model=ExpenseOut,
    status_code=status.HTTP_201_CREATED,
    summary="Log an expense",
)
def create_expense(
    session: DbSession, scope: WorkspaceScope, payload: ExpenseCreate, today: Today
) -> dict:
    return expenses.create_expense(
        session, scope, payload.model_dump(exclude_unset=True), today=today
    )


@router.post(
    "/expenses/bulk",
    response_model=BulkOut,
    summary="Delete, re-categorise or re-schedule many rows at once",
)
def bulk_expenses(session: DbSession, scope: WorkspaceScope, payload: BulkIn) -> dict:
    return expenses.bulk(session, scope, list(payload.ids), payload.action, payload.value)


@router.get("/expenses/{expense_id}", response_model=ExpenseOut, summary="One expense")
def get_expense(
    session: DbSession, scope: WorkspaceScope, expense_id: str, today: Today
) -> dict:
    return expenses.get_expense(session, scope, expense_id, today=today)


@router.patch(
    "/expenses/{expense_id}", response_model=ExpenseOut, summary="Update an expense"
)
def update_expense(
    session: DbSession,
    scope: WorkspaceScope,
    expense_id: str,
    payload: ExpenseUpdate,
    today: Today,
) -> dict:
    return expenses.update_expense(
        session, scope, expense_id, payload.model_dump(exclude_unset=True), today=today
    )


@router.delete(
    "/expenses/{expense_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an expense",
)
def delete_expense(session: DbSession, scope: WorkspaceScope, expense_id: str) -> Response:
    expenses.delete_expense(session, scope, expense_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------ income ledger
@router.get(
    "/income/summary",
    response_model=IncomeSummaryOut,
    summary="Invoiced vs received, receivables, overdue and the series",
)
def income_summary(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    month: MonthQuery = None,
    currency: CurrencyQuery = None,
) -> dict:
    return income.summary(
        session, scope, month=month or today.isoformat(), currency=currency, today=today
    )


@router.get("/income", response_model=IncomeListOut, summary="The income ledger")
def list_income(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    status_filter: IncomeStatusQuery,
    sort: IncomeSortQuery,
    direction: DirQuery,
    currency: CurrencyQuery,
    service_id: Annotated[str | None, Query()] = None,
    subscription_id: Annotated[str | None, Query()] = None,
    start: StartQuery = None,
    end: EndQuery = None,
    q: Annotated[str | None, Query()] = None,
    limit: LimitQuery = 200,
    offset: OffsetQuery = 0,
) -> dict:
    items, total = income.list_transactions(
        session,
        scope,
        status=status_filter,
        start=start,
        end=end,
        service_id=service_id,
        subscription_id=subscription_id,
        currency=currency,
        query=q,
        sort=sort,
        direction=direction,
        limit=limit,
        offset=offset,
        today=today,
    )
    return serializers.page_payload(items, total, limit=limit, offset=offset)


@router.post(
    "/income",
    response_model=IncomeOut,
    status_code=status.HTTP_201_CREATED,
    summary="Log income",
)
def create_income(
    session: DbSession, scope: WorkspaceScope, payload: IncomeCreate, today: Today
) -> dict:
    return income.create_transaction(
        session, scope, payload.model_dump(exclude_unset=True), today=today
    )


@router.get(
    "/income/export.csv",
    response_class=Response,
    summary="The filtered income ledger as CSV, generated per request",
)
def export_income(
    session: DbSession,
    scope: WorkspaceScope,
    today: Today,
    status_filter: IncomeStatusQuery,
    service_id: Annotated[str | None, Query()] = None,
    subscription_id: Annotated[str | None, Query()] = None,
    currency: CurrencyQuery = None,
    start: StartQuery = None,
    end: EndQuery = None,
    q: Annotated[str | None, Query()] = None,
) -> Response:
    body = income.export_csv(
        session,
        scope,
        status=status_filter,
        start=start,
        end=end,
        service_id=service_id,
        subscription_id=subscription_id,
        currency=currency,
        query=q,
        today=today,
    )
    return Response(
        content=body,
        media_type=CSV_MEDIA_TYPE,
        headers={"Content-Disposition": 'attachment; filename="income.csv"'},
    )


@router.get("/income/{income_id}", response_model=IncomeOut, summary="One income row")
def get_income(
    session: DbSession, scope: WorkspaceScope, income_id: str, today: Today
) -> dict:
    return income.get_transaction(session, scope, income_id, today=today)


@router.patch(
    "/income/{income_id}", response_model=IncomeOut, summary="Update an income row"
)
def update_income(
    session: DbSession,
    scope: WorkspaceScope,
    income_id: str,
    payload: IncomeUpdate,
    today: Today,
) -> dict:
    return income.update_transaction(
        session, scope, income_id, payload.model_dump(exclude_unset=True), today=today
    )


@router.delete(
    "/income/{income_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an income row",
)
def delete_income(session: DbSession, scope: WorkspaceScope, income_id: str) -> Response:
    income.delete_transaction(session, scope, income_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/income/{income_id}/mark-paid",
    response_model=IncomeOut,
    summary="Collect an expected or overdue row today",
)
def mark_income_paid(
    session: DbSession, scope: WorkspaceScope, income_id: str, today: Today
) -> dict:
    return income.mark_paid(session, scope, income_id, today=today)


__all__ = ["router"]
