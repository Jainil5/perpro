"""Phase 3 — Finance: the ten tables of DATA_MODEL.md §13, plus the wider notification CHECK.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-27 09:04:10

Purely additive except for one rebuild: ``notifications.kind`` gains the four Finance kinds
(PHASE3_FINANCE.md §6), and the CHECK written by 0001 would reject them. SQLite cannot alter
a constraint, so ``op.batch_alter_table`` rebuilds ``notifications`` in a copy-and-swap that
leaves every existing row and id in place; on PostgreSQL the same two lines become
``DROP CONSTRAINT`` + ``ADD CONSTRAINT``.

The schema deviations are the ones documented in PHASE3_FINANCE.md §8: ``clients`` is a Phase 2
table, so ``subscriptions.client_id`` and ``income_transactions.client_id`` are *not* created
here (they arrive with Phase 2's own revision rather than being reverse-engineered later), and
``exchange_rates`` / ``expense_categories`` / ``cost_scenario_items`` have no ``source`` column
because §13 does not list one — which is why ``app/services/demo.py`` removes their rows by
``provider``, by ``system_key`` and by cascading scenario delete respectively.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

#: the notification kinds Phase 3 adds; 0001's CHECK does not know them and must be replaced
_PHASE_3_KINDS = (
    "subscription_renewing",
    "expense_recurring_due",
    "income_overdue",
    "rate_stale",
)
_PHASE_1_KINDS = ("task_overdue", "task_due", "milestone", "reminder", "project_stalled", "system")

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- rates and the money spine -------------------------------------------
    op.create_table(
        "exchange_rates",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("base", sa.String(length=8), nullable=False),
        sa.Column("quote", sa.String(length=8), nullable=False),
        sa.Column("rate", sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.Column("provider", sa.String(length=24), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("base <> quote", name=op.f("ck_exchange_rates_pair_is_not_empty")),
        sa.CheckConstraint("rate > 0", name=op.f("ck_exchange_rates_rate_positive")),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], name=op.f("fk_exchange_rates_workspace_id_workspaces"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_exchange_rates")),
        # the UNIQUE also serves the MAX(as_of) <= date lookup, so no second index is needed
        sa.UniqueConstraint("workspace_id", "base", "quote", "as_of", name="workspace_pair_date"),
    )
    with op.batch_alter_table("exchange_rates", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_exchange_rates_workspace_id"), ["workspace_id"], unique=False)

    op.create_table(
        "expense_categories",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("parent_id", sa.String(length=36), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=True),
        sa.Column("system_key", sa.String(length=48), nullable=True),
        sa.Column("color", sa.String(length=16), nullable=True),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("kind IN ('fixed', 'variable', 'one_off', 'tax')", name=op.f("ck_expense_categories_kind")),
        sa.CheckConstraint("parent_id <> id", name=op.f("ck_expense_categories_parent_not_self")),
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["expense_categories.id"],
            name=op.f("fk_expense_categories_parent_id_expense_categories"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_expense_categories_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_expense_categories")),
        sa.UniqueConstraint("workspace_id", "name", "parent_id", name="workspace_name_parent"),
    )
    with op.batch_alter_table("expense_categories", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_expense_categories_parent_id"), ["parent_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_expense_categories_workspace_id"), ["workspace_id"], unique=False)
        batch_op.create_index("ix_expense_categories_workspace_parent", ["workspace_id", "parent_id"], unique=False)

    op.create_table(
        "income_profiles",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=True),
        sa.Column("gross_monthly", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("tax_regime", sa.String(length=24), nullable=True),
        sa.Column("tax_rate", sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column("slabs", sa.JSON(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "source",
            sa.String(length=16),
            nullable=False,
            comment="origin of the row; 'demo' rows are the only ones /demo/reset removes",
        ),
        sa.CheckConstraint(
            "kind IN ('salary', 'freelance', 'contract', 'business', 'mixed')", name=op.f("ck_income_profiles_kind")
        ),
        sa.CheckConstraint(
            "tax_regime IN ('none', 'flat', 'slab', 'presumptive')", name=op.f("ck_income_profiles_tax_regime")
        ),
        sa.CheckConstraint(
            "gross_monthly >= 0", name=op.f("ck_income_profiles_gross_monthly_non_negative")
        ),
        sa.CheckConstraint("tax_rate BETWEEN 0 AND 100", name=op.f("ck_income_profiles_tax_rate_range")),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_income_profiles_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_income_profiles")),
        sa.UniqueConstraint("workspace_id", "name", name="workspace_name"),
    )
    with op.batch_alter_table("income_profiles", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_income_profiles_source"), ["source"], unique=False)
        batch_op.create_index(batch_op.f("ix_income_profiles_workspace_id"), ["workspace_id"], unique=False)

    # --- the catalogue and what sells on it ----------------------------------
    op.create_table(
        "services",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("unit", sa.String(length=16), nullable=True),
        sa.Column("default_price", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("currency", sa.String(length=8), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("project_template", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "source",
            sa.String(length=16),
            nullable=False,
            comment="origin of the row; 'demo' rows are the only ones /demo/reset removes",
        ),
        sa.CheckConstraint(
            "unit IN ('hour', 'day', 'fixed', 'retainer', 'seat')", name=op.f("ck_services_unit")
        ),
        sa.CheckConstraint("default_price >= 0", name=op.f("ck_services_default_price_non_negative")),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], name=op.f("fk_services_workspace_id_workspaces"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_services")),
        sa.UniqueConstraint("workspace_id", "code", name="workspace_code"),
    )
    with op.batch_alter_table("services", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_services_source"), ["source"], unique=False)
        batch_op.create_index("ix_services_workspace_active", ["workspace_id", "active"], unique=False)
        batch_op.create_index(batch_op.f("ix_services_workspace_id"), ["workspace_id"], unique=False)

    op.create_table(
        "service_plans",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("service_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("interval", sa.String(length=16), nullable=True),
        sa.Column("price", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=True),
        sa.Column("included_units", sa.Numeric(precision=8, scale=2), nullable=True),
        sa.Column("overage_rate", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("trial_days", sa.Integer(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "source",
            sa.String(length=16),
            nullable=False,
            comment="origin of the row; 'demo' rows are the only ones /demo/reset removes",
        ),
        sa.CheckConstraint(
            "interval IN ('monthly', 'quarterly', 'yearly', 'one_time')", name=op.f("ck_service_plans_interval")
        ),
        sa.CheckConstraint("included_units >= 0", name=op.f("ck_service_plans_included_units_non_negative")),
        sa.CheckConstraint("overage_rate >= 0", name=op.f("ck_service_plans_overage_rate_non_negative")),
        sa.CheckConstraint("price >= 0", name=op.f("ck_service_plans_price_non_negative")),
        sa.CheckConstraint("trial_days BETWEEN 0 AND 90", name=op.f("ck_service_plans_trial_days_range")),
        sa.ForeignKeyConstraint(
            ["service_id"], ["services.id"], name=op.f("fk_service_plans_service_id_services"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_service_plans_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_service_plans")),
    )
    with op.batch_alter_table("service_plans", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_service_plans_service_id"), ["service_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_service_plans_source"), ["source"], unique=False)
        batch_op.create_index(batch_op.f("ix_service_plans_workspace_id"), ["workspace_id"], unique=False)
        batch_op.create_index(
            "ix_service_plans_workspace_service_interval", ["workspace_id", "service_id", "interval"], unique=False
        )

    op.create_table(
        "subscriptions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("plan_id", sa.String(length=36), nullable=True),
        # client_id is not here: `clients` arrives with Phase 2 (PHASE3_FINANCE.md §8)
        sa.Column("company_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("started_on", sa.Date(), nullable=False),
        sa.Column("renews_on", sa.Date(), nullable=True),
        sa.Column("cancelled_on", sa.Date(), nullable=True),
        sa.Column("price", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("interval", sa.String(length=16), nullable=True),
        sa.Column("invoice_number", sa.String(length=40), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "source",
            sa.String(length=16),
            nullable=False,
            comment="origin of the row; 'demo' rows are the only ones /demo/reset removes",
        ),
        sa.CheckConstraint(
            "status IN ('trialing', 'active', 'paused', 'cancelled', 'expired')",
            name=op.f("ck_subscriptions_status"),
        ),
        sa.CheckConstraint("price >= 0", name=op.f("ck_subscriptions_price_non_negative")),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], name=op.f("fk_subscriptions_company_id_companies"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["plan_id"], ["service_plans.id"], name=op.f("fk_subscriptions_plan_id_service_plans"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_subscriptions_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_subscriptions")),
    )
    with op.batch_alter_table("subscriptions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_subscriptions_company_id"), ["company_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_subscriptions_plan_id"), ["plan_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_subscriptions_source"), ["source"], unique=False)
        batch_op.create_index(batch_op.f("ix_subscriptions_workspace_id"), ["workspace_id"], unique=False)
        batch_op.create_index(
            "ix_subscriptions_workspace_status_renews", ["workspace_id", "status", "renews_on"], unique=False
        )

    # --- the ledgers ---------------------------------------------------------
    op.create_table(
        "expenses",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("category_id", sa.String(length=36), nullable=True),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("paid_on", sa.Date(), nullable=False),
        sa.Column("recurring", sa.Boolean(), nullable=False),
        sa.Column("recurrence", sa.String(length=16), nullable=True),
        sa.Column("vendor", sa.String(length=160), nullable=True),
        sa.Column("invoice_number", sa.String(length=40), nullable=True),
        sa.Column("receipt_path", sa.String(length=500), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "source",
            sa.String(length=16),
            nullable=False,
            comment="origin of the row; 'demo' rows are the only ones /demo/reset removes",
        ),
        sa.CheckConstraint(
            "recurrence IN ('none', 'weekly', 'monthly', 'quarterly', 'yearly')", name=op.f("ck_expenses_recurrence")
        ),
        sa.CheckConstraint("amount >= 0", name=op.f("ck_expenses_amount_non_negative")),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["expense_categories.id"],
            name=op.f("fk_expenses_category_id_expense_categories"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], name=op.f("fk_expenses_workspace_id_workspaces"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_expenses")),
    )
    with op.batch_alter_table("expenses", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_expenses_category_id"), ["category_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_expenses_source"), ["source"], unique=False)
        batch_op.create_index("ix_expenses_workspace_category", ["workspace_id", "category_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_expenses_workspace_id"), ["workspace_id"], unique=False)
        batch_op.create_index("ix_expenses_workspace_paid_on", ["workspace_id", "paid_on"], unique=False)

    op.create_table(
        "income_transactions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        # client_id is not here: `clients` arrives with Phase 2 (PHASE3_FINANCE.md §8)
        sa.Column("subscription_id", sa.String(length=36), nullable=True),
        sa.Column("service_id", sa.String(length=36), nullable=True),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=False),
        sa.Column("received_on", sa.Date(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("invoice_number", sa.String(length=40), nullable=True),
        sa.Column("method", sa.String(length=16), nullable=True),
        sa.Column("converted_amount", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("converted_currency", sa.String(length=8), nullable=True),
        sa.Column("converted_at", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "source",
            sa.String(length=16),
            nullable=False,
            comment="origin of the row; 'demo' rows are the only ones /demo/reset removes",
        ),
        sa.CheckConstraint(
            "method IN ('bank', 'card', 'upi', 'cash', 'crypto', 'other')", name=op.f("ck_income_transactions_method")
        ),
        sa.CheckConstraint(
            "status IN ('expected', 'invoiced', 'paid', 'overdue', 'written_off')",
            name=op.f("ck_income_transactions_status"),
        ),
        sa.CheckConstraint("amount >= 0", name=op.f("ck_income_transactions_amount_non_negative")),
        sa.ForeignKeyConstraint(
            ["service_id"], ["services.id"], name=op.f("fk_income_transactions_service_id_services"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["subscription_id"],
            ["subscriptions.id"],
            name=op.f("fk_income_transactions_subscription_id_subscriptions"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_income_transactions_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_income_transactions")),
    )
    with op.batch_alter_table("income_transactions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_income_transactions_service_id"), ["service_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_income_transactions_source"), ["source"], unique=False)
        batch_op.create_index(batch_op.f("ix_income_transactions_subscription_id"), ["subscription_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_income_transactions_workspace_id"), ["workspace_id"], unique=False)
        batch_op.create_index(
            "ix_income_transactions_workspace_received_on", ["workspace_id", "received_on"], unique=False
        )
        batch_op.create_index("ix_income_transactions_workspace_status", ["workspace_id", "status"], unique=False)

    # --- scenarios -----------------------------------------------------------
    op.create_table(
        "cost_scenarios",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=140), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=True),
        sa.Column("horizon_months", sa.Integer(), nullable=False),
        sa.Column("start_month", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=True),
        sa.Column("base_income_profile_id", sa.String(length=36), nullable=True),
        sa.Column("assumptions", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "source",
            sa.String(length=16),
            nullable=False,
            comment="origin of the row; 'demo' rows are the only ones /demo/reset removes",
        ),
        sa.CheckConstraint("kind IN ('personal', 'business', 'hybrid')", name=op.f("ck_cost_scenarios_kind")),
        sa.CheckConstraint(
            "status IN ('draft', 'active', 'archived')", name=op.f("ck_cost_scenarios_status")
        ),
        sa.CheckConstraint(
            "horizon_months BETWEEN 1 AND 120", name=op.f("ck_cost_scenarios_horizon_months_range")
        ),
        sa.ForeignKeyConstraint(
            ["base_income_profile_id"],
            ["income_profiles.id"],
            name=op.f("fk_cost_scenarios_base_income_profile_id_income_profiles"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_cost_scenarios_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cost_scenarios")),
    )
    with op.batch_alter_table("cost_scenarios", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_cost_scenarios_base_income_profile_id"), ["base_income_profile_id"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_cost_scenarios_source"), ["source"], unique=False)
        batch_op.create_index(batch_op.f("ix_cost_scenarios_workspace_id"), ["workspace_id"], unique=False)
        batch_op.create_index("ix_cost_scenarios_workspace_status", ["workspace_id", "status"], unique=False)

    op.create_table(
        "cost_scenario_items",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workspace_id", sa.String(length=36), nullable=False),
        sa.Column("scenario_id", sa.String(length=36), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=False),
        sa.Column("direction", sa.String(length=8), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("currency", sa.String(length=8), nullable=True),
        sa.Column("recurrence", sa.String(length=16), nullable=True),
        sa.Column("starts_on", sa.Date(), nullable=True),
        sa.Column("ends_on", sa.Date(), nullable=True),
        sa.Column("category_id", sa.String(length=36), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("direction IN ('income', 'cost')", name=op.f("ck_cost_scenario_items_direction")),
        sa.CheckConstraint("amount >= 0", name=op.f("ck_cost_scenario_items_amount_non_negative")),
        sa.CheckConstraint(
            "ends_on IS NULL OR ends_on >= starts_on", name=op.f("ck_cost_scenario_items_date_order")
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["expense_categories.id"],
            name=op.f("fk_cost_scenario_items_category_id_expense_categories"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["scenario_id"],
            ["cost_scenarios.id"],
            name=op.f("fk_cost_scenario_items_scenario_id_cost_scenarios"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspaces.id"],
            name=op.f("fk_cost_scenario_items_workspace_id_workspaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cost_scenario_items")),
    )
    with op.batch_alter_table("cost_scenario_items", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_cost_scenario_items_category_id"), ["category_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_cost_scenario_items_scenario_id"), ["scenario_id"], unique=False)
        batch_op.create_index("ix_cost_scenario_items_scenario_starts", ["scenario_id", "starts_on"], unique=False)
        batch_op.create_index(batch_op.f("ix_cost_scenario_items_workspace_id"), ["workspace_id"], unique=False)

    # --- the wider notification CHECK ----------------------------------------
    with op.batch_alter_table("notifications", schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f("ck_notifications_kind"), type_="check")
        batch_op.create_check_constraint(
            batch_op.f("ck_notifications_kind"),
            "kind IN ('task_overdue', 'task_due', 'milestone', 'reminder', 'project_stalled', 'system', "
            "'subscription_renewing', 'expense_recurring_due', 'income_overdue', 'rate_stale')",
        )


def downgrade() -> None:
    # Phase 3's signals are derived and regenerate on the next /notifications refresh, so the
    # rows carrying the new kinds are removed rather than rewritten before 0001's CHECK returns.
    placeholders = ", ".join(f"'{kind}'" for kind in _PHASE_3_KINDS)
    op.execute(f"DELETE FROM notifications WHERE kind IN ({placeholders})")
    with op.batch_alter_table("notifications", schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f("ck_notifications_kind"), type_="check")
        batch_op.create_check_constraint(
            batch_op.f("ck_notifications_kind"),
            "kind IN ('" + "', '".join(_PHASE_1_KINDS) + "')",
        )

    for table, indexes in (
        (
            "cost_scenario_items",
            (
                "ix_cost_scenario_items_workspace_id",
                "ix_cost_scenario_items_scenario_starts",
                "ix_cost_scenario_items_scenario_id",
                "ix_cost_scenario_items_category_id",
            ),
        ),
        (
            "cost_scenarios",
            (
                "ix_cost_scenarios_workspace_status",
                "ix_cost_scenarios_workspace_id",
                "ix_cost_scenarios_source",
                "ix_cost_scenarios_base_income_profile_id",
            ),
        ),
        (
            "income_transactions",
            (
                "ix_income_transactions_workspace_status",
                "ix_income_transactions_workspace_received_on",
                "ix_income_transactions_workspace_id",
                "ix_income_transactions_subscription_id",
                "ix_income_transactions_source",
                "ix_income_transactions_service_id",
            ),
        ),
        (
            "expenses",
            (
                "ix_expenses_workspace_paid_on",
                "ix_expenses_workspace_id",
                "ix_expenses_workspace_category",
                "ix_expenses_source",
                "ix_expenses_category_id",
            ),
        ),
        (
            "subscriptions",
            (
                "ix_subscriptions_workspace_status_renews",
                "ix_subscriptions_workspace_id",
                "ix_subscriptions_source",
                "ix_subscriptions_plan_id",
                "ix_subscriptions_company_id",
            ),
        ),
        (
            "service_plans",
            (
                "ix_service_plans_workspace_service_interval",
                "ix_service_plans_workspace_id",
                "ix_service_plans_source",
                "ix_service_plans_service_id",
            ),
        ),
        ("services", ("ix_services_workspace_id", "ix_services_workspace_active", "ix_services_source")),
        ("income_profiles", ("ix_income_profiles_workspace_id", "ix_income_profiles_source")),
        ("expense_categories", ("ix_expense_categories_workspace_parent", "ix_expense_categories_workspace_id", "ix_expense_categories_parent_id")),
        ("exchange_rates", ("ix_exchange_rates_workspace_id",)),
    ):
        with op.batch_alter_table(table, schema=None) as batch_op:
            for index in indexes:
                batch_op.drop_index(index)
        op.drop_table(table)
