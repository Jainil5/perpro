"""Phase 3 Finance request/response models (PHASE3_FINANCE.md §4).

Money leaves this module as ``float``: every figure has already been quantised to the
currency's minor units by :mod:`app.services.money`, so a float here is a display number
and never an operand (§2.2). Percentages (``tax_rate``, ``effective_tax_rate``, ``share``)
are plain 2-dp numbers, not money.

Request bodies are ``extra="forbid"`` like everything else, so a typo in a money field is
a 422 rather than an expense saved without the field the user typed.
"""

from __future__ import annotations

from typing import Any

from pydantic import Field

from app.schemas.common import (
    Choice,
    DateIn,
    DateOnly,
    OptionalStr,
    RequiredDateIn,
    RequestModel,
    RequiredStr,
    ResponseModel,
    TextIn,
    UtcDateTime,
)

# ------------------------------------------------------------------------ currencies


class CurrencyOut(ResponseModel):
    code: str
    symbol: str
    name: str
    minor_units: int
    decimal: int
    group: str


class CurrencyListOut(ResponseModel):
    items: list[CurrencyOut] = Field(default_factory=list)
    total: int = 0


# -------------------------------------------------------------------- exchange rates


class ExchangeRateOut(ResponseModel):
    id: str
    base: str
    quote: str
    rate: float
    as_of: DateOnly
    provider: str | None = None
    age_days: int = 0
    stale: bool = False
    created_at: UtcDateTime
    updated_at: UtcDateTime


class PagedOut(ResponseModel):
    """The list envelope plus the ``limit``/``offset`` echo the paged endpoints promise."""

    items: list[Any] = Field(default_factory=list)
    total: int = 0
    limit: int | None = None
    offset: int | None = None


class ExchangeRateListOut(PagedOut):
    items: list[ExchangeRateOut] = Field(default_factory=list)


class RateCreate(RequestModel):
    base: RequiredStr("base")
    quote: RequiredStr("quote")
    rate: float = Field(gt=0)
    as_of: DateIn = None
    provider: OptionalStr("provider") = None


class RateUpdate(RequestModel):
    base: OptionalStr("base") = None
    quote: OptionalStr("quote") = None
    rate: float | None = Field(default=None, gt=0)
    as_of: DateIn = None
    provider: OptionalStr("provider") = None


class ConvertOut(ResponseModel):
    amount: float
    base: str
    quote: str
    converted: float
    rate: float
    as_of: DateOnly | None = None
    derived: bool = False
    stale: bool = False
    age_days: int | None = None


class RateSyncOut(ResponseModel):
    created: int = 0
    updated: int = 0
    source: str | None = None
    as_of: DateOnly | None = None


# ------------------------------------------------------------------- income profiles


class IncomeProfileOut(ResponseModel):
    id: str
    name: str
    kind: str | None = None
    gross_monthly: float | None = None
    currency: str
    tax_regime: str | None = None
    tax_rate: float | None = None
    slabs: list[dict[str, Any]] = Field(default_factory=list)
    notes: str | None = None
    source: str
    monthly_net: float | None = None
    annual_gross: float | None = None
    effective_tax_rate: float | None = None
    created_at: UtcDateTime
    updated_at: UtcDateTime


class IncomeProfileListOut(ResponseModel):
    items: list[IncomeProfileOut] = Field(default_factory=list)
    total: int = 0


class SlabIn(RequestModel):
    up_to: float | None = None
    rate: float = Field(default=0.0, ge=0, le=100)


class DeductionIn(RequestModel):
    label: OptionalStr("label") = None
    amount: float = Field(default=0.0, ge=0)
    pre_tax: bool = True


class IncomeProfileCreate(RequestModel):
    name: RequiredStr("name")
    currency: RequiredStr("currency")
    kind: Choice("income.kind", "kind") = None
    gross_monthly: float | None = Field(default=None, ge=0)
    tax_regime: Choice("tax.regime", "tax_regime") = None
    tax_rate: float | None = Field(default=None, ge=0, le=100)
    slabs: list[SlabIn] | None = None
    notes: TextIn = None


class IncomeProfileUpdate(RequestModel):
    name: OptionalStr("name") = None
    currency: OptionalStr("currency") = None
    kind: Choice("income.kind", "kind") = None
    gross_monthly: float | None = Field(default=None, ge=0)
    tax_regime: Choice("tax.regime", "tax_regime") = None
    tax_rate: float | None = Field(default=None, ge=0, le=100)
    slabs: list[SlabIn] | None = None
    notes: TextIn = None


class PreviewIn(RequestModel):
    """``POST /income-profiles/preview`` - the calculator's inputs, nothing saved."""

    gross_monthly: float | None = Field(default=None, ge=0)
    gross_annual: float | None = Field(default=None, ge=0)
    #: "monthly" | "annual" - the figure itself decides the axis, so the rule lives in
    #: :func:`app.services.money.take_home`, which 422s anything else on body.period.
    period: str | None = None
    currency: RequiredStr("currency")
    tax_regime: Choice("tax.regime", "tax_regime") = None
    tax_rate: float | None = Field(default=None, ge=0, le=100)
    slabs: list[SlabIn] | None = None
    deductions: list[DeductionIn] | None = None
    other_income: float | None = Field(default=None, ge=0)


class PreviewOut(ResponseModel):
    currency: str
    period: str
    gross: float
    taxable: float
    tax: float
    net: float
    net_monthly: float
    net_annual: float
    effective_tax_rate: float
    #: every slice is a money figure, so it crosses the boundary as a JSON number (§2.2);
    #: ``Any`` here would let pydantic write the service's Decimal as the string "7500.00"
    slab_breakdown: list[dict[str, float]] = Field(default_factory=list)
    deductions_total: float
    warnings: list[str] = Field(default_factory=list)


# -------------------------------------------------------------------------- services


class ServiceOut(ResponseModel):
    id: str
    name: str
    code: str | None = None
    description: str | None = None
    unit: str | None = None
    default_price: float | None = None
    currency: str | None = None
    active: bool = True
    source: str
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ServiceListOut(PagedOut):
    items: list[ServiceOut] = Field(default_factory=list)


class ServicePlanOut(ResponseModel):
    id: str
    service_id: str
    service: dict[str, Any] | None = None
    name: str
    interval: str | None = None
    price: float
    currency: str | None = None
    included_units: float | None = None
    overage_rate: float | None = None
    trial_days: int | None = None
    active: bool = True
    source: str
    monthly_price: float | None = None
    effective_rate: float | None = None
    subscriber_count: int = 0
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ServicePlanListOut(PagedOut):
    items: list[ServicePlanOut] = Field(default_factory=list)


class ServiceRevenueOut(ResponseModel):
    total: float | None = None
    currency: str | None = None
    paid_count: int = 0
    invoiced_amount: float | None = None


class ServiceDetailOut(ServiceOut):
    plans: list[ServicePlanOut] = Field(default_factory=list)
    revenue: ServiceRevenueOut
    utilisation_hours: float | None = None


class ServiceCreate(RequestModel):
    name: RequiredStr("name")
    code: OptionalStr("code") = None
    description: TextIn = None
    unit: Choice("service.unit", "unit") = None
    default_price: float | None = Field(default=None, ge=0)
    currency: OptionalStr("currency") = None
    active: bool = True
    project_template: list[dict[str, Any]] | None = None


class ServiceUpdate(RequestModel):
    name: OptionalStr("name") = None
    code: OptionalStr("code") = None
    description: TextIn = None
    unit: Choice("service.unit", "unit") = None
    default_price: float | None = Field(default=None, ge=0)
    currency: OptionalStr("currency") = None
    active: bool | None = None
    project_template: list[dict[str, Any]] | None = None


class PlanCreate(RequestModel):
    service_id: RequiredStr("service_id")
    name: RequiredStr("name")
    interval: Choice("plan.interval", "interval") = None
    price: float = Field(ge=0)
    currency: OptionalStr("currency") = None
    included_units: float | None = Field(default=None, ge=0)
    overage_rate: float | None = Field(default=None, ge=0)
    trial_days: int | None = Field(default=None, ge=0, le=90)
    active: bool = True


class PlanUpdate(RequestModel):
    service_id: OptionalStr("service_id") = None
    name: OptionalStr("name") = None
    interval: Choice("plan.interval", "interval") = None
    price: float | None = Field(default=None, ge=0)
    currency: OptionalStr("currency") = None
    included_units: float | None = Field(default=None, ge=0)
    overage_rate: float | None = Field(default=None, ge=0)
    trial_days: int | None = Field(default=None, ge=0, le=90)
    active: bool | None = None


# --------------------------------------------------------------------- subscriptions


class SubscriptionOut(ResponseModel):
    id: str
    plan_id: str | None = None
    plan: dict[str, Any] | None = None
    company_id: str | None = None
    label: str
    status: str
    started_on: DateOnly
    renews_on: DateOnly | None = None
    renews_in_days: int | None = None
    cancelled_on: DateOnly | None = None
    price: float
    currency: str
    interval: str | None = None
    monthly_cost: float | None = None
    annual_cost: float | None = None
    invoice_number: str | None = None
    notes: str | None = None
    source: str
    is_running: bool = False
    created_at: UtcDateTime
    updated_at: UtcDateTime


class SubscriptionListOut(PagedOut):
    items: list[SubscriptionOut] = Field(default_factory=list)


class SubscriptionWriteOut(SubscriptionOut):
    """A single subscription response: the row plus the §4 `warnings` block."""

    warnings: list[str] = Field(default_factory=list)


class SubscriptionCreate(RequestModel):
    started_on: RequiredDateIn
    price: float = Field(ge=0)
    currency: RequiredStr("currency")
    plan_id: OptionalStr("plan_id") = None
    company_id: OptionalStr("company_id") = None
    status: Choice("subscription.status", "status") = None
    interval: Choice("plan.interval", "interval") = None
    renews_on: DateIn = None
    cancelled_on: DateIn = None
    invoice_number: OptionalStr("invoice_number") = None
    notes: TextIn = None


class SubscriptionUpdate(RequestModel):
    started_on: DateIn = None
    price: float | None = Field(default=None, ge=0)
    currency: OptionalStr("currency") = None
    plan_id: OptionalStr("plan_id") = None
    company_id: OptionalStr("company_id") = None
    status: Choice("subscription.status", "status") = None
    interval: Choice("plan.interval", "interval") = None
    renews_on: DateIn = None
    cancelled_on: DateIn = None
    invoice_number: OptionalStr("invoice_number") = None
    notes: TextIn = None


# ------------------------------------------------------------ expense categories tree


class ExpenseCategoryOut(ResponseModel):
    id: str
    name: str
    parent_id: str | None = None
    kind: str | None = None
    system_key: str | None = None
    color: str | None = None
    archived: bool = False
    depth: int = 0
    children: list["ExpenseCategoryOut"] = Field(default_factory=list)
    amount_this_month: float | None = None
    currency: str | None = None
    monthly_norm: float | None = None
    expense_count: int = 0
    created_at: UtcDateTime
    updated_at: UtcDateTime


ExpenseCategoryOut.model_rebuild()


class ExpenseCategoryListOut(ResponseModel):
    items: list[ExpenseCategoryOut] = Field(default_factory=list)
    total: int = 0


class CategoryCreate(RequestModel):
    name: RequiredStr("name")
    parent_id: OptionalStr("parent_id") = None
    kind: Choice("expense.category.kind", "kind") = None
    color: OptionalStr("color") = None
    system_key: OptionalStr("system_key") = None
    archived: bool = False


class CategoryUpdate(RequestModel):
    name: OptionalStr("name") = None
    parent_id: OptionalStr("parent_id") = None
    kind: Choice("expense.category.kind", "kind") = None
    color: OptionalStr("color") = None
    archived: bool | None = None


# --------------------------------------------------------------------------- expenses


class ExpenseOut(ResponseModel):
    id: str
    label: str
    amount: float
    currency: str
    paid_on: DateOnly
    recurring: bool = False
    recurrence: str | None = None
    vendor: str | None = None
    invoice_number: str | None = None
    receipt_path: str | None = None
    category_id: str | None = None
    category: dict[str, Any] | None = None
    notes: str | None = None
    monthly_amount: float | None = None
    next_due_on: DateOnly | None = None
    days_until_due: int | None = None
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ExpenseListOut(PagedOut):
    items: list[ExpenseOut] = Field(default_factory=list)


class ExpenseCreate(RequestModel):
    label: RequiredStr("label")
    amount: float = Field(ge=0)
    currency: RequiredStr("currency")
    paid_on: RequiredDateIn
    category_id: OptionalStr("category_id") = None
    recurring: bool = False
    recurrence: Choice("expense.recurrence", "recurrence") = None
    vendor: OptionalStr("vendor") = None
    invoice_number: OptionalStr("invoice_number") = None
    receipt_path: OptionalStr("receipt_path") = None
    notes: TextIn = None


class ExpenseUpdate(RequestModel):
    label: OptionalStr("label") = None
    amount: float | None = Field(default=None, ge=0)
    currency: OptionalStr("currency") = None
    paid_on: DateIn = None
    category_id: OptionalStr("category_id") = None
    recurring: bool | None = None
    recurrence: Choice("expense.recurrence", "recurrence") = None
    vendor: OptionalStr("vendor") = None
    invoice_number: OptionalStr("invoice_number") = None
    receipt_path: OptionalStr("receipt_path") = None
    notes: TextIn = None


class BulkIn(RequestModel):
    ids: list[str] = Field(default_factory=list, max_length=500)
    action: RequiredStr("action")
    value: Any = None


class BulkFailure(ResponseModel):
    id: str
    error: str


class BulkOut(ResponseModel):
    updated: int = 0
    failed: list[BulkFailure] = Field(default_factory=list)
    action: str


class ExpenseCategoryBreakdown(ResponseModel):
    category_id: str | None = None
    name: str
    color: str | None = None
    amount: float | None = None
    count: int = 0


class VendorBreakdown(ResponseModel):
    vendor: str
    amount: float | None = None
    count: int = 0


class CurrencyAmount(ResponseModel):
    currency: str
    amount: float


class ExpenseSeriesPoint(ResponseModel):
    month: str
    total: float | None = None


class TopExpense(ResponseModel):
    id: str
    label: str
    vendor: str | None = None
    amount: float
    currency: str
    paid_on: DateOnly


class ExpenseSummaryOut(ResponseModel):
    month: str
    currency: str | None = None
    total: float | None = None
    count: int = 0
    recurring_monthly: float | None = None
    by_category: list[ExpenseCategoryBreakdown] = Field(default_factory=list)
    by_vendor: list[VendorBreakdown] = Field(default_factory=list)
    by_currency: list[CurrencyAmount] = Field(default_factory=list)
    series: list[ExpenseSeriesPoint] = Field(default_factory=list)
    top_expenses: list[TopExpense] = Field(default_factory=list)


# ------------------------------------------------------------------ income transactions


class IncomeOut(ResponseModel):
    id: str
    label: str
    amount: float
    currency: str
    received_on: DateOnly
    status: str
    method: str | None = None
    invoice_number: str | None = None
    service_id: str | None = None
    service: dict[str, Any] | None = None
    subscription_id: str | None = None
    source: str
    converted_amount: float | None = None
    converted_currency: str | None = None
    converted_at: DateOnly | None = None
    notes: str | None = None
    is_overdue: bool = False
    days_overdue: int = 0
    created_at: UtcDateTime
    updated_at: UtcDateTime


class IncomeListOut(PagedOut):
    items: list[IncomeOut] = Field(default_factory=list)


class IncomeCreate(RequestModel):
    label: RequiredStr("label")
    amount: float
    currency: RequiredStr("currency")
    received_on: RequiredDateIn
    status: Choice("income.status", "status") = None
    method: Choice("income.method", "method") = None
    invoice_number: OptionalStr("invoice_number") = None
    service_id: OptionalStr("service_id") = None
    subscription_id: OptionalStr("subscription_id") = None
    converted_amount: float | None = None
    converted_currency: OptionalStr("converted_currency") = None
    converted_at: DateIn = None
    notes: TextIn = None


class IncomeUpdate(RequestModel):
    label: OptionalStr("label") = None
    amount: float | None = None
    currency: OptionalStr("currency") = None
    received_on: DateIn = None
    status: Choice("income.status", "status") = None
    method: Choice("income.method", "method") = None
    invoice_number: OptionalStr("invoice_number") = None
    service_id: OptionalStr("service_id") = None
    subscription_id: OptionalStr("subscription_id") = None
    converted_amount: float | None = None
    converted_currency: OptionalStr("converted_currency") = None
    converted_at: DateIn = None
    notes: TextIn = None


class IncomeByService(ResponseModel):
    service_id: str | None = None
    name: str | None = None
    amount: float | None = None
    count: int = 0


class IncomeSeriesPoint(ResponseModel):
    month: str
    invoiced: float | None = None
    received: float | None = None


class IncomeSummaryOut(ResponseModel):
    month: str
    currency: str | None = None
    invoiced: float | None = None
    received: float | None = None
    receivables: float | None = None
    overdue: list[IncomeOut] = Field(default_factory=list)
    by_status: dict[str, float | None] = Field(default_factory=dict)
    by_service: list[IncomeByService] = Field(default_factory=list)
    series: list[IncomeSeriesPoint] = Field(default_factory=list)
    by_currency: list[CurrencyAmount] = Field(default_factory=list)
    count: int = 0


# ---------------------------------------------------------------------- cost scenarios


class ScenarioItemOut(ResponseModel):
    id: str
    scenario_id: str
    label: str
    direction: str
    amount: float
    currency: str | None = None
    recurrence: str | None = None
    #: the signed monthly slice the curve uses (derived from the scenario's horizon)
    monthly_amount: float | None = None
    starts_on: DateOnly | None = None
    ends_on: DateOnly | None = None
    category_id: str | None = None
    notes: str | None = None
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ScenarioItemWriteOut(ResponseModel):
    """``GET /cost-scenarios/{id}/items`` keeps the list envelope (§4)."""

    items: list[ScenarioItemOut] = Field(default_factory=list)
    total: int = 0


class ScenarioOut(ResponseModel):
    id: str
    name: str
    kind: str | None = None
    horizon_months: int
    start_month: DateOnly
    currency: str | None = None
    base_income_profile_id: str | None = None
    assumptions: dict[str, Any] = Field(default_factory=dict)
    status: str
    notes: str | None = None
    source: str
    item_count: int = 0
    items: list[ScenarioItemOut] | None = None
    created_at: UtcDateTime
    updated_at: UtcDateTime


class ScenarioListOut(ResponseModel):
    items: list[ScenarioOut] = Field(default_factory=list)
    total: int = 0


class ScenarioCreate(RequestModel):
    name: RequiredStr("name")
    start_month: RequiredDateIn
    horizon_months: int = Field(default=12, ge=1, le=120)
    kind: Choice("scenario.kind", "kind") = None
    currency: OptionalStr("currency") = None
    base_income_profile_id: OptionalStr("base_income_profile_id") = None
    assumptions: dict[str, Any] | None = None
    status: Choice("scenario.status", "status") = None
    notes: TextIn = None


class ScenarioUpdate(RequestModel):
    name: OptionalStr("name") = None
    start_month: DateIn = None
    horizon_months: int | None = Field(default=None, ge=1, le=120)
    kind: Choice("scenario.kind", "kind") = None
    currency: OptionalStr("currency") = None
    base_income_profile_id: OptionalStr("base_income_profile_id") = None
    assumptions: dict[str, Any] | None = None
    status: Choice("scenario.status", "status") = None
    notes: TextIn = None


class ItemCreate(RequestModel):
    label: RequiredStr("label")
    amount: float = Field(ge=0)
    direction: Choice("scenario.item.direction", "direction") = None
    currency: OptionalStr("currency") = None
    recurrence: OptionalStr("recurrence") = None
    starts_on: DateIn = None
    ends_on: DateIn = None
    category_id: OptionalStr("category_id") = None
    scenario_id: OptionalStr("scenario_id") = None
    notes: TextIn = None


class ItemUpdate(RequestModel):
    label: OptionalStr("label") = None
    amount: float | None = Field(default=None, ge=0)
    direction: Choice("scenario.item.direction", "direction") = None
    currency: OptionalStr("currency") = None
    recurrence: OptionalStr("recurrence") = None
    starts_on: DateIn = None
    ends_on: DateIn = None
    category_id: OptionalStr("category_id") = None
    scenario_id: OptionalStr("scenario_id") = None
    notes: TextIn = None


class ProjectionMonth(ResponseModel):
    month: str
    income: float | None = None
    cost: float | None = None
    net: float | None = None
    cumulative: float | None = None


class ProjectionTotals(ResponseModel):
    income: float | None = None
    cost: float | None = None
    net: float | None = None


class ProjectionOut(ResponseModel):
    scenario: ScenarioOut
    currency: str | None = None
    horizon_months: int = 0
    months: list[ProjectionMonth] = Field(default_factory=list)
    totals: ProjectionTotals
    break_even_month: str | None = None
    runway_months: float | None = None
    assumptions: dict[str, Any] = Field(default_factory=dict)


class DuplicateOut(ResponseModel):
    scenario: ScenarioOut
    copied_items: int = 0


class ActivateOut(ResponseModel):
    scenario: ScenarioOut
    archived: dict[str, Any] | None = None


class CompareCurve(ResponseModel):
    income: float | None = None
    cost: float | None = None
    net: float | None = None
    cumulative: float | None = None
    in_horizon: bool = True


class CompareMonth(ResponseModel):
    month: str
    a: CompareCurve
    b: CompareCurve
    delta: float | None = None


class CompareOut(ResponseModel):
    currency: str | None = None
    a: ScenarioOut
    b: ScenarioOut
    months: list[CompareMonth] = Field(default_factory=list)
    totals: dict[str, ProjectionTotals] = Field(default_factory=dict)
    break_even: dict[str, str | None] = Field(default_factory=dict)


# -------------------------------------------------------------------- finance overview


class OverviewMonth(ResponseModel):
    month: str
    income: float | None = None
    expense: float | None = None
    net: float | None = None


class OverviewCategory(ResponseModel):
    category_id: str | None = None
    name: str
    color: str | None = None
    amount: float | None = None
    share: float | None = None


class Renewal(ResponseModel):
    id: str
    label: str
    amount: float
    currency: str
    renews_on: DateOnly
    days_until: int


class CurrencyExposure(ResponseModel):
    currency: str
    income: float
    expense: float


class StaleRate(ResponseModel):
    base: str
    quote: str
    as_of: DateOnly
    age_days: int


class OverviewCounts(ResponseModel):
    expenses: int = 0
    income: int = 0
    subscriptions: int = 0
    services: int = 0
    scenarios: int = 0


class FinanceSummaryOut(ResponseModel):
    currency: str | None = None
    month: str
    income: float | None = None
    expense: float | None = None
    net: float | None = None
    monthly_income_avg_3m: float | None = None
    monthly_burn: float | None = None
    runway_months: float | None = None
    mrr: float | None = None
    arr: float | None = None
    receivables: float | None = None
    overdue_income: float | None = None
    cash_in_90d: float | None = None
    income_by_month: list[OverviewMonth] = Field(default_factory=list)
    expense_by_category: list[OverviewCategory] = Field(default_factory=list)
    top_vendors: list[VendorBreakdown] = Field(default_factory=list)
    renewing_this_month: list[Renewal] = Field(default_factory=list)
    by_currency: list[CurrencyExposure] = Field(default_factory=list)
    stale_rates: list[StaleRate] = Field(default_factory=list)
    counts: OverviewCounts


__all__ = [
    "ActivateOut",
    "BulkIn",
    "BulkOut",
    "CategoryCreate",
    "CategoryUpdate",
    "CompareOut",
    "ConvertOut",
    "CurrencyListOut",
    "CurrencyOut",
    "DuplicateOut",
    "ExpenseCategoryListOut",
    "ExpenseCategoryOut",
    "ExpenseCreate",
    "ExpenseListOut",
    "ExpenseOut",
    "ExpenseSummaryOut",
    "ExpenseUpdate",
    "FinanceSummaryOut",
    "IncomeCreate",
    "IncomeListOut",
    "IncomeOut",
    "IncomeProfileCreate",
    "IncomeProfileListOut",
    "IncomeProfileOut",
    "IncomeProfileUpdate",
    "IncomeSummaryOut",
    "IncomeUpdate",
    "ItemCreate",
    "ItemUpdate",
    "PlanCreate",
    "PlanUpdate",
    "PreviewIn",
    "PreviewOut",
    "ProjectionOut",
    "RateCreate",
    "RateSyncOut",
    "RateUpdate",
    "ScenarioCreate",
    "ScenarioItemWriteOut",
    "ScenarioListOut",
    "ScenarioOut",
    "ScenarioUpdate",
    "ServiceCreate",
    "ServiceDetailOut",
    "ServiceListOut",
    "ServiceOut",
    "ServicePlanListOut",
    "ServicePlanOut",
    "ServiceUpdate",
    "SubscriptionCreate",
    "SubscriptionListOut",
    "SubscriptionOut",
    "SubscriptionUpdate",
    "SubscriptionWriteOut",
]
