"""Phase 3 — Finance tables (DATA_MODEL.md §13).

Two schema-wide choices live here rather than in the services:

* ``MONEY``/``RATE`` are the only numeric types in this module. Money is
  ``NUMERIC(14,2)`` and rates ``NUMERIC(18,6)`` because SQLite stores a Numeric as
  TEXT and PostgreSQL as ``numeric``; keeping the precision in one place per role is
  what makes the Postgres port a no-op (§11).
* Every enum column gets an ``enum_check`` *except* ``subscriptions.interval`` and
  ``cost_scenario_items.recurrence``: §13 documents no CHECK for them, so the services
  validate them against the documented value sets exactly like ``currency``, which is a
  registry and not a constraint.

Deliberate deviations from §13 are listed in PHASE3_FINANCE.md §8: ``clients`` is a
Phase 2 table, so ``subscriptions.client_id`` and ``income_transactions.client_id`` are
not created here — they arrive with their own migration in Phase 2 instead of being
reverse-engineered later.
"""

from __future__ import annotations

import datetime as dt
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.core.utils import new_id
from app.models.base import (
    ID_COLUMN,
    SourceMixin,
    TimestampMixin,
    enum_check,
    non_negative,
    range_check,
)
from app.models.enums import (
    ExpenseRecurrence,
    IncomeKind,
    IncomeStatus,
    PlanInterval,
    ScenarioDirection,
    ScenarioKind,
    ScenarioStatus,
    ServiceUnit,
    SubscriptionStatus,
    TaxRegime,
)

#: the two numeric roles of the finance schema (see the module docstring)
MONEY = sa.Numeric(14, 2)
RATE = sa.Numeric(18, 6)
#: ISO-4217 codes are 3 letters; 8 leaves room for the pre-multiplier forms the docs allow
CURRENCY_COLUMN = sa.String(8)


class IncomeProfile(Base, TimestampMixin, SourceMixin):
    """Inputs for the income calculator — results are never stored (PHASE3_FINANCE §4)."""

    __tablename__ = "income_profiles"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "name", name="workspace_name"),
        enum_check("kind", "income.kind"),
        enum_check("tax_regime", "tax.regime"),
        non_negative("gross_monthly"),
        range_check("tax_rate", 0, 100),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    kind: Mapped[str | None] = mapped_column(sa.String(24), default=IncomeKind.SALARY.value)
    gross_monthly: Mapped[Decimal | None] = mapped_column(MONEY)
    currency: Mapped[str] = mapped_column(CURRENCY_COLUMN, nullable=False)
    tax_regime: Mapped[str | None] = mapped_column(sa.String(24), default=TaxRegime.NONE.value)
    tax_rate: Mapped[Decimal | None] = mapped_column(sa.Numeric(5, 2))
    #: ``[{up_to: number|null, rate: number}]``; null up_to terminates the top slab
    slabs: Mapped[list[dict[str, object]] | None] = mapped_column(sa.JSON)
    notes: Mapped[str | None] = mapped_column(sa.Text)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<IncomeProfile {self.name}:{self.kind}>"


class ExchangeRate(Base, TimestampMixin):
    """One point of a currency pair's history. No ``source`` column (§13) — demo rows are
    identified by ``provider == 'demo'`` so ``POST /demo/reset`` can still find them."""

    __tablename__ = "exchange_rates"
    __table_args__ = (
        # the UNIQUE is also the lookup index for ``MAX(as_of) <= date`` on a pair,
        # so this table needs no second composite index (§10: no index without a query)
        sa.UniqueConstraint("workspace_id", "base", "quote", "as_of", name="workspace_pair_date"),
        sa.CheckConstraint("base <> quote", name="pair_is_not_empty"),
        sa.CheckConstraint("rate > 0", name="rate_positive"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    base: Mapped[str] = mapped_column(CURRENCY_COLUMN, nullable=False)
    quote: Mapped[str] = mapped_column(CURRENCY_COLUMN, nullable=False)
    rate: Mapped[Decimal] = mapped_column(RATE, nullable=False)
    as_of: Mapped[dt.date] = mapped_column(sa.Date, nullable=False)
    provider: Mapped[str | None] = mapped_column(sa.String(24))

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<ExchangeRate {self.base}{self.quote} {self.as_of}>"


class Service(Base, TimestampMixin, SourceMixin):
    """What can be sold, priced per unit."""

    __tablename__ = "services"
    __table_args__ = (
        sa.UniqueConstraint("workspace_id", "code", name="workspace_code"),
        enum_check("unit", "service.unit"),
        non_negative("default_price"),
        sa.Index("ix_services_workspace_active", "workspace_id", "active"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(160), nullable=False)
    code: Mapped[str | None] = mapped_column(sa.String(32))
    description: Mapped[str | None] = mapped_column(sa.Text)
    unit: Mapped[str | None] = mapped_column(sa.String(16), default=ServiceUnit.HOUR.value)
    default_price: Mapped[Decimal | None] = mapped_column(MONEY)
    currency: Mapped[str | None] = mapped_column(CURRENCY_COLUMN)
    active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)
    #: the task breakdown to clone when this service is sold; no Phase 3 payload reads or
    #: writes it (PHASE3_FINANCE.md §4 does not list it), so it stays a stored column
    #: until the editor that fills it lands
    project_template: Mapped[list[dict[str, object]] | None] = mapped_column(sa.JSON)

    plans: Mapped[list["ServicePlan"]] = relationship(
        back_populates="service", cascade="all, delete-orphan", passive_deletes=True
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Service {self.name}>"


class ServicePlan(Base, TimestampMixin, SourceMixin):
    """A named package on top of a service."""

    __tablename__ = "service_plans"
    __table_args__ = (
        enum_check("interval", "plan.interval"),
        non_negative("price"),
        non_negative("included_units"),
        non_negative("overage_rate"),
        range_check("trial_days", 0, 90),
        sa.Index("ix_service_plans_workspace_service_interval", "workspace_id", "service_id", "interval"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    service_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("services.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(160), nullable=False)
    interval: Mapped[str | None] = mapped_column(sa.String(16), default=PlanInterval.MONTHLY.value)
    price: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    currency: Mapped[str | None] = mapped_column(CURRENCY_COLUMN)
    included_units: Mapped[Decimal | None] = mapped_column(sa.Numeric(8, 2))
    overage_rate: Mapped[Decimal | None] = mapped_column(MONEY)
    trial_days: Mapped[int | None] = mapped_column(sa.Integer)
    active: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=True)

    service: Mapped[Service] = relationship(back_populates="plans")

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<ServicePlan {self.name}:{self.interval}>"


class Subscription(Base, TimestampMixin, SourceMixin):
    """A recurring commitment — bought from the catalogue or logged by hand.

    ``plan_id`` is SET NULL on purpose: subscription history must outlive a retired plan.
    """

    __tablename__ = "subscriptions"
    __table_args__ = (
        enum_check("status", "subscription.status"),
        non_negative("price"),
        sa.Index("ix_subscriptions_workspace_status_renews", "workspace_id", "status", "renews_on"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    plan_id: Mapped[str | None] = mapped_column(
        ID_COLUMN, sa.ForeignKey("service_plans.id", ondelete="SET NULL"), index=True
    )
    # client_id arrives with the Phase 2 `clients` table (PHASE3_FINANCE.md §8)
    company_id: Mapped[str | None] = mapped_column(
        ID_COLUMN, sa.ForeignKey("companies.id", ondelete="SET NULL"), index=True
    )
    status: Mapped[str] = mapped_column(
        sa.String(16), nullable=False, default=SubscriptionStatus.ACTIVE.value
    )
    started_on: Mapped[dt.date] = mapped_column(sa.Date, nullable=False)
    renews_on: Mapped[dt.date | None] = mapped_column(sa.Date)
    cancelled_on: Mapped[dt.date | None] = mapped_column(sa.Date)
    price: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    currency: Mapped[str] = mapped_column(CURRENCY_COLUMN, nullable=False)
    #: validated against ``plan.interval`` in the service, not by a CHECK (§13)
    interval: Mapped[str | None] = mapped_column(sa.String(16), default=PlanInterval.MONTHLY.value)
    invoice_number: Mapped[str | None] = mapped_column(sa.String(40))
    notes: Mapped[str | None] = mapped_column(sa.Text)

    plan: Mapped[ServicePlan | None] = relationship(passive_deletes=True)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Subscription {self.status}:{self.currency} {self.price}>"


class ExpenseCategory(Base, TimestampMixin):
    """Tree of spending buckets. No ``source`` column (§13): the seeded presets are
    identified by ``system_key``, which makes them idempotent without a wipe flag."""

    __tablename__ = "expense_categories"
    __table_args__ = (
        # SQLite/Postgres both treat NULLs as distinct in a unique index, so top-level
        # names are de-duplicated by the service as well (services/expenses.py).
        sa.UniqueConstraint("workspace_id", "name", "parent_id", name="workspace_name_parent"),
        sa.CheckConstraint("parent_id <> id", name="parent_not_self"),
        enum_check("kind", "expense.category.kind"),
        sa.Index("ix_expense_categories_workspace_parent", "workspace_id", "parent_id"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(120), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(
        ID_COLUMN, sa.ForeignKey("expense_categories.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str | None] = mapped_column(sa.String(16))
    #: stable key for seeded rows (``rent``, ``software``, …) so presets are idempotent
    system_key: Mapped[str | None] = mapped_column(sa.String(48))
    #: 12-char hex used for the category dot on screen; never part of a calculation (§8)
    color: Mapped[str | None] = mapped_column(sa.String(16))
    archived: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)

    children: Mapped[list["ExpenseCategory"]] = relationship(
        back_populates="parent", passive_deletes=True
    )
    parent: Mapped["ExpenseCategory | None"] = relationship(
        back_populates="children", remote_side="ExpenseCategory.id", passive_deletes=True
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<ExpenseCategory {self.name}>"


class Expense(Base, TimestampMixin, SourceMixin):
    """Logged spend. ``recurring`` and ``recurrence`` must agree — checked in the service."""

    __tablename__ = "expenses"
    __table_args__ = (
        enum_check("recurrence", "expense.recurrence"),
        non_negative("amount"),
        sa.Index("ix_expenses_workspace_paid_on", "workspace_id", "paid_on"),
        sa.Index("ix_expenses_workspace_category", "workspace_id", "category_id"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category_id: Mapped[str | None] = mapped_column(
        ID_COLUMN, sa.ForeignKey("expense_categories.id", ondelete="SET NULL"), index=True
    )
    label: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    currency: Mapped[str] = mapped_column(CURRENCY_COLUMN, nullable=False)
    paid_on: Mapped[dt.date] = mapped_column(sa.Date, nullable=False)
    recurring: Mapped[bool] = mapped_column(sa.Boolean, nullable=False, default=False)
    recurrence: Mapped[str | None] = mapped_column(
        sa.String(16), default=ExpenseRecurrence.NONE.value
    )
    vendor: Mapped[str | None] = mapped_column(sa.String(160))
    invoice_number: Mapped[str | None] = mapped_column(sa.String(40))
    #: a path under MYOS_DATA_DIR — the blob never lives in the row
    receipt_path: Mapped[str | None] = mapped_column(sa.String(500))
    notes: Mapped[str | None] = mapped_column(sa.Text)

    category: Mapped[ExpenseCategory | None] = relationship(passive_deletes=True)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Expense {self.label} {self.amount} {self.currency}>"


class IncomeTransaction(Base, TimestampMixin, SourceMixin):
    """Every inflow, invoiced or not.

    ``converted_*`` is an all-or-none triple: the original amount is never overwritten,
    so a rate correction cannot silently rewrite history (§2.3).
    """

    __tablename__ = "income_transactions"
    __table_args__ = (
        enum_check("status", "income.status"),
        enum_check("method", "income.method"),
        non_negative("amount"),
        sa.Index("ix_income_transactions_workspace_received_on", "workspace_id", "received_on"),
        sa.Index("ix_income_transactions_workspace_status", "workspace_id", "status"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # client_id arrives with the Phase 2 `clients` table (PHASE3_FINANCE.md §8)
    subscription_id: Mapped[str | None] = mapped_column(
        ID_COLUMN, sa.ForeignKey("subscriptions.id", ondelete="SET NULL"), index=True
    )
    service_id: Mapped[str | None] = mapped_column(
        ID_COLUMN, sa.ForeignKey("services.id", ondelete="SET NULL"), index=True
    )
    label: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    currency: Mapped[str] = mapped_column(CURRENCY_COLUMN, nullable=False)
    received_on: Mapped[dt.date] = mapped_column(sa.Date, nullable=False)
    status: Mapped[str] = mapped_column(
        sa.String(16), nullable=False, default=IncomeStatus.EXPECTED.value
    )
    invoice_number: Mapped[str | None] = mapped_column(sa.String(40))
    method: Mapped[str | None] = mapped_column(sa.String(16))
    converted_amount: Mapped[Decimal | None] = mapped_column(MONEY)
    converted_currency: Mapped[str | None] = mapped_column(CURRENCY_COLUMN)
    converted_at: Mapped[dt.date | None] = mapped_column(sa.Date)
    notes: Mapped[str | None] = mapped_column(sa.Text)

    subscription: Mapped[Subscription | None] = relationship(passive_deletes=True)
    service: Mapped[Service | None] = relationship(passive_deletes=True)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<IncomeTransaction {self.label} {self.amount} {self.currency}>"


class CostScenario(Base, TimestampMixin, SourceMixin):
    """A plan whose curve is recomputed from its items on every read — never stored."""

    __tablename__ = "cost_scenarios"
    __table_args__ = (
        enum_check("kind", "scenario.kind"),
        enum_check("status", "scenario.status"),
        range_check("horizon_months", 1, 120),
        sa.Index("ix_cost_scenarios_workspace_status", "workspace_id", "status"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(sa.String(140), nullable=False)
    kind: Mapped[str | None] = mapped_column(sa.String(16), default=ScenarioKind.PERSONAL.value)
    horizon_months: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=12)
    start_month: Mapped[dt.date] = mapped_column(sa.Date, nullable=False)
    currency: Mapped[str | None] = mapped_column(CURRENCY_COLUMN)
    #: a scenario keeps its own rows: deleting a profile only un-links it (§8 of DATA_MODEL)
    base_income_profile_id: Mapped[str | None] = mapped_column(
        ID_COLUMN, sa.ForeignKey("income_profiles.id", ondelete="SET NULL"), index=True
    )
    #: ``{inflation: 0.06, tax_rate: 0.2, …}`` — free-form, shown in the projection echo
    assumptions: Mapped[dict[str, object] | None] = mapped_column(sa.JSON)
    status: Mapped[str] = mapped_column(
        sa.String(12), nullable=False, default=ScenarioStatus.DRAFT.value
    )
    notes: Mapped[str | None] = mapped_column(sa.Text)

    items: Mapped[list["CostScenarioItem"]] = relationship(
        back_populates="scenario", cascade="all, delete-orphan", passive_deletes=True
    )
    base_income_profile: Mapped[IncomeProfile | None] = relationship(passive_deletes=True)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<CostScenario {self.name}:{self.status}>"


class CostScenarioItem(Base, TimestampMixin):
    """One line of a scenario. No ``source`` column (§13): items are wiped with their
    scenario by ``ON DELETE CASCADE``, which is what ``POST /demo/reset`` relies on."""

    __tablename__ = "cost_scenario_items"
    __table_args__ = (
        enum_check("direction", "scenario.item.direction"),
        non_negative("amount"),
        sa.CheckConstraint("ends_on IS NULL OR ends_on >= starts_on", name="date_order"),
        sa.Index("ix_cost_scenario_items_scenario_starts", "scenario_id", "starts_on"),
    )

    id: Mapped[str] = mapped_column(ID_COLUMN, primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scenario_id: Mapped[str] = mapped_column(
        ID_COLUMN, sa.ForeignKey("cost_scenarios.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(sa.String(200), nullable=False)
    direction: Mapped[str] = mapped_column(
        sa.String(8), nullable=False, default=ScenarioDirection.COST.value
    )
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    currency: Mapped[str | None] = mapped_column(CURRENCY_COLUMN)
    #: weekly/monthly/quarterly/yearly/one_time — validated in the service (§13 has no CHECK)
    recurrence: Mapped[str | None] = mapped_column(sa.String(16))
    starts_on: Mapped[dt.date | None] = mapped_column(sa.Date)
    ends_on: Mapped[dt.date | None] = mapped_column(sa.Date)
    category_id: Mapped[str | None] = mapped_column(
        ID_COLUMN, sa.ForeignKey("expense_categories.id", ondelete="SET NULL"), index=True
    )
    notes: Mapped[str | None] = mapped_column(sa.Text)

    scenario: Mapped[CostScenario] = relationship(back_populates="items")

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<CostScenarioItem {self.label}:{self.direction}>"
