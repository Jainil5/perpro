"""Expense categories and the expense ledger.

The category tree is the part with rules of its own (§4):

* a node is unique by ``(workspace, name, parent)``, so ``Work > Rent`` and ``Home > Rent``
  can co-exist while two ``Rent`` rows under one parent cannot - the UNIQUE is checked as a
  409 before the flush, because an IntegrityError mid-transaction costs the whole request;
* ``parent_id`` may not be the node itself and may not close a cycle - both are 422s, found
  by walking up the chain on write rather than by reading a loop back later;
* ``amount_this_month`` rolls a node's own rows **plus its descendants'**, because the screen
  draws the parent row and expects it to add up;
* the seven ``system_key`` presets are idempotent, so seeding twice never doubles them.

Expenses are ordinary ledger rows except for one pair: ``recurring`` and ``recurrence`` must
agree. A recurring row with ``recurrence=none`` has no period to normalise, and a weekly row
with ``recurring=false`` silently drops out of the burn - so both directions are 422s rather
than a shrug, and :func:`money.monthly_burn` can trust what it reads.

``export_csv`` takes the same filters as the list endpoint and is generated per request;
§4 is explicit that the file is not written to disk. Its totals are **per currency**,
because a single mixed-currency line is the one number this API may not invent (§2.3).
"""

from __future__ import annotations

import csv
import datetime as dt
import io
from decimal import Decimal
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.errors import conflict, field_error, validation
from app.core.utils import today_utc
from app.models import Expense, ExpenseCategory
from app.models.enums import ActivityVerb, ExpenseCategoryKind, ExpenseRecurrence
from app.services import activity, crud, money, rates

#: the presets §4 names, as ``(system_key, name, kind, color)``
PRESET_CATEGORIES = (
    ("rent", "Rent", "fixed", "#8B5CF6"),
    ("software", "Software", "fixed", "#3B82F6"),
    ("insurance", "Insurance", "fixed", "#14B8A6"),
    ("tax", "Tax", "tax", "#F59E0B"),
    ("food", "Food", "variable", "#EF4444"),
    ("travel", "Travel", "variable", "#06B6D4"),
    ("other", "Other", "one_off", "#6B7280"),
)

RECURGENCES = tuple(item.value for item in ExpenseRecurrence)
CATEGORY_KINDS = tuple(item.value for item in ExpenseCategoryKind)
BULK_ACTIONS = ("delete", "set_category", "set_recurring")

#: sort key -> (column, default direction); ``id`` is the always-ascending final tiebreaker
_SORTS: dict[str, tuple[Any, str]] = {
    "paid_on": (Expense.paid_on, "desc"),
    "amount": (Expense.amount, "desc"),
    "created": (Expense.created_at, "desc"),
}


def _order(sort: str, direction: str | None) -> tuple[Any, ...]:
    """Flip only the requested key - the contract addendum's ``?dir=`` rule."""
    column, default = _SORTS[sort]
    key = column.asc() if (direction or default).lower() == "asc" else column.desc()
    return (key, Expense.id.asc())


# --------------------------------------------------------------------------- the tree


def category_payload(
    row: ExpenseCategory,
    *,
    children: list[dict[str, Any]] | None = None,
    depth: int = 0,
    amount: Decimal | None = None,
    currency: str | None = None,
    monthly: Decimal | None = None,
    count: int = 0,
) -> dict[str, Any]:
    """One node: its own columns plus the roll-up §4 asks every node to carry."""
    return {
        "id": row.id,
        "name": row.name,
        "parent_id": row.parent_id,
        "kind": row.kind,
        "system_key": row.system_key,
        "color": row.color,
        "archived": row.archived,
        "depth": depth,
        "children": children or [],
        "amount_this_month": amount,
        "currency": currency,
        "monthly_norm": monthly,
        "expense_count": count,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _children_of(rows: list[ExpenseCategory]) -> dict[str | None, list[ExpenseCategory]]:
    tree: dict[str | None, list[ExpenseCategory]] = {}
    for row in rows:
        tree.setdefault(row.parent_id, []).append(row)
    for bucket in tree.values():
        bucket.sort(key=lambda item: (item.name.lower(), item.id))
    return tree


def _subtree_ids(node: ExpenseCategory, tree: dict[str | None, list[ExpenseCategory]]) -> list[str]:
    out = [node.id]
    for child in tree.get(node.id, ()):
        out.extend(_subtree_ids(child, tree))
    return out


def _workspace_categories(
    session: Session, workspace_id: str
) -> tuple[list[ExpenseCategory], dict[str | None, list[ExpenseCategory]]]:
    rows = list(
        session.scalars(
            sa.select(ExpenseCategory)
            .where(ExpenseCategory.workspace_id == workspace_id)
            .order_by(ExpenseCategory.name, ExpenseCategory.id)
        )
    )
    return rows, _children_of(rows)


def subtree_ids(session: Session, workspace_id: str, category_id: str) -> list[str]:
    """The category and everything below it - what ``?category_id=`` matches (§4)."""
    rows, tree = _workspace_categories(session, workspace_id)
    node = next((row for row in rows if row.id == category_id), None)
    return _subtree_ids(node, tree) if node else [category_id]


def list_categories(
    session: Session,
    workspace_id: str,
    *,
    kind: str | None = None,
    archived: bool | None = None,
    month: Any | None = None,
    currency: str | None = None,
    today: dt.date | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """``GET /expense-categories`` - a tree, each node rolled up over its own subtree."""
    day = today or today_utc()
    period = money.month_floor(month) if month else money.month_floor(day)
    last = money.month_last(period)
    rows = _workspace_categories(session, workspace_id)[0]

    # ``?kind=``/``?archived=`` cut the tree, and the cut has to happen *before* the roll-up:
    # building over the unfiltered tree would both double-count a re-rooted node (once as
    # its own root, once inside the parent that was filtered out) and show hidden children.
    visible = [
        row
        for row in rows
        if (kind is None or row.kind == kind) and (archived is None or row.archived is bool(archived))
    ]
    tree = _children_of(visible)
    kept = {row.id for row in visible}
    # a node whose parent was cut becomes a root here rather than vanishing with its subtree
    roots = [row for row in visible if row.parent_id is None or row.parent_id not in kept]
    hidden = {row.id for row in rows if row.id not in kept}

    ledger = list(
        session.scalars(
            sa.select(Expense).where(
                Expense.workspace_id == workspace_id,
                Expense.paid_on >= period,
                Expense.paid_on <= last,
            )
        )
    )
    by_category: dict[str | None, list[Expense]] = {}
    for row in ledger:
        by_category.setdefault(row.category_id, []).append(row)

    def build(node: ExpenseCategory, depth: int) -> dict[str, Any]:
        owned = [
            row
            for node_id in _subtree_ids(node, tree)
            for row in by_category.get(node_id, ())
            if node_id not in hidden
        ]
        tally = money.tally_by_currency(owned)
        target = money.resolve_currency(tally, currency)
        normalised: dict[str, Decimal] = {}
        for row in owned:
            value = money.monthly_normalise(row.amount, row.recurrence)
            if value is not None:
                normalised[row.currency] = normalised.get(row.currency, Decimal(0)) + value
        children = [build(child, depth + 1) for child in tree.get(node.id, ())]
        return category_payload(
            node,
            children=children,
            depth=depth,
            amount=money.sum_tally(session, workspace_id, tally, target, as_of=day, today=day),
            currency=target,
            monthly=money.sum_tally(session, workspace_id, normalised, target, as_of=day, today=day),
            count=len(owned),
        )

    return [build(row, 0) for row in roots], len(visible)


def _check_parent(
    session: Session,
    workspace_id: str,
    parent_id: str | None,
    *,
    node_id: str | None,
) -> None:
    """422 a missing, self-referencing or cyclic parent, 409 a parent in another workspace (§4).

    A missing ``parent_id`` is a *body* reference, so it answers like every other one in this
    phase (422 naming the field) rather than like a path id (404) - the screen highlights the
    parent picker, not the whole request.
    """
    if parent_id is None:
        return
    if node_id is not None and parent_id == node_id:
        raise validation(
            "parent_id must not be the category itself",
            [field_error(["body", "parent_id"], "a category cannot be its own parent")],
        )
    crud.validate_fk(
        session, ExpenseCategory, parent_id, workspace_id=workspace_id, field="parent_id"
    )
    parent = session.get(ExpenseCategory, parent_id)
    cursor: ExpenseCategory | None = parent
    for _ in range(65):  # a bounded walk: 64 levels is already a nonsense tree
        if cursor is None:
            return
        if node_id is not None and cursor.id == node_id:
            raise validation(
                "parent_id would create a cycle",
                [field_error(["body", "parent_id"], "a category cannot live inside itself")],
            )
        cursor = session.get(ExpenseCategory, cursor.parent_id) if cursor.parent_id else None
    raise validation(
        "the category tree is too deep",
        [field_error(["body", "parent_id"], "a category chain may not exceed 64 levels")],
    )


def _check_unique(
    session: Session,
    workspace_id: str,
    name: str,
    parent_id: str | None,
    *,
    exclude_id: str | None = None,
) -> None:
    """``UNIQUE (workspace_id, name, parent_id)`` answered as a 409, not an IntegrityError.

    SQLite and Postgres both treat NULL as distinct inside a composite UNIQUE, so the
    top level - where most names live - needs this check to behave like the constraint
    the docs promise.
    """
    conditions = [
        ExpenseCategory.workspace_id == workspace_id,
        sa.func.lower(ExpenseCategory.name) == name.strip().lower(),
        ExpenseCategory.parent_id.is_(None)
        if parent_id is None
        else ExpenseCategory.parent_id == parent_id,
    ]
    clash = session.scalar(sa.select(ExpenseCategory.id).where(*conditions))
    if clash is not None and clash != exclude_id:
        raise conflict(
            f"a category named {name!r} already exists at that level",
            [field_error(["body", "name"], "name is unique per (workspace, parent)")],
        )


def _check_kind(data: dict[str, Any]) -> str | None:
    raw = data.get("kind")
    if raw is None or str(raw).strip() == "":
        return None
    key = str(raw).strip().lower()
    if key not in CATEGORY_KINDS:
        raise validation(
            "kind is not a supported category kind",
            [field_error(["body", "kind"], f"'{raw}' is not one of {', '.join(CATEGORY_KINDS)}")],
        )
    return key


def _check_name(value: Any, *, required: bool) -> str | None:
    text = str(value or "").strip()
    if not text:
        if required:
            raise validation(
                "name is required",
                [field_error(["body", "name"], "a category has to be called something")],
            )
        raise validation(
            "name must not be empty", [field_error(["body", "name"], "a category needs a name")]
        )
    return text


def create_category(session: Session, workspace_id: str, data: dict[str, Any]) -> dict[str, Any]:
    name = _check_name(data.get("name"), required=True)
    parent_id = data.get("parent_id") or None
    _check_parent(session, workspace_id, str(parent_id) if parent_id else None, node_id=None)
    _check_unique(session, workspace_id, name, str(parent_id) if parent_id else None)
    row = ExpenseCategory(
        workspace_id=workspace_id,
        name=name,
        parent_id=parent_id,
        kind=_check_kind(data),
        system_key=_text(data.get("system_key")),
        color=_text(data.get("color")),
        archived=bool(data.get("archived", False)),
    )
    session.add(row)
    session.flush()
    activity.created(
        session,
        workspace_id=workspace_id,
        entity_type="expense_category",
        entity_id=row.id,
        entity_title=row.name,
    )
    return category_payload(row)


def update_category(
    session: Session, workspace_id: str, category_id: str, data: dict[str, Any]
) -> dict[str, Any]:
    row = crud.require(
        session, ExpenseCategory, category_id, workspace_id=workspace_id, label="expense category"
    )
    name = row.name
    if "name" in data:
        name = _check_name(data["name"], required=False)
    parent_id = row.parent_id
    if "parent_id" in data:
        parent_id = data["parent_id"] or None
        _check_parent(
            session,
            workspace_id,
            str(parent_id) if parent_id else None,
            node_id=row.id,
        )
    _check_unique(session, workspace_id, name, str(parent_id) if parent_id else None, exclude_id=row.id)
    row.name = name
    row.parent_id = parent_id
    if "kind" in data:
        row.kind = _check_kind(data)
    for field in ("color", "archived", "system_key"):
        if field in data:
            setattr(row, field, data[field])
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="expense_category",
        entity_id=row.id,
        entity_title=row.name,
    )
    return category_payload(row)


def delete_category(session: Session, workspace_id: str, category_id: str) -> dict[str, Any]:
    """Children cascade (§13) and ``expenses.category_id`` is set null (§8)."""
    row = crud.require(
        session, ExpenseCategory, category_id, workspace_id=workspace_id, label="expense category"
    )
    snapshot = {"id": row.id, "name": row.name}
    session.delete(row)
    session.flush()
    activity.deleted(
        session,
        workspace_id=workspace_id,
        entity_type="expense_category",
        entity_id=snapshot["id"],
        entity_title=snapshot["name"],
    )
    return snapshot


def ensure_presets(session: Session, workspace_id: str) -> int:
    """Create the seven §4 presets that are missing; idempotent by ``system_key``."""
    made = 0
    for key, name, kind, color in PRESET_CATEGORIES:
        exists = session.scalar(
            sa.select(ExpenseCategory.id).where(
                ExpenseCategory.workspace_id == workspace_id, ExpenseCategory.system_key == key
            )
        )
        if exists is not None:
            continue
        session.add(
            ExpenseCategory(
                workspace_id=workspace_id, name=name, kind=kind, system_key=key, color=color
            )
        )
        made += 1
    if made:
        session.flush()
        activity.record(
            session,
            workspace_id=workspace_id,
            verb=ActivityVerb.CREATED.value,
            entity_type="expense_category",
            entity_id=None,
            entity_title="expense categories",
            summary=f"Seeded {made} expense categor{'y' if made == 1 else 'ies'}",
        )
    return made


# --------------------------------------------------------------------------- expenses


def _check_recurring(recurring: Any, recurrence: Any) -> tuple[bool, str]:
    """``recurring`` and ``recurrence`` must agree, in both directions (§4)."""
    flag = bool(recurring)
    key = str(recurrence or ExpenseRecurrence.NONE.value).strip().lower()
    if key not in RECURGENCES:
        raise validation(
            "recurrence is not a supported expense recurrence",
            [
                field_error(
                    ["body", "recurrence"], f"'{recurrence}' is not one of {', '.join(RECURGENCES)}"
                )
            ],
        )
    if flag and key == ExpenseRecurrence.NONE.value:
        raise validation(
            "a recurring expense needs a recurrence interval",
            [field_error(["body", "recurrence"], "recurring=true with recurrence=none has no period")],
        )
    if not flag and key != ExpenseRecurrence.NONE.value:
        raise validation(
            "recurrence requires recurring=true",
            [
                field_error(
                    ["body", "recurring"],
                    f"a {key} row that is not recurring is silently dropped from the burn",
                )
            ],
        )
    return flag, key


def _text(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _amount(value: Any, code: str) -> Decimal:
    """Money in, quantised and non-negative - §4 makes ``amount >= 0`` a 422, not a CHECK."""
    amount = Decimal(str(value))
    if amount < 0:
        raise validation(
            "amount must not be negative",
            [
                field_error(
                    ["body", "amount"],
                    f"{amount} is below zero; money coming back is an income row, not a negative expense",
                )
            ],
        )
    return money.money(amount, code)


def _filtered(
    session: Session,
    workspace_id: str,
    *,
    category_id: str | None = None,
    vendor: str | None = None,
    currency: str | None = None,
    recurring: bool | None = None,
    recurrence: str | None = None,
    start: dt.date | None = None,
    end: dt.date | None = None,
    query: str | None = None,
) -> list[Any]:
    """The WHERE shared by the list, the CSV export and the summary's drill-down."""
    conditions: list[Any] = [Expense.workspace_id == workspace_id]
    if category_id:
        conditions.append(Expense.category_id.in_(subtree_ids(session, workspace_id, category_id)))
    if vendor:
        conditions.append(crud.text_match(Expense.vendor, vendor.strip()))
    if currency:
        conditions.append(Expense.currency == rates.code_or_422(currency, "currency", in_query=True))
    if recurrence:
        conditions.append(Expense.recurrence == recurrence)
    if recurring is not None:
        conditions.append(Expense.recurring.is_(bool(recurring)))
    if start:
        conditions.append(Expense.paid_on >= start)
    if end:
        conditions.append(Expense.paid_on <= end)
    if query:
        needle = query.strip()
        conditions.append(
            sa.or_(
                crud.text_match(Expense.label, needle),
                crud.text_match(Expense.vendor, needle),
                crud.text_match(Expense.invoice_number, needle),
                crud.text_match(Expense.notes, needle),
            )
        )
    return conditions


def list_expenses(
    session: Session,
    workspace_id: str,
    *,
    category_id: str | None = None,
    vendor: str | None = None,
    currency: str | None = None,
    recurring: bool | None = None,
    recurrence: str | None = None,
    start: dt.date | None = None,
    end: dt.date | None = None,
    query: str | None = None,
    sort: str = "paid_on",
    direction: str | None = None,
    limit: int | None = None,
    offset: int = 0,
    today: dt.date | None = None,
) -> tuple[list[dict[str, Any]], int]:
    day = today or today_utc()
    conditions = _filtered(
        session,
        workspace_id,
        category_id=category_id,
        vendor=vendor,
        currency=currency,
        recurring=recurring,
        recurrence=recurrence,
        start=start,
        end=end,
        query=query,
    )
    total = int(session.scalar(sa.select(sa.func.count()).select_from(Expense).where(*conditions)) or 0)
    statement = sa.select(Expense).where(*conditions).order_by(*_order(sort, direction))
    if limit is not None:
        statement = statement.limit(limit).offset(max(0, offset))
    return [
        money.expense_row_payload(row, today=day, category=row.category)
        for row in session.scalars(statement)
    ], total


def get_expense(
    session: Session, workspace_id: str, expense_id: str, *, today: dt.date | None = None
) -> dict[str, Any]:
    row = crud.require(session, Expense, expense_id, workspace_id=workspace_id, label="expense")
    return money.expense_row_payload(row, today=today or today_utc(), category=row.category)


def _apply(row: Expense, data: dict[str, Any], session: Session, workspace_id: str) -> None:
    """Assign a validated body onto a row - one path for POST and PATCH alike."""
    if "category_id" in data:
        category_id = data["category_id"]
        if category_id:
            crud.validate_fk(
                session,
                ExpenseCategory,
                str(category_id),
                workspace_id=workspace_id,
                field="category_id",
            )
        row.category_id = str(category_id) if category_id else None
    if "label" in data:
        row.label = _text(data["label"]) or row.label
    if data.get("currency") is not None:
        row.currency = money.require_currency(data["currency"], "currency")
    if data.get("amount") is not None:
        row.amount = _amount(data["amount"], row.currency)
    if data.get("paid_on") is not None:
        row.paid_on = data["paid_on"]
    if "recurring" in data or "recurrence" in data:
        row.recurring, row.recurrence = _check_recurring(
            data.get("recurring", row.recurring), data.get("recurrence", row.recurrence)
        )
    for field in ("vendor", "invoice_number", "receipt_path", "notes"):
        if field in data:
            setattr(row, field, _text(data[field]) if field != "notes" else data[field])


def create_expense(
    session: Session,
    workspace_id: str,
    data: dict[str, Any],
    *,
    today: dt.date | None = None,
    source: str = "user",
) -> dict[str, Any]:
    day = today or today_utc()
    label = _text(data.get("label"))
    if not label:
        raise validation(
            "label is required", [field_error(["body", "label"], "an expense needs a label")]
        )
    for field, message in (
        ("amount", "an expense needs an amount"),
        ("currency", "every money-bearing row carries an explicit currency"),
        ("paid_on", "an expense needs a date"),
    ):
        if data.get(field) is None:
            raise validation(f"{field} is required", [field_error(["body", field], message)])
    code = money.require_currency(data["currency"], "currency")
    row = Expense(
        workspace_id=workspace_id,
        label=label,
        amount=_amount(data["amount"], code),
        currency=code,
        paid_on=data["paid_on"],
        source=source,
    )
    row.recurring, row.recurrence = _check_recurring(
        data.get("recurring", False), data.get("recurrence")
    )
    # the optional columns only - the four required ones are already validated and set
    _apply(
        row,
        {key: value for key, value in data.items() if key not in ("label", "amount", "currency", "paid_on")},
        session,
        workspace_id,
    )
    session.add(row)
    session.flush()
    activity.created(
        session,
        workspace_id=workspace_id,
        entity_type="expense",
        entity_id=row.id,
        entity_title=row.label,
    )
    return money.expense_row_payload(row, today=day, category=row.category)


def update_expense(
    session: Session,
    workspace_id: str,
    expense_id: str,
    data: dict[str, Any],
    *,
    today: dt.date | None = None,
) -> dict[str, Any]:
    day = today or today_utc()
    row = crud.require(session, Expense, expense_id, workspace_id=workspace_id, label="expense")
    _apply(row, data, session, workspace_id)
    session.flush()
    activity.updated(
        session,
        workspace_id=workspace_id,
        entity_type="expense",
        entity_id=row.id,
        entity_title=row.label,
    )
    return money.expense_row_payload(row, today=day, category=row.category)


def delete_expense(session: Session, workspace_id: str, expense_id: str) -> dict[str, Any]:
    row = crud.require(session, Expense, expense_id, workspace_id=workspace_id, label="expense")
    snapshot = {
        "id": row.id,
        "label": row.label,
        "amount": money.money(row.amount, row.currency),
        "currency": row.currency,
    }
    session.delete(row)
    session.flush()
    activity.deleted(
        session,
        workspace_id=workspace_id,
        entity_type="expense",
        entity_id=snapshot["id"],
        entity_title=snapshot["label"],
    )
    return snapshot


# ------------------------------------------------------------------------------ bulk


def bulk(
    session: Session, workspace_id: str, ids: list[str], action: str, value: Any = None
) -> dict[str, Any]:
    """``POST /expenses/bulk`` -> ``{updated, failed: [{id, error}]}``.

    Each id is attempted on its own, so a row deleted between loading the selection and
    submitting it costs one line in ``failed`` instead of the whole batch (§4). Nothing
    rolls back here: the request's unit of work commits what succeeded, which is what a
    bulk edit means in a UI that lists the failures.
    """
    if action not in BULK_ACTIONS:
        raise validation(
            "action is not a supported bulk action",
            [field_error(["body", "action"], f"'{action}' is not one of {', '.join(BULK_ACTIONS)}")],
        )
    if not ids:
        return {"updated": 0, "failed": [], "action": action}
    if action == "set_category":
        target = _text(value if isinstance(value, str) else (value or {}).get("category_id"))
        if not target:
            raise validation(
                "value is required for set_category",
                [field_error(["body", "value"], "which category should these rows move to?")],
            )
        crud.validate_fk(session, ExpenseCategory, target, workspace_id=workspace_id, field="value")
        value = target
    if action == "set_recurring":
        if not isinstance(value, dict):
            raise validation(
                "value must be {recurring, recurrence}",
                [
                    field_error(
                        ["body", "value"], "a recurring change needs both the flag and the interval"
                    )
                ],
            )
        _check_recurring(value.get("recurring"), value.get("recurrence"))

    found = list(
        session.scalars(
            sa.select(Expense).where(Expense.workspace_id == workspace_id, Expense.id.in_(list(ids)))
        )
    )
    present = {row.id for row in found}
    failed: list[dict[str, Any]] = [
        {"id": str(item), "error": "expense not found"} for item in ids if str(item) not in present
    ]
    updated = 0
    for row in found:
        try:
            if action == "delete":
                session.delete(row)
            elif action == "set_category":
                row.category_id = str(value)
            else:
                row.recurring, row.recurrence = _check_recurring(
                    value.get("recurring"), value.get("recurrence")
                )
            updated += 1
        except Exception as exc:  # per-row rule broke: report it and keep going (§4)
            failed.append({"id": row.id, "error": str(exc)})
    session.flush()
    if updated:
        verb = ActivityVerb.DELETED if action == "delete" else ActivityVerb.UPDATED
        activity.record(
            session,
            workspace_id=workspace_id,
            verb=verb.value,
            entity_type="expense",
            entity_id=None,
            entity_title="expenses",
            summary=f"Bulk-{'deleted' if action == 'delete' else 'updated'} {updated} expense(s)",
        )
    return {"updated": updated, "failed": failed, "action": action}


# -------------------------------------------------------------------------- csv export


CSV_COLUMNS = (
    "id",
    "paid_on",
    "label",
    "vendor",
    "category",
    "amount",
    "currency",
    "monthly_amount",
    "recurring",
    "recurrence",
    "invoice_number",
    "notes",
)


def export_csv(
    session: Session,
    workspace_id: str,
    *,
    category_id: str | None = None,
    vendor: str | None = None,
    currency: str | None = None,
    start: dt.date | None = None,
    end: dt.date | None = None,
    query: str | None = None,
    today: dt.date | None = None,
) -> str:
    """``GET /expenses/export.csv`` - the filtered rows, then a per-currency totals block."""
    day = today or today_utc()
    conditions = _filtered(
        session,
        workspace_id,
        category_id=category_id,
        vendor=vendor,
        currency=currency,
        start=start,
        end=end,
        query=query,
    )
    rows = list(
        session.scalars(
            sa.select(Expense).where(*conditions).order_by(Expense.paid_on, Expense.label, Expense.id)
        )
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    totals: dict[str, Decimal] = {}
    for row in rows:
        amount = Decimal(str(row.amount))
        totals[row.currency] = totals.get(row.currency, Decimal(0)) + amount
        monthly = money.monthly_normalise(amount, row.recurrence)
        writer.writerow(
            [
                row.id,
                row.paid_on.isoformat(),
                row.label,
                row.vendor or "",
                row.category.name if row.category else "",
                str(money.money(amount, row.currency)),
                row.currency,
                "" if monthly is None else str(money.money(monthly, row.currency)),
                "true" if row.recurring else "false",
                row.recurrence or ExpenseRecurrence.NONE.value,
                row.invoice_number or "",
                (row.notes or "").replace("\r", " ").replace("\n", " "),
            ]
        )
    writer.writerow([])
    #: the totals block is comments, so it cannot be mistaken for another data row - and a
    #: per-currency line is the only total §2.3 allows when the file mixes currencies.
    window = f"{start.isoformat()}..{end.isoformat()}" if start and end else (
        f"until {day.isoformat()}" if end or start else day.isoformat()
    )
    buffer.write(f"# expenses {window}\n")
    buffer.write(f"# rows,{len(rows)}\n")
    for code, amount in sorted(totals.items()):
        buffer.write(f"# total,{code},{money.money(amount, code)}\n")
    return buffer.getvalue()


__all__ = [
    "BULK_ACTIONS",
    "CATEGORY_KINDS",
    "CSV_COLUMNS",
    "PRESET_CATEGORIES",
    "RECURGENCES",
    "bulk",
    "category_payload",
    "create_category",
    "create_expense",
    "delete_category",
    "delete_expense",
    "ensure_presets",
    "export_csv",
    "get_expense",
    "list_categories",
    "list_expenses",
    "subtree_ids",
    "update_category",
    "update_expense",
]
