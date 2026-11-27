"""Deep links: the only place that knows how the frontend is addressed.

Every ``href`` the backend emits - activity rows, notifications, dashboard insights,
search results, demo data - is built here, so a route change is a one-line edit in this
module instead of a hunt through five services.

MyOS screens are the app's canonical routes: ``/tasks``, ``/notes``, ``/contacts``,
``/projects``, ``/goals``, ``/notifications``, ``/activity``, ``/settings``, ``/search``,
the Finance screens ``/finance``, ``/finance/income``, ``/finance/currency``,
``/finance/expenses``, ``/finance/subscriptions``, ``/finance/services``,
``/finance/scenarios``, and the dashboard at ``/``.  The legacy prefixed aliases those
screens used to live under are gone; nothing in this module may bring one back, and
``tests/test_links.py`` fails if any emitted href does.

The rules, all of them enforced by :func:`href_for`:

* a screen that selects one object does it with a **query parameter**
  (``/tasks?task=…``, ``/notes?note=…``, ``/contacts?contact=…``); only
  projects have a detail route of their own (``/projects/<id>``);
* a milestone opens **its project** - there is no milestone page;
* entities with no detail screen at all - goals, reminders, notifications, companies,
  workspaces - link to the list page that shows them;
* a missing id never leaks into a URL: ``href_for("milestone", mid, project_id=None)``
  is ``/projects``, not ``/projects/None``.  The guard lives here rather than at
  every call site, so it cannot be forgotten;
* an entity type we do not know yields ``None`` - no link is better than a wrong one.

The full target set is written down in docs/MYOS/DATA_MODEL.md ("Deep links") and, for the
finance records, docs/MYOS/PHASE3_FINANCE.md §7; anything outside them is a bug in this
module.
"""

from __future__ import annotations

from typing import Final
from urllib.parse import quote

ACTIVITY: Final = "/activity"
CONTACTS: Final = "/contacts"
GOALS: Final = "/goals"
NOTES: Final = "/notes"
NOTIFICATIONS: Final = "/notifications"
PROJECTS: Final = "/projects"
SEARCH: Final = "/search"
SETTINGS: Final = "/settings"
TASKS: Final = "/tasks"

#: the Finance screens (PHASE3_FINANCE.md §1); `/finance` is the module root
FINANCE: Final = "/finance"
FINANCE_CURRENCY: Final = f"{FINANCE}/currency"
FINANCE_EXPENSES: Final = f"{FINANCE}/expenses"
FINANCE_INCOME: Final = f"{FINANCE}/income"
FINANCE_SCENARIOS: Final = f"{FINANCE}/scenarios"
FINANCE_SERVICES: Final = f"{FINANCE}/services"
FINANCE_SUBSCRIPTIONS: Final = f"{FINANCE}/subscriptions"

#: saved views of the task list (``/tasks?filter=overdue`` is the shape the UI knows)
TASKS_OVERDUE: Final = f"{TASKS}?filter=overdue"
TASKS_DUE_TODAY: Final = f"{TASKS}?filter=today"
TASKS_DUE_WEEK: Final = f"{TASKS}?filter=week"

#: entity type -> (its list page, the query parameter that selects one row there).
#: ``None`` as the parameter means the page cannot select a row: link to the list.
_LINKS: Final[dict[str, tuple[str, str | None]]] = {
    "activity": (ACTIVITY, None),
    "company": (CONTACTS, None),
    "contact": (CONTACTS, "contact"),
    "cost_scenario": (FINANCE_SCENARIOS, "scenario"),
    "expense": (FINANCE_EXPENSES, "expense"),
    "expense_category": (FINANCE_EXPENSES, "category"),
    "exchange_rate": (FINANCE_CURRENCY, None),
    "goal": (GOALS, None),
    "income": (FINANCE_INCOME, "income"),
    "income_profile": (FINANCE_INCOME, None),
    "milestone": (PROJECTS, None),
    "note": (NOTES, "note"),
    "notification": (NOTIFICATIONS, None),
    "project": (PROJECTS, None),
    "reminder": (NOTIFICATIONS, None),
    "scenario": (FINANCE_SCENARIOS, "scenario"),
    "scenario_item": (FINANCE_SCENARIOS, None),
    "service": (FINANCE_SERVICES, "service"),
    "service_plan": (FINANCE_SERVICES, None),
    "subscription": (FINANCE_SUBSCRIPTIONS, "sub"),
    "task": (TASKS, "task"),
    "workspace": (SETTINGS, None),
}

#: plural search group / table name -> the singular entity type it holds
_ALIASES: Final[dict[str, str]] = {
    "companies": "company",
    "contacts": "contact",
    "cost_scenario_items": "scenario_item",
    "cost_scenarios": "scenario",
    "expense_categories": "expense_category",
    "expenses": "expense",
    "goals": "goal",
    "income_profiles": "income_profile",
    "income_transactions": "income",
    "milestones": "milestone",
    "notes": "note",
    "notifications": "notification",
    "projects": "project",
    "reminders": "reminder",
    "services": "service",
    "subscriptions": "subscription",
    "tasks": "task",
    "users": "workspace",
    "workspaces": "workspace",
}


#: search group -> the canonical list page its header links to.  Companies have no page
#: of their own, so both people groups open ``/contacts``.
_SEARCH_PAGES: Final[dict[str, str]] = {
    "tasks": TASKS,
    "projects": PROJECTS,
    "notes": NOTES,
    "milestones": PROJECTS,
    "contacts": CONTACTS,
    "companies": CONTACTS,
    "expenses": FINANCE_EXPENSES,
    "subscriptions": FINANCE_SUBSCRIPTIONS,
    "services": FINANCE_SERVICES,
}


def _kind(name: str | None) -> str | None:
    key = str(name).strip().lower() if name else ""
    return _ALIASES.get(key, key) or None


def _id(entity_id: object) -> str | None:
    """An id we may put in a URL: ``None``, empty and the literal ``"None"`` may not."""
    if entity_id is None:
        return None
    text = str(entity_id).strip()
    return text if text and text != "None" else None


def href_for(
    entity_type: str | None, entity_id: str | None = None, *, project_id: str | None = None
) -> str | None:
    """In-app link for one entity, or ``None`` for an entity type we do not know.

    ``project_id`` is consulted only for milestones, which have no page of their own and
    open the project they belong to; with no project they open the project list.
    """
    kind = _kind(entity_type)
    entry = _LINKS.get(kind or "")
    if entry is None:
        return None
    page, parameter = entry
    if kind == "milestone":
        project = _id(project_id)
        return f"{PROJECTS}/{project}" if project else PROJECTS
    if kind == "project":
        project = _id(entity_id)
        return f"{PROJECTS}/{project}" if project else PROJECTS
    ident = _id(entity_id)
    if parameter is None or not ident:
        return page
    return f"{page}?{parameter}={ident}"


def search_href(group: str, query: str) -> str:
    """``/tasks?q=order`` - the list page a search group's header links to, filtered.

    Takes the group name (``tasks``, ``milestones``, ``companies``, …) so the route stays
    in this module; a value that already looks like a path is used as-is.
    """
    key = str(group).strip().lower()
    page = _SEARCH_PAGES.get(key, group)
    return f"{page}?q={quote((query or '').strip(), safe='')}"


def currency_pair_href(base: str | None, other: str | None) -> str:
    """``/finance/currency?pair=USDINR`` - the converter opened on one pair (§6).

    A pair with no code behind it is still the converter, so an incomplete row never
    produces ``?pair=None``.
    """
    pair = f"{_id(base) or ''}{_id(other) or ''}".upper()
    return f"{FINANCE_CURRENCY}?pair={quote(pair, safe='')}" if pair else FINANCE_CURRENCY
